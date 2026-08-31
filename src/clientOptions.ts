/* clientOptions.ts Copyright 2026 Qore Technologies, s.r.o. */

import { LanguageClientOptions } from 'vscode-languageclient/node';
import { workspace } from 'vscode';
import { QORE_SOURCE_EXTENSIONS } from './qore3';

//! options to control the language client
export function getClientOptions(): LanguageClientOptions {
    const clientOptions: LanguageClientOptions = {
        // docs regarding documentSelector:
        // https://code.visualstudio.com/Docs/extensionAPI/vscode-api#DocumentSelector
        // https://code.visualstudio.com/Docs/extensionAPI/vscode-api#DocumentFilter
        documentSelector: [{scheme: 'file', language: 'qore'}],
        synchronize: {
            // synchronize the setting section 'qore' to the server
            configurationSection: 'qore',
            // notify the server about file changes to qore files contained in the workspace
            fileEvents: QORE_SOURCE_EXTENSIONS.map(ext =>
                workspace.createFileSystemWatcher(`**/*.${ext}`))
        }
    };
    return clientOptions;
}
