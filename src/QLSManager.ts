/* QLSManager.ts Copyright 2026 Qore Technologies, s.r.o. */

import type {CancellationToken} from 'vscode';
import type {LanguageClientOptions, ServerOptions} from 'vscode-languageclient/node';

import {QoreLaunchConfig} from './QoreLaunchConfig';
import {getServerArgs} from './serverArgs';

export interface QLSClient {
    start(): Promise<void>;
    stop(): Promise<void>;
    sendRequest(method: string, params: unknown, token?: CancellationToken): Promise<unknown>;
    sendNotification(method: string, params: unknown): Promise<void>;
}

export interface QLSManagerDependencies {
    createClient(serverOptions: ServerOptions, clientOptions: LanguageClientOptions): QLSClient;
    getClientOptions(): LanguageClientOptions;
    getServerOptions(qoreExecutable: string, args: string[], config: QoreLaunchConfig): ServerOptions;
    log(message: string): void;
}

function defaultDependencies(): QLSManagerDependencies {
    return {
        createClient(serverOptions, clientOptions): QLSClient {
            // Lazy imports keep the lifecycle independently unit-testable outside VS Code.
            const {LanguageClient} = require('vscode-languageclient/node');
            return new LanguageClient(
                'qls',
                'Qore Language Server',
                serverOptions,
                clientOptions,
            );
        },
        getClientOptions(): LanguageClientOptions {
            return require('./clientOptions').getClientOptions();
        },
        getServerOptions(qoreExecutable, args, config): ServerOptions {
            return require('./serverOptions').getServerOptions(
                qoreExecutable,
                args,
                config.getLaunchOptions(),
            );
        },
        log(message): void {
            require('./qore_message').logPlusConsole(message);
        },
    };
}

export class QLSManager {
    private languageClient: QLSClient | undefined;
    private ready = false;
    private startPromise: Promise<void> | undefined;
    private stopPromise: Promise<void> | undefined;
    private readonly dependencies: QLSManagerDependencies;

    constructor(dependencies: QLSManagerDependencies = defaultDependencies()) {
        this.dependencies = dependencies;
    }

    started(): boolean {
        return this.languageClient !== undefined || this.startPromise !== undefined;
    }

    stopped(): boolean {
        return !this.started();
    }

    languageClientReady(): boolean {
        return this.ready;
    }

    private log(message: string): void {
        try {
            this.dependencies.log(message);
        } catch (_error) {
            // Logging must never change the language-client lifecycle.
        }
    }

    async waitUntilReady(timeoutMs = 8000): Promise<boolean> {
        if (this.ready) {
            return true;
        }
        const pendingStart = this.startPromise;
        if (!pendingStart || timeoutMs <= 0) {
            return false;
        }

        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                pendingStart.then(() => this.ready, () => false),
                new Promise<boolean>(resolve => {
                    timer = setTimeout(() => resolve(false), timeoutMs);
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    async startWithLaunchConfig(config: QoreLaunchConfig): Promise<void> {
        if (this.stopPromise) {
            await this.stopPromise;
            return this.startWithLaunchConfig(config);
        }
        if (this.ready) {
            return;
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        const qoreExecutable = config.getQoreExec();
        const args = getServerArgs();
        const serverOptions = this.dependencies.getServerOptions(qoreExecutable, args, config);
        const clientOptions = this.dependencies.getClientOptions();
        const client = this.dependencies.createClient(serverOptions, clientOptions);
        this.log(`Starting QLS with Qore executable: ${qoreExecutable}`);
        this.languageClient = client;

        const operation = (async () => {
            try {
                await client.start();
                if (this.languageClient === client && !this.stopPromise) {
                    this.ready = true;
                }
                this.log('QLS language client started');
            } catch (error) {
                if (this.languageClient === client) {
                    this.languageClient = undefined;
                    this.ready = false;
                }
                try {
                    await client.stop();
                } catch (stopError) {
                    this.log(`Failed cleaning up QLS after start failure: ${String(stopError)}`);
                }
                throw error;
            }
        })();
        this.startPromise = operation;
        try {
            await operation;
        } finally {
            if (this.startPromise === operation) {
                this.startPromise = undefined;
            }
        }
    }

    async stop(): Promise<void> {
        if (this.stopPromise) {
            return this.stopPromise;
        }
        if (!this.languageClient && !this.startPromise) {
            return;
        }

        this.ready = false;
        const pendingStart = this.startPromise;
        const operation = (async () => {
            if (pendingStart) {
                try {
                    await pendingStart;
                } catch (_error) {
                    return;
                }
            }

            const client = this.languageClient;
            if (!client) {
                return;
            }
            this.log('Stopping QLS language client');
            try {
                await client.stop();
                this.log('QLS language client stopped');
            } finally {
                if (this.languageClient === client) {
                    this.languageClient = undefined;
                }
                this.ready = false;
            }
        })();
        this.stopPromise = operation;
        try {
            await operation;
        } finally {
            if (this.stopPromise === operation) {
                this.stopPromise = undefined;
            }
        }
    }

    sendRequest(method: string, params: unknown, token?: CancellationToken): Promise<unknown> {
        if (!this.ready || !this.languageClient) {
            return Promise.resolve(null);
        }
        return this.languageClient.sendRequest(method, params, token);
    }

    async sendNotification(method: string, params: unknown): Promise<boolean> {
        if (!this.ready || !this.languageClient) {
            return false;
        }
        await this.languageClient.sendNotification(method, params);
        return true;
    }
}
