/* extension.ts Copyright 2026 Qore Technologies, s.r.o. */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import * as gettext_parser from 'gettext-parser';
import { join } from 'path';
import { t, addLocale, useLocale } from 'ttag';
import {
    CancellationToken,
    commands,
    debug,
    DebugAdapterDescriptor,
    DebugAdapterDescriptorFactory,
    DebugAdapterExecutable,
    DebugConfiguration,
    DebugConfigurationProvider,
    DebugSession,
    ExtensionContext,
    Position,
    ProviderResult,
    Uri,
    window,
    workspace,
    WorkspaceFolder
} from 'vscode';

import {
    DocumentSymbolReturnType,
    getDocumentSymbolsImpl,
    QoreTextDocument,
} from './documentSymbols';
import { QLS_INIT_SETTINGS } from './initializationOptions';
import { QLSManager } from './QLSManager';
import { QoreLaunchConfig } from './QoreLaunchConfig';
import {
    checkDebuggerWithLaunchConfig,
    checkQLSWithLaunchConfig,
    checkQoreLaunchConfig,
} from './qoreChecks';
import * as msg from './qore_message';
import { SHOW_REFERENCES_COMMAND, showReferences } from './showReferences';
import { findScript } from './utils';

let qlsManager: QLSManager = new QLSManager();
let qoreLaunchCfg: QoreLaunchConfig | undefined = undefined;
let debugAdapter: string;
/*
    We need list of programs in GUI via registerCommand(extension.qore-vscode.getProgram)
    but the connection is also resolvable in registerCommand(extension.qore-vscode.getConnection).
    getConnection is called first but does not update config passed to getProgram. So as
    workaround we pass value via global variable currentConnection which won't work if any
    other resolvable variable appears in connection launch.json.

    Resolving is executed via Debugger::substituesVariables() but I did not find way how to override default
    handling in extension module. Seems we should create new Debuuger class and somehow register for 'qore'
    but it is done in vscode core via contributes.debuggers in package.json.
*/
let currentConnection: string | undefined;

setLocale();

function setLocale() {
    const default_locale = 'en';
    let use_default_locale: boolean = false;

    let po_file: string | undefined = undefined;
    let locale: string = workspace.getConfiguration().typescript.locale;

    function setPoFile() {
        if (use_default_locale) {
            locale = default_locale;
        }
        po_file = join(__dirname, '..', 'lang', `${locale}.po`);
        if (!existsSync(po_file)) {
            po_file = undefined;
        }
    }

    if (locale) {
        setPoFile();
        if (!po_file && (locale != default_locale)) {
            use_default_locale = true;
            setPoFile();
        }
    }
    else {
        use_default_locale = true;
        setPoFile();
    }

    if (!po_file) {
        msg.error("Language file not found");
        return;
    }

    const translation_object = gettext_parser.po.parse(readFileSync(po_file));
    addLocale(locale, translation_object);
    useLocale(locale);

    if (use_default_locale) {
        msg.log(t`UsingDefaultLocale ${locale}`);
    }
    else {
        msg.log(t`UsingLocaleSettings ${locale}`);
    }
}

function setupQoreLaunchConfig() {
    if (qoreLaunchCfg !== undefined) {
        const configOk = checkQoreLaunchConfig(qoreLaunchCfg);
        if (configOk) {
            return;
        }
        qoreLaunchCfg = undefined;
    }

    const configuredExecutable = workspace.getConfiguration('qore').get<string>('executable', 'qore');
    const qoreExec = configuredExecutable.trim() || 'qore';

    // check base config
    const launchConfig = new QoreLaunchConfig(qoreExec);
    const configOk = checkQoreLaunchConfig(launchConfig);
    if (configOk) {
        qoreLaunchCfg = launchConfig;
        return;
    }
}

async function doQLSLaunch(useQLS: boolean): Promise<void> {
    setupQoreLaunchConfig();

    // check if QLS should be used
    if (!useQLS) {
        return;
    }

    if (!qoreLaunchCfg) {
        msg.warning(`Qore 3.0 or newer was not found; configure 'qore.executable'.`);
        return;
    }
    if (!checkQLSWithLaunchConfig(qoreLaunchCfg)) {
        msg.warning('The configured Qore installation cannot load the integrated QLS module.');
        return;
    }
    try {
        await qlsManager.startWithLaunchConfig(qoreLaunchCfg);
    } catch (error) {
        msg.error(`Failed to start QLS: ${String(error)}`);
    }
}

function registerCommands(context: ExtensionContext) {
    // stop QLS command
    context.subscriptions.push(commands.registerCommand('qore-vscode.stopQLS', async _config => {
        await qlsManager.stop();
    }));

    // start QLS command
    context.subscriptions.push(commands.registerCommand('qore-vscode.startQLS', async _config => {
        if (qlsManager.started()) {
            msg.info(t`QLSAlreadyStarted`);
            return;
        }

        await doQLSLaunch(true);
    }));

    // shows the references of a QLS reference-count code lens
    context.subscriptions.push(commands.registerCommand(SHOW_REFERENCES_COMMAND, (...args: unknown[]) =>
        showReferences<Uri, Position>({
            parseUri: uri => Uri.parse(uri, true),
            makePosition: (line, character) => new Position(line, character),
            executeCommand: (command, ...commandArgs) => commands.executeCommand(command, ...commandArgs),
            showWarning: message => msg.warning(message),
        }, ...args)));
}

function pushDebugSubscriptions(context: ExtensionContext) {
    // debug commands
    context.subscriptions.push(commands.registerCommand('extension.qore-vscode.getFilename', _config => {
        // show input box is invoked async in executeCommandVariables so result of command is a Thenable object
        return window.showInputBox({
            //prompt: "",
            placeHolder: t`FilenamePlaceHolder`,
            value: "script.q"
        }).then(
            input => {
                if (!input) {
                    return;
                }
                msg.logPlusConsole("Got input in qore-vscode.getFilename command: " + input);
                // ignored for now
                // TODO tmandys has to explain why the input is ignored here
            },
            err => {
                msg.logPlusConsole(err);
            }
        );
    }));
    context.subscriptions.push(commands.registerCommand('extension.qore-vscode.getConnection', _config => {
        return window.showInputBox({
            placeHolder: t`ConnectionPlaceHolder`,
            value: "ws://localhost:8001/debug"
        }).then(
            conn => {
                if (!conn) {
                    throw Error();
                }
                // save value for getProgramFromList
                currentConnection = conn;
                return conn;
            },
            err => {
                msg.logPlusConsole(err);
            }
        );
    }));
    context.subscriptions.push(commands.registerCommand('extension.qore-vscode.getProgram', config => {
        config.connection = currentConnection;  // resolve potential variable
        let pgms = execDebugAdapterCommand(config, 'pgmlist');
        let items: string[] = [];
        for (let key in pgms) {
            if (pgms[key].debugging) {
                items.push(pgms[key].scriptName);
            }
        }
        return window.showQuickPick(items, {
            canPickMany: false,
            placeHolder: t`ProgramPlaceHolder`,
        }).then(
            input => {
                if (!input) {
                    return;
                }
                msg.logPlusConsole("Got input in qore-vscode.getProgram command: " + input);
                // ignored for now
                // TODO tmandys has to explain why the input is ignored here
            },
            err => {
                msg.logPlusConsole(err);
            }
        );
    }));

    // debug configuration classes
    context.subscriptions.push(debug.registerDebugConfigurationProvider('qore', new QoreConfigurationProvider()));
    context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory('qore', new QoreDebugAdapterDescriptorFactory()));

    // debug events
    context.subscriptions.push(debug.onDidStartDebugSession(session => {
        if (session.type == "qore") {
            msg.info(t`SessionStarted ${session.configuration.program}`);
        }
    }));
    context.subscriptions.push(debug.onDidTerminateDebugSession(session => {
        if (session.type == "qore") {
            msg.info(t`SessionTerminated ${session.configuration.program}`);
        }
    }));
    context.subscriptions.push(debug.onDidChangeActiveDebugSession(session => {
        if (session !== undefined && session.type == "qore") {
            // msg.info(t`SessionChanged ${session.configuration.program}`);
        }
    }));
    context.subscriptions.push(debug.onDidReceiveDebugSessionCustomEvent(_event => {
        // ignored
    }));
}

//! returns true if the document is open in the editor and synchronized with QLS by the language client
function isSyncedWithQLS(uri: string): boolean {
    const target = Uri.parse(uri, true).toString();
    return workspace.textDocuments.some(doc => doc.uri.scheme === 'file' && doc.languageId === 'qore'
        && doc.uri.toString() === target);
}

function getNoDebugExportApi() {
    const api = {
        getQoreExecutable(): string {
            if (qoreLaunchCfg !== undefined) {
                return qoreLaunchCfg.getQoreExec();
            }
            return "qore";
        },

        async getDocumentSymbols(
            doc: QoreTextDocument,
            retType: DocumentSymbolReturnType = 'symbols',
            timeout = 8000,
        ): Promise<unknown> {
            if (!await qlsManager.waitUntilReady(timeout)) {
                return null;
            }
            return getDocumentSymbolsImpl(qlsManager, doc, retType, isSyncedWithQLS);
        },

        async isLangClientAvailable(timeout = 8000): Promise<boolean> {
            return qlsManager.waitUntilReady(timeout);
        }
    };
    return api;
}

function getExportApi() {
    const api = {
        execDebugAdapterCommand(configuration: DebugConfiguration, command: string): any {
            return execDebugAdapterCommand(configuration, command);
        },

        getQoreExecutable(): string {
            if (qoreLaunchCfg !== undefined) {
                return qoreLaunchCfg.getQoreExec();
            }
            return "qore";
        },

        getExecutableArguments(configuration: DebugConfiguration): string[] {
            return getExecutableArguments(configuration);
        },

        async getDocumentSymbols(
            doc: QoreTextDocument,
            retType: DocumentSymbolReturnType = 'symbols',
            timeout = 8000,
        ): Promise<unknown> {
            if (!await qlsManager.waitUntilReady(timeout)) {
                return null;
            }
            return getDocumentSymbolsImpl(qlsManager, doc, retType, isSyncedWithQLS);
        },

        async isLangClientAvailable(timeout = 8000): Promise<boolean> {
            return qlsManager.waitUntilReady(timeout);
        }
    };
    return api;
}

export async function activate(context: ExtensionContext) {
    // "Converting circular structure to JSON" when using JSON.stringify()
    // util.inspect() is proposed fix but it has another issue so limit depth
    //let util = require('util');
    //msg.logPlusConsole("QoreConfigurationProvider(context: "+ util.inspect(context, {depth: 1}));

    // register user commands for Qore and QLS
    registerCommands(context);

    // find out if QLS should run
    const useQLS = workspace.getConfiguration('qore').get<boolean>('useQLS', true);

    // launch QLS
    await doQLSLaunch(useQLS);

    context.subscriptions.push(workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('qore.executable')
                && !event.affectsConfiguration('qore.useQLS')
                && !event.affectsConfiguration(QLS_INIT_SETTINGS)) {
            return;
        }
        void (async () => {
            await qlsManager.stop();
            qoreLaunchCfg = undefined;
            const enabled = workspace.getConfiguration('qore').get<boolean>('useQLS', true);
            await doQLSLaunch(enabled);
        })().catch(error => msg.error(`Failed to reconfigure QLS: ${String(error)}`));
    }));

    // modify debugAdapter to "/qvscdbg-test" and executable to "bash" just in case the adapter silently won't start and check command it log
    debugAdapter = findScript(context.extensionPath, workspace.getConfiguration("qore").get("debugAdapter") || "qdbg-vsc-adapter");

    // check if debugger can be launched succesfully
    let debuggerOk: boolean = false;
    if (qoreLaunchCfg) {
        debuggerOk = checkDebuggerWithLaunchConfig(qoreLaunchCfg, debugAdapter);
    }
    if (!debuggerOk) {
        msg.logPlusConsole(t`DebugAdapterNotFound '${debugAdapter}'`);
        return getNoDebugExportApi();
    }

    pushDebugSubscriptions(context);

    // export public API-interface
    return getExportApi();
}

// called when the extension is deactivated
export function deactivate() {
    return qlsManager.stop();
}

// debugger stuff
class QoreConfigurationProvider implements DebugConfigurationProvider {
    /**
        Massage a debug configuration just before a debug session is being launched,
        e.g. add all missing attributes to the debug configuration.
        Commands ${command:xxx} are invoked by vscode substituteVariables() and value is substituted
     */
    resolveDebugConfiguration(_folder: WorkspaceFolder | undefined, config: DebugConfiguration, _token?: CancellationToken): ProviderResult<DebugConfiguration> {
        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = window.activeTextEditor;
            if (editor && editor.document.languageId === 'qore' ) {
                config.type = 'qore';
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;  // TODO: not yet supported
            }
        }
        currentConnection = config.connection;
        return config;
    }
}

function getExecutableArguments(configuration: DebugConfiguration): string[] {
    let args: string[] = [debugAdapter];
    if (configuration.request === 'attach') {
        if (!configuration.connection) {
            throw new Error(t`ConnectionNotSpecified`);
        }
        args.push("--attach");
        args.push(configuration.connection);
        if (!configuration.program) {
            throw new Error(t`ProgramNotSpecified`);
        }
        if (configuration.proxy) {
            args.push("--proxy");
            args.push(configuration.proxy);
        }
        if (typeof configuration.maxRedir !== "undefined") {
            args.push("--max-redir");
            args.push(configuration.maxRedir);
        }
        if (typeof configuration.timeout !== "undefined") {
            args.push("--timeout");
            args.push(configuration.timeout);
        }
        if (typeof configuration.connTimeout !== "undefined") {
            args.push("--conn-timeout");
            args.push(configuration.connTimeout);
        }
        if (typeof configuration.respTimeout !== "undefined") {
            args.push("--resp-timeout");
            args.push(configuration.respTimeout);
        }
        if (typeof configuration.headers !== "undefined") {
            for (let _hdr of configuration.headers) {
                if (typeof _hdr.name !== "string" || typeof _hdr.value !== "string") {
                    let hdrs: string = JSON.stringify(_hdr);
                    throw new Error(t`WrongHeader ${hdrs}`);
                }
                args.push("--header");
                args.push(_hdr.name + "=" + _hdr.value);
            }
        }
    } else {
        if (!configuration.program) {
            throw new Error(t`ProgramFileNotSpecified`);
        }
        if (configuration.define) {
            for (let _s in configuration.define) {
                args.push("--define");
                args.push(configuration.define[_s]);
            }
        }
        if (configuration.parseOptions) {
            for (let _s in configuration.parseOptions) {
                args.push("--set-parse-option");
                args.push(configuration.parseOptions[_s]);
            }
        }
        if (configuration.timeZone) {
            args.push("--time-zone");
            args.push(configuration.timeZone);
        }
    }
    if (configuration.fullException) {
        args.push("--full-exception");
    }
    if (configuration.logFilename) {
        args.push("--logger-filename");
        args.push(configuration.logFilename);
    }
    if (configuration.appendToLog) {
        args.push("--append-to-log");
    }
    if (configuration.verbosity > 0) {
        for (let i=0; i<configuration.verbosity; i++) {
            args.push("-v");
        }
    }
    return args;
}

class QoreDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: DebugSession, _executable: DebugAdapterExecutable | undefined): ProviderResult<DebugAdapterDescriptor> {
        let s: string;
        if (session.configuration.request == "attach") {
            s = t`Connecting ${session.configuration.connection} ${session.configuration.program}`;
        } else {
            s = t`Launching ${session.configuration.program}`;
        }
        msg.info(s);
        let args: string[] = getExecutableArguments(session.configuration);
        if (qoreLaunchCfg !== undefined) {
            return new DebugAdapterExecutable(
                qoreLaunchCfg.getQoreExec(),
                args,
                qoreLaunchCfg.getLaunchOptions()
            );
        } else {
            throw new Error("Qore environment is not setup properly. Cannot launch Qore debugger.");
        }
    }
}

/**
 * Execute adapter command and return parsed result. Use "qdbg-vsc-adapter -h" to see list of commands
 */
export function execDebugAdapterCommand(configuration: DebugConfiguration, command: string): any {
    if (!debugAdapter) {
        throw new Error(t`DebuggingIsDisabled`);
    }
    if (!command) {
        throw new Error(t`CommandNotSpecified`);
    }
    let args: string[] = getExecutableArguments(configuration);
    args.push("-X");
    args.push(command);

    let results;
    if (qoreLaunchCfg !== undefined) {
        results = spawnSync(
            qoreLaunchCfg.getQoreExec(),
            args,
            qoreLaunchCfg.getLaunchOptions()
        );
    } else {
        throw new Error("Qore environment is not setup properly. Cannot launch Qore debugger.");
    }

    if (results.status != 0) {
        throw new Error(results.stderr.toString());
    }
    return JSON.parse(results.stdout.toString()).result;
}
