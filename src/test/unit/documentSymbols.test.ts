/* documentSymbols.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Uri} from 'vscode';
import type {LanguageClientOptions, ServerOptions} from 'vscode-languageclient/node';

import {
    getDocumentSymbolsImpl,
    normalizeDocumentUri,
    QoreTextDocument,
} from '../../documentSymbols';
import {QLSClient, QLSManager, QLSManagerDependencies} from '../../QLSManager';
import {QoreLaunchConfig} from '../../QoreLaunchConfig';

class ProtocolClient implements QLSClient {
    readonly calls: Array<{kind: 'notification' | 'request'; method: string; params: unknown}> = [];

    constructor(private readonly failNotification = false) {}

    async start(): Promise<void> {}
    async stop(): Promise<void> {}

    async sendNotification(method: string, params: unknown): Promise<void> {
        this.calls.push({kind: 'notification', method, params});
        if (this.failNotification) {
            throw new Error('notification failed');
        }
    }

    async sendRequest(method: string, params: unknown): Promise<unknown> {
        this.calls.push({kind: 'request', method, params});
        return [{name: 'UserId', kind: 26}];
    }
}

function managerFor(client: ProtocolClient): QLSManager {
    const dependencies: QLSManagerDependencies = {
        createClient(): QLSClient {
            return client;
        },
        getClientOptions(): LanguageClientOptions {
            return {} as LanguageClientOptions;
        },
        getServerOptions(): ServerOptions {
            return {} as ServerOptions;
        },
        log(): void {},
    };
    return new QLSManager(dependencies);
}

const document: QoreTextDocument = {
    uri: '/tmp/project/source file.qr',
    text: '%modern\ntypedef int UserId;\n',
    languageId: 'qore',
    version: 4,
};

describe('document symbol bridge', () => {
    it('normalizes paths and URI objects without hand-built file prefixes', () => {
        assert.equal(
            normalizeDocumentUri('/tmp/project/source file.qr'),
            'file:///tmp/project/source%20file.qr',
        );
        assert.equal(normalizeDocumentUri('file:/tmp/test.q'), 'file:///tmp/test.q');
        const uri = {toString: () => 'untitled:Qore-1'} as Uri;
        assert.equal(normalizeDocumentUri(uri), 'untitled:Qore-1');
    });

    it('opens the document with a notification before requesting symbols', async () => {
        const client = new ProtocolClient();
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));

        assert.deepEqual(await getDocumentSymbolsImpl(manager, document, 'node_info'), [
            {name: 'UserId', kind: 26},
        ]);
        assert.deepEqual(client.calls, [
            {
                kind: 'notification',
                method: 'textDocument/didOpen',
                params: {
                    textDocument: {
                        uri: 'file:///tmp/project/source%20file.qr',
                        text: document.text,
                        languageId: 'qore',
                        version: 4,
                    },
                },
            },
            {
                kind: 'request',
                method: 'textDocument/documentSymbol',
                params: {
                    textDocument: {uri: 'file:///tmp/project/source%20file.qr'},
                    retType: 'node_info',
                },
            },
        ]);
    });

    it('omits the optional return type for standard document symbols', async () => {
        const client = new ProtocolClient();
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));
        await getDocumentSymbolsImpl(manager, document);

        assert.deepEqual(client.calls[1].params, {
            textDocument: {uri: 'file:///tmp/project/source%20file.qr'},
        });
    });

    it('returns null before readiness and on asynchronous protocol failures', async () => {
        const stoppedClient = new ProtocolClient();
        const stoppedManager = managerFor(stoppedClient);
        assert.equal(await getDocumentSymbolsImpl(stoppedManager, document), null);
        assert.deepEqual(stoppedClient.calls, []);

        const failedClient = new ProtocolClient(true);
        const failedManager = managerFor(failedClient);
        await failedManager.startWithLaunchConfig(new QoreLaunchConfig('qore'));
        assert.equal(await getDocumentSymbolsImpl(failedManager, document), null);
        assert.equal(failedClient.calls.length, 1, 'the request is not sent after didOpen fails');

        const invalidDocument = {
            ...document,
            uri: {toString: () => { throw new Error('invalid URI'); }} as unknown as Uri,
        };
        assert.equal(await getDocumentSymbolsImpl(failedManager, invalidDocument), null);
    });
});
