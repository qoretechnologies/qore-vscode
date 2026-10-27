/* qore3QLS.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {ChildProcessWithoutNullStreams, spawn, spawnSync} from 'node:child_process';
import {test} from 'node:test';

import {isQore3OrNewer} from '../../qore3';
import {getServerArgs} from '../../serverArgs';
import {parseShowReferencesArgs, SHOW_REFERENCES_COMMAND} from '../../showReferences';

interface JsonRpcResponse {
    id: number;
    result?: unknown;
    error?: unknown;
}

class LspConnection {
    private buffer = Buffer.alloc(0);
    private readonly responses = new Map<number, (response: JsonRpcResponse) => void>();
    private stderr = '';

    constructor(readonly process: ChildProcessWithoutNullStreams) {
        process.stdout.on('data', chunk => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.parseMessages();
        });
        process.stderr.on('data', chunk => {
            this.stderr += chunk.toString();
        });
    }

    request(id: number, method: string, params: unknown): Promise<JsonRpcResponse> {
        const response = new Promise<JsonRpcResponse>((resolveResponse, reject) => {
            const timer = setTimeout(() => {
                this.responses.delete(id);
                reject(new Error(`QLS did not respond to ${method}; stderr: ${this.stderr}`));
            }, 30000);
            this.responses.set(id, value => {
                clearTimeout(timer);
                resolveResponse(value);
            });
        });
        this.send({jsonrpc: '2.0', id, method, params});
        return response;
    }

    notification(method: string, params: unknown): void {
        this.send({jsonrpc: '2.0', method, params});
    }

    private send(message: unknown): void {
        const body = Buffer.from(JSON.stringify(message));
        this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        this.process.stdin.write(body);
    }

    private parseMessages(): void {
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }
            const header = this.buffer.subarray(0, headerEnd).toString('ascii');
            const lengthMatch = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
            assert.ok(lengthMatch, `invalid QLS header: ${header}`);
            const contentLength = Number(lengthMatch[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + contentLength) {
                return;
            }
            const body = this.buffer.subarray(bodyStart, bodyStart + contentLength);
            this.buffer = this.buffer.subarray(bodyStart + contentLength);
            const message = JSON.parse(body.toString('utf8')) as JsonRpcResponse;
            if (typeof message.id === 'number') {
                const resolveResponse = this.responses.get(message.id);
                if (resolveResponse) {
                    this.responses.delete(message.id);
                    resolveResponse(message);
                }
            }
        }
    }
}

test('Qore 3 launches its integrated QLS module and serves LSP requests', async () => {
    const qoreExecutable = process.env.QORE_TEST_EXECUTABLE;
    assert.ok(qoreExecutable, 'QORE_TEST_EXECUTABLE must name the Qore 3 binary under test');

    const version = spawnSync(qoreExecutable, ['--short-version'], {
        encoding: 'utf8',
        env: process.env,
        shell: false,
    });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(isQore3OrNewer(version.stdout), true, `unsupported Qore version: ${version.stdout}`);

    const child = spawn(qoreExecutable, getServerArgs(), {
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const connection = new LspConnection(child);
    try {
        const initialized = await connection.request(1, 'initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: {},
            workspaceFolders: null,
        });
        assert.equal(initialized.error, undefined);
        const capabilities = (initialized.result as {capabilities: {[name: string]: unknown}}).capabilities;
        assert.equal(capabilities.documentSymbolProvider, true);
        assert.ok(capabilities.completionProvider);
        assert.ok(capabilities.signatureHelpProvider);

        connection.notification('initialized', {});
        const uri = 'file:///tmp/qore-vscode-qore3-integration.qr';
        connection.notification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: 'qore',
                version: 1,
                text: '%modern\ntypedef int UserId;\n',
            },
        });
        const symbols = await connection.request(2, 'textDocument/documentSymbol', {
            textDocument: {uri},
        });
        assert.equal(symbols.error, undefined);
        const symbolList = symbols.result as Array<{
            name: string;
            kind: number;
            location: {uri: string; range: unknown};
        }>;
        assert.equal(symbolList.length, 1);
        assert.equal(symbolList[0].name, 'UserId');
        assert.equal(symbolList[0].kind, 26, 'typedefs use the LSP TypeParameter symbol kind');
        assert.equal(symbolList[0].location.uri, uri);
        assert.deepEqual(symbolList[0].location.range, {
            start: {line: 1, character: 0},
            end: {line: 1, character: 19},
        });

        // reference-count code lenses run the command that the extension registers
        const lensUri = 'file:///tmp/qore-vscode-qore3-lens.qr';
        connection.notification('textDocument/didOpen', {
            textDocument: {
                uri: lensUri,
                languageId: 'qore',
                version: 1,
                text: 'int sub foo() {\n    return 1;\n}\nfoo();\n',
            },
        });
        const lenses = await connection.request(4, 'textDocument/codeLens', {textDocument: {uri: lensUri}});
        assert.equal(lenses.error, undefined);
        const lensList = lenses.result as Array<{data: {name: string}}>;
        assert.deepEqual(lensList.map(lens => lens.data.name), ['foo']);
        const resolved = await connection.request(5, 'codeLens/resolve', lensList[0]);
        assert.equal(resolved.error, undefined);
        const command = (resolved.result as {command: {command: string; arguments: unknown[]}}).command;
        assert.equal(command.command, SHOW_REFERENCES_COMMAND);
        assert.equal(parseShowReferencesArgs(command.arguments)?.uri, lensUri,
            'the extension can parse the lens command arguments');

        const shutdown = await connection.request(3, 'shutdown', null);
        assert.equal(shutdown.error, undefined);
        connection.notification('exit', null);
        await new Promise<void>((resolveExit, reject) => {
            const timer = setTimeout(() => reject(new Error('QLS did not exit after shutdown')), 10000);
            child.once('exit', code => {
                clearTimeout(timer);
                assert.equal(code, 0);
                resolveExit();
            });
        });
    } finally {
        if (child.exitCode === null) {
            child.kill();
        }
    }
});
