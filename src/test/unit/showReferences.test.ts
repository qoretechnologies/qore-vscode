/* showReferences.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
    parseShowReferencesArgs,
    SHOW_REFERENCES_COMMAND,
    showReferences,
    ShowReferencesApi,
} from '../../showReferences';

interface FakeUri {
    uri: string;
}

interface FakePosition {
    line: number;
    character: number;
}

class FakeApi implements ShowReferencesApi<FakeUri, FakePosition> {
    readonly commands: Array<{command: string; args: unknown[]}> = [];
    readonly warnings: string[] = [];

    constructor(private readonly locations: unknown) {}

    parseUri(uri: string): FakeUri {
        return {uri};
    }

    makePosition(line: number, character: number): FakePosition {
        return {line, character};
    }

    async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
        this.commands.push({command, args});
        return command === 'vscode.executeReferenceProvider' ? this.locations : undefined;
    }

    showWarning(message: string): void {
        this.warnings.push(message);
    }
}

describe('QLS code lens references command', () => {
    it('uses the command name that QLS sends in reference-count code lenses', () => {
        assert.equal(SHOW_REFERENCES_COMMAND, 'qls.showReferences');
    });

    it('parses the URI and position arguments sent by QLS', () => {
        assert.deepEqual(parseShowReferencesArgs(['file:///src/a.q', {line: 3, character: 7}]),
            {uri: 'file:///src/a.q', line: 3, character: 7});
    });

    it('rejects invalid arguments', () => {
        const invalid: unknown[][] = [
            [],
            ['file:///src/a.q'],
            ['', {line: 0, character: 0}],
            [42, {line: 0, character: 0}],
            ['file:///src/a.q', null],
            ['file:///src/a.q', {line: -1, character: 0}],
            ['file:///src/a.q', {line: 1.5, character: 0}],
            ['file:///src/a.q', {line: '1', character: 0}],
            ['file:///src/a.q', {line: 1}],
        ];
        for (const args of invalid) {
            assert.equal(parseShowReferencesArgs(args), undefined, JSON.stringify(args));
        }
    });

    it('requests the references and shows them at the lens position', async () => {
        const api = new FakeApi(['loc1', 'loc2']);
        assert.equal(await showReferences(api, 'file:///src/a.q', {line: 3, character: 7}), true);
        const uri = {uri: 'file:///src/a.q'};
        const position = {line: 3, character: 7};
        assert.deepEqual(api.commands, [
            {command: 'vscode.executeReferenceProvider', args: [uri, position]},
            {command: 'editor.action.showReferences', args: [uri, position, ['loc1', 'loc2']]},
        ]);
        assert.deepEqual(api.warnings, []);
    });

    it('shows an empty reference list when the provider returns nothing', async () => {
        const api = new FakeApi(undefined);
        assert.equal(await showReferences(api, 'file:///src/a.q', {line: 0, character: 0}), true);
        assert.deepEqual(api.commands[1].args[2], []);
    });

    it('warns and runs no commands for invalid arguments', async () => {
        const api = new FakeApi(['loc1']);
        assert.equal(await showReferences(api, 'file:///src/a.q'), false);
        assert.deepEqual(api.commands, []);
        assert.equal(api.warnings.length, 1);
        assert.match(api.warnings[0], /invalid arguments/);
    });
});
