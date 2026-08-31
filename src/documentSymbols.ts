/* documentSymbols.ts Copyright 2026 Qore Technologies, s.r.o. */

import {isAbsolute, resolve} from 'path';
import {pathToFileURL} from 'url';
import type {Uri} from 'vscode';

import {QLSManager} from './QLSManager';

export type DocumentSymbolReturnType = 'symbols' | 'node_info';

export interface QoreTextDocument {
    uri: string | Uri;
    text: string;
    languageId: string;
    version: number;
}

export function normalizeDocumentUri(uri: string | Uri): string {
    if (typeof uri !== 'string') {
        return uri.toString();
    }
    if (isAbsolute(uri) || /^[A-Za-z]:[\\/]/.test(uri)) {
        return pathToFileURL(resolve(uri)).toString();
    }
    try {
        return new URL(uri).toString();
    } catch (_error) {
        return pathToFileURL(resolve(uri)).toString();
    }
}

export async function getDocumentSymbolsImpl(
    qlsManager: QLSManager,
    doc: QoreTextDocument,
    retType?: DocumentSymbolReturnType,
): Promise<unknown> {
    if (!qlsManager.languageClientReady()) {
        return null;
    }

    try {
        const uri = normalizeDocumentUri(doc.uri);
        const textDocument = {
            uri,
            text: doc.text,
            languageId: doc.languageId,
            version: doc.version,
        };
        const sent = await qlsManager.sendNotification('textDocument/didOpen', {textDocument});
        if (!sent) {
            return null;
        }
        return await qlsManager.sendRequest('textDocument/documentSymbol', {
            textDocument: {uri},
            ...(retType ? {retType} : {}),
        });
    } catch (_error) {
        return null;
    }
}
