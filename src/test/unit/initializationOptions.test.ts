/* initializationOptions.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';

import {getInitializationOptions, QLS_INIT_SETTINGS} from '../../initializationOptions';

function settings(values: {[key: string]: unknown}): (key: string) => unknown {
    return key => values[key];
}

describe('QLS initialization options', () => {
    it('sends no options when no settings are set, so QLS uses its defaults', () => {
        assert.deepEqual(getInitializationOptions(settings({})), {});
        assert.deepEqual(getInitializationOptions(settings({
            excludeDirs: null,
            maxFileSize: null,
            treeCacheSize: null,
        })), {});
    });

    it('maps the settings to the QLS option names', () => {
        assert.deepEqual(getInitializationOptions(settings({
            excludeDirs: ['.git', 'build*'],
            maxFileSize: 4194304,
            treeCacheSize: 0,
        })), {
            excludeDirs: ['.git', 'build*'],
            maxIndexFileSize: 4194304,
            treeCacheSize: 0,
        });
    });

    it('allows an empty exclude list to search all directories', () => {
        assert.deepEqual(getInitializationOptions(settings({excludeDirs: []})), {excludeDirs: []});
    });

    it('drops invalid values', () => {
        assert.deepEqual(getInitializationOptions(settings({
            excludeDirs: ['.git', ''],
            maxFileSize: -1,
            treeCacheSize: 1.5,
        })), {});
        assert.deepEqual(getInitializationOptions(settings({
            excludeDirs: 'build',
            maxFileSize: '100',
            treeCacheSize: true,
        })), {});
        assert.deepEqual(getInitializationOptions(settings({excludeDirs: ['.git', 3]})), {});
    });

    it('declares every setting that is read in package.json', () => {
        const root = resolve(__dirname, '../../..');
        const properties = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
            .contributes.configuration.properties;
        const read: string[] = [];
        getInitializationOptions(key => {
            read.push(key);
            return undefined;
        });
        assert.deepEqual(read.sort(), ['excludeDirs', 'maxFileSize', 'treeCacheSize']);
        for (const key of read) {
            const property = properties[`${QLS_INIT_SETTINGS}.${key}`];
            assert.ok(property, `${QLS_INIT_SETTINGS}.${key} is declared`);
            assert.equal(property.default, null, `${key} defaults to the QLS default`);
            assert.ok(property.markdownDescription.includes('restarts QLS'), `${key} documents the restart`);
        }
    });
});
