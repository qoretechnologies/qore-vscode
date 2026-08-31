/* QLSManager.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {LanguageClientOptions, ServerOptions} from 'vscode-languageclient/node';

import {QLSClient, QLSManager, QLSManagerDependencies} from '../../QLSManager';
import {QoreLaunchConfig} from '../../QoreLaunchConfig';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
    let resolvePromise: (value: T) => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {promise, resolve: resolvePromise, reject: rejectPromise};
}

class FakeClient implements QLSClient {
    startCount = 0;
    stopCount = 0;
    readonly requests: Array<{method: string; params: unknown}> = [];
    readonly notifications: Array<{method: string; params: unknown}> = [];

    constructor(
        private readonly startResult: () => Promise<void> = async () => undefined,
        private readonly stopResult: () => Promise<void> = async () => undefined,
    ) {}

    async start(): Promise<void> {
        ++this.startCount;
        return this.startResult();
    }

    async stop(): Promise<void> {
        ++this.stopCount;
        return this.stopResult();
    }

    async sendRequest(method: string, params: unknown): Promise<unknown> {
        this.requests.push({method, params});
        return {method, params};
    }

    async sendNotification(method: string, params: unknown): Promise<void> {
        this.notifications.push({method, params});
    }
}

function managerFor(clients: FakeClient[]): {manager: QLSManager; logs: string[]; launches: string[][]} {
    const logs: string[] = [];
    const launches: string[][] = [];
    let index = 0;
    const dependencies: QLSManagerDependencies = {
        createClient(): QLSClient {
            const client = clients[index++];
            assert.ok(client, 'a fake client must be available for each launch');
            return client;
        },
        getClientOptions(): LanguageClientOptions {
            return {} as LanguageClientOptions;
        },
        getServerOptions(_executable, args): ServerOptions {
            launches.push([...args]);
            return {} as ServerOptions;
        },
        log(message): void {
            logs.push(message);
        },
    };
    return {manager: new QLSManager(dependencies), logs, launches};
}

function managerWithFailingLogger(client: FakeClient): QLSManager {
    return new QLSManager({
        createClient(): QLSClient {
            return client;
        },
        getClientOptions(): LanguageClientOptions {
            return {} as LanguageClientOptions;
        },
        getServerOptions(): ServerOptions {
            return {} as ServerOptions;
        },
        log(): void {
            throw new Error('output channel disposed');
        },
    });
}

const config = new QoreLaunchConfig('/opt/qore/bin/qore');

describe('QLSManager', () => {
    it('becomes ready only after language-client initialization completes', async () => {
        const gate = deferred<void>();
        const client = new FakeClient(() => gate.promise);
        const {manager, launches} = managerFor([client]);

        const starting = manager.startWithLaunchConfig(config);
        assert.equal(manager.started(), true);
        assert.equal(manager.languageClientReady(), false);
        const ready = manager.waitUntilReady(1000);

        gate.resolve(undefined);
        await starting;
        assert.equal(await ready, true);
        assert.equal(manager.languageClientReady(), true);
        assert.equal(client.startCount, 1);
        assert.deepEqual(launches, [['-l', 'QLS', '-e', 'QLS::QLSServer server(); exit(server.main());']]);
    });

    it('uses a single readiness timeout rather than polling', async () => {
        const gate = deferred<void>();
        const client = new FakeClient(() => gate.promise);
        const {manager} = managerFor([client]);
        const starting = manager.startWithLaunchConfig(config);

        assert.equal(await manager.waitUntilReady(1), false);
        assert.equal(client.startCount, 1);
        gate.resolve(undefined);
        await starting;
        assert.equal(await manager.waitUntilReady(1), true);
    });

    it('coalesces concurrent starts and stops', async () => {
        const client = new FakeClient();
        const {manager} = managerFor([client]);
        await Promise.all([
            manager.startWithLaunchConfig(config),
            manager.startWithLaunchConfig(config),
        ]);
        assert.equal(client.startCount, 1);

        await Promise.all([manager.stop(), manager.stop()]);
        assert.equal(client.stopCount, 1);
        assert.equal(manager.stopped(), true);
    });

    it('stops deterministically when requested during startup', async () => {
        const gate = deferred<void>();
        const client = new FakeClient(() => gate.promise);
        const {manager} = managerFor([client]);
        const starting = manager.startWithLaunchConfig(config);
        const stopping = manager.stop();

        gate.resolve(undefined);
        await Promise.all([starting, stopping]);
        assert.equal(client.startCount, 1);
        assert.equal(client.stopCount, 1);
        assert.equal(manager.stopped(), true);
        assert.equal(manager.languageClientReady(), false);
    });

    it('serializes a restart requested during shutdown', async () => {
        const stopGate = deferred<void>();
        const first = new FakeClient(async () => undefined, () => stopGate.promise);
        const second = new FakeClient();
        const {manager} = managerFor([first, second]);
        await manager.startWithLaunchConfig(config);

        const stopping = manager.stop();
        const restarting = manager.startWithLaunchConfig(config);
        assert.equal(second.startCount, 0);
        stopGate.resolve(undefined);
        await Promise.all([stopping, restarting]);

        assert.equal(first.stopCount, 1);
        assert.equal(second.startCount, 1);
        assert.equal(manager.languageClientReady(), true);
    });

    it('cleans up a failed start and allows a retry', async () => {
        const failed = new FakeClient(async () => {
            throw new Error('initialize failed');
        });
        const recovered = new FakeClient();
        const {manager} = managerFor([failed, recovered]);

        await assert.rejects(manager.startWithLaunchConfig(config), /initialize failed/);
        assert.equal(failed.stopCount, 1);
        assert.equal(manager.stopped(), true);
        assert.equal(await manager.waitUntilReady(0), false);

        await manager.startWithLaunchConfig(config);
        assert.equal(recovered.startCount, 1);
        assert.equal(manager.languageClientReady(), true);
    });

    it('resets its state even when client shutdown fails', async () => {
        const client = new FakeClient(async () => undefined, async () => {
            throw new Error('shutdown failed');
        });
        const {manager} = managerFor([client]);
        await manager.startWithLaunchConfig(config);

        await assert.rejects(manager.stop(), /shutdown failed/);
        assert.equal(manager.stopped(), true);
        assert.equal(manager.languageClientReady(), false);
    });

    it('does not let output-channel failures corrupt lifecycle state', async () => {
        const client = new FakeClient();
        const manager = managerWithFailingLogger(client);
        await manager.startWithLaunchConfig(config);
        assert.equal(manager.languageClientReady(), true);
        await manager.stop();
        assert.equal(client.stopCount, 1);
        assert.equal(manager.stopped(), true);
    });

    it('sends protocol traffic only through a ready client', async () => {
        const client = new FakeClient();
        const {manager} = managerFor([client]);
        assert.equal(await manager.sendRequest('before/start', {}), null);
        assert.equal(await manager.sendNotification('before/start', {}), false);

        await manager.startWithLaunchConfig(config);
        assert.deepEqual(await manager.sendRequest('test/request', {id: 1}), {
            method: 'test/request',
            params: {id: 1},
        });
        assert.equal(await manager.sendNotification('test/notification', {id: 2}), true);
        assert.deepEqual(client.requests, [{method: 'test/request', params: {id: 1}}]);
        assert.deepEqual(client.notifications, [{method: 'test/notification', params: {id: 2}}]);
    });
});
