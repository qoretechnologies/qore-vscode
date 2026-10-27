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

//! pending symbol requests per URI; requests for the same URI are serialized so that one request cannot close a
//! document that another request has opened
const pendingByUri = new Map<string, Promise<unknown>>();

//! returns the symbols of a document from QLS
/** Documents open in the editor are already synchronized with QLS by the language client and are queried
    directly.  Other documents are opened in QLS for the request and closed again afterwards, so that QLS does not
    keep their syntax trees and their workspace index is restored.

    @param isOpenInEditor returns true if the given document URI is open in the editor
    @return the symbols, or null if QLS is not ready or the request failed
*/
export async function getDocumentSymbolsImpl(
    qlsManager: QLSManager,
    doc: QoreTextDocument,
    retType?: DocumentSymbolReturnType,
    isOpenInEditor: (uri: string) => boolean = () => false,
): Promise<unknown> {
    if (!qlsManager.languageClientReady()) {
        return null;
    }

    let uri: string;
    try {
        uri = normalizeDocumentUri(doc.uri);
    } catch (_error) {
        return null;
    }

    const previous = pendingByUri.get(uri) ?? Promise.resolve();
    const current = previous.then(() => requestDocumentSymbols(qlsManager, doc, uri, retType, isOpenInEditor));
    pendingByUri.set(uri, current);
    try {
        return await current;
    } finally {
        if (pendingByUri.get(uri) === current) {
            pendingByUri.delete(uri);
        }
    }
}

async function requestDocumentSymbols(
    qlsManager: QLSManager,
    doc: QoreTextDocument,
    uri: string,
    retType: DocumentSymbolReturnType | undefined,
    isOpenInEditor: (uri: string) => boolean,
): Promise<unknown> {
    const params = {
        textDocument: {uri},
        ...(retType ? {retType} : {}),
    };
    try {
        if (isOpenInEditor(uri)) {
            return await qlsManager.sendRequest('textDocument/documentSymbol', params);
        }
        const textDocument = {
            uri,
            text: doc.text,
            languageId: doc.languageId,
            version: doc.version,
        };
        if (!await qlsManager.sendNotification('textDocument/didOpen', {textDocument})) {
            return null;
        }
        try {
            return await qlsManager.sendRequest('textDocument/documentSymbol', params);
        } finally {
            try {
                await qlsManager.sendNotification('textDocument/didClose', {textDocument: {uri}});
            } catch (_error) {
                // the symbols are still valid; a failed notification means that the connection is closing
            }
        }
    } catch (_error) {
        return null;
    }
}
