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
    //! called when a request is received; the request completes when the returned promise resolves
    onRequest: () => Promise<void> = async () => {};

    constructor(
        private readonly failNotification: string | undefined = undefined,
        private readonly failRequest = false,
    ) {}

    async start(): Promise<void> {}
    async stop(): Promise<void> {}

    async sendNotification(method: string, params: unknown): Promise<void> {
        this.calls.push({kind: 'notification', method, params});
        if (this.failNotification === method) {
            throw new Error('notification failed');
        }
    }

    async sendRequest(method: string, params: unknown): Promise<unknown> {
        this.calls.push({kind: 'request', method, params});
        await this.onRequest();
        if (this.failRequest) {
            throw new Error('request failed');
        }
        return [{name: 'UserId', kind: 26}];
    }

    methods(): string[] {
        return this.calls.map(call => call.method);
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

    it('opens the document for the request and closes it afterwards', async () => {
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
            {
                kind: 'notification',
                method: 'textDocument/didClose',
                params: {
                    textDocument: {uri: 'file:///tmp/project/source%20file.qr'},
                },
            },
        ]);
    });

    it('queries documents open in the editor without opening or closing them', async () => {
        const client = new ProtocolClient();
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));
        const checked: string[] = [];
        const result = await getDocumentSymbolsImpl(manager, document, undefined, uri => {
            checked.push(uri);
            return true;
        });

        assert.deepEqual(result, [{name: 'UserId', kind: 26}]);
        assert.deepEqual(checked, ['file:///tmp/project/source%20file.qr']);
        assert.deepEqual(client.methods(), ['textDocument/documentSymbol']);
    });

    it('closes the document when the symbol request fails', async () => {
        const client = new ProtocolClient(undefined, true);
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));

        assert.equal(await getDocumentSymbolsImpl(manager, document), null);
        assert.deepEqual(client.methods(),
            ['textDocument/didOpen', 'textDocument/documentSymbol', 'textDocument/didClose']);
    });

    it('returns the symbols when closing the document fails', async () => {
        const client = new ProtocolClient('textDocument/didClose');
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));

        assert.deepEqual(await getDocumentSymbolsImpl(manager, document), [{name: 'UserId', kind: 26}]);
        assert.deepEqual(client.methods(),
            ['textDocument/didOpen', 'textDocument/documentSymbol', 'textDocument/didClose']);
    });

    it('serializes concurrent requests for the same document', async () => {
        const client = new ProtocolClient();
        const manager = managerFor(client);
        await manager.startWithLaunchConfig(new QoreLaunchConfig('qore'));
        let release: () => void = () => {};
        const firstRequestBlocked = new Promise<void>(resolveBlock => {
            release = resolveBlock;
        });
        let requests = 0;
        client.onRequest = () => ++requests === 1 ? firstRequestBlocked : Promise.resolve();

        const first = getDocumentSymbolsImpl(manager, document);
        const second = getDocumentSymbolsImpl(manager, document);
        const other = getDocumentSymbolsImpl(manager, {...document, uri: '/tmp/project/other.q'});
        // the other document is not blocked by the first request
        assert.deepEqual(await other, [{name: 'UserId', kind: 26}]);
        release();
        assert.deepEqual(await first, [{name: 'UserId', kind: 26}]);
        assert.deepEqual(await second, [{name: 'UserId', kind: 26}]);

        const sourceCalls = client.calls
            .filter(call => JSON.stringify(call.params).includes('source%20file'))
            .map(call => call.method);
        assert.deepEqual(sourceCalls, [
            'textDocument/didOpen', 'textDocument/documentSymbol', 'textDocument/didClose',
            'textDocument/didOpen', 'textDocument/documentSymbol', 'textDocument/didClose',
        ], 'the second request opens the document after the first one closed it');
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

        const failedClient = new ProtocolClient('textDocument/didOpen');
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
