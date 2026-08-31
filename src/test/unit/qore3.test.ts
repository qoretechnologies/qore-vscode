/* qore3.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {QoreLaunchConfig} from '../../QoreLaunchConfig';
import {
    isQore3OrNewer,
    mergeLaunchEnvironment,
    parseQoreVersion,
    QORE_SOURCE_EXTENSIONS,
} from '../../qore3';
import {getServerArgs, QLS_SERVER_PROGRAM} from '../../serverArgs';

describe('Qore 3 launch configuration', () => {
    it('parses release and development versions', () => {
        assert.deepEqual(parseQoreVersion('3.0.0\n'), {major: 3, minor: 0, patch: 0});
        assert.deepEqual(parseQoreVersion('3.2.1-dev+fac359da6'), {major: 3, minor: 2, patch: 1});
    });

    it('rejects incomplete, malformed, and pre-3.0 versions', () => {
        assert.equal(parseQoreVersion('3.0'), undefined);
        assert.equal(parseQoreVersion('qore 3.0.0'), undefined);
        assert.equal(parseQoreVersion(''), undefined);
        assert.equal(isQore3OrNewer('2.3.0'), false);
        assert.equal(isQore3OrNewer('invalid'), false);
    });

    it('accepts Qore 3 and later major versions', () => {
        assert.equal(isQore3OrNewer('3.0.0'), true);
        assert.equal(isQore3OrNewer('4.0.0'), true);
    });

    it('launches the integrated QLS module directly', () => {
        assert.deepEqual(getServerArgs(), ['-l', 'QLS', '-e', QLS_SERVER_PROGRAM]);
        assert.match(QLS_SERVER_PROGRAM, /^QLS::QLSServer server\(\);/);
        assert.notEqual(getServerArgs(), getServerArgs(), 'callers receive independent argument arrays');
    });

    it('covers the canonical Qore and Qorus source extensions without duplicates', () => {
        assert.deepEqual(QORE_SOURCE_EXTENSIONS, [
            'q', 'ql', 'qc', 'qm', 'qr', 'qtest',
            'qclass', 'qconn', 'qwf', 'qsd', 'qfd', 'qjob', 'qconst', 'qsm', 'qstep', 'qmc',
        ]);
        assert.equal(new Set(QORE_SOURCE_EXTENSIONS).size, QORE_SOURCE_EXTENSIONS.length);
    });

    it('merges custom launch values with the inherited environment', () => {
        assert.deepEqual(
            mergeLaunchEnvironment({QORE_MODULE_DIR: '/qore/modules'}, {PATH: '/usr/bin', LANG: 'C'}),
            {PATH: '/usr/bin', LANG: 'C', QORE_MODULE_DIR: '/qore/modules'},
        );
        assert.equal(mergeLaunchEnvironment(undefined, {PATH: '/usr/bin'}), undefined);
    });

    it('never invokes the configured executable through a shell', () => {
        const config = new QoreLaunchConfig('/path with spaces/qore', {
            QORE_MODULE_DIR: '/modules',
        });
        assert.equal(config.getQoreExec(), '/path with spaces/qore');
        assert.deepEqual(config.getLaunchEnv(), {QORE_MODULE_DIR: '/modules'});
        const options = config.getLaunchOptions();
        assert.equal(options.shell, false);
        assert.equal(options.env?.QORE_MODULE_DIR, '/modules');
        assert.equal(options.env?.PATH, process.env.PATH);
    });
});
