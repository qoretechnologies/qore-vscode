/* serverOptions.ts Copyright 2026 Qore Technologies, s.r.o. */

import { ServerOptions } from 'vscode-languageclient/node';
import { QoreLaunchOptions } from './QoreLaunchConfig';

//! language server options
export function getServerOptions(
    qoreExecutable: string,
    serverArgs: string[],
    launchOptions?: QoreLaunchOptions,
): ServerOptions {
    return {
        run: {
            command: qoreExecutable,
            args: serverArgs,
            options: launchOptions,
        },
        debug: {
            command: qoreExecutable,
            args: serverArgs,
            options: launchOptions,
        },
    };
}
