/* languageAssets.test.ts Copyright 2026 Qore Technologies, s.r.o. */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';

import {QORE_SOURCE_EXTENSIONS} from '../../qore3';

interface GrammarPattern {
    match?: string;
    name?: string;
}

interface GrammarRepositoryEntry {
    patterns: GrammarPattern[];
}

interface Grammar {
    repository: {[name: string]: GrammarRepositoryEntry};
}

const root = resolve(__dirname, '../../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const grammar = JSON.parse(
    readFileSync(resolve(root, 'syntaxes/qore.tmLanguage.json'), 'utf8'),
) as Grammar;
const snippets = JSON.parse(readFileSync(resolve(root, 'snippets/qore.json'), 'utf8'));

function matchFor(repositoryName: string, scopeName: string): RegExp {
    const pattern = grammar.repository[repositoryName].patterns.find(entry => entry.name === scopeName);
    assert.ok(pattern?.match, `${scopeName} must define a match expression`);
    return new RegExp(pattern.match);
}

describe('Qore 3 language assets', () => {
    it('keeps package associations synchronized with QLS and astparser', () => {
        const extensions = packageJson.contributes.languages[0].extensions;
        assert.deepEqual(extensions, QORE_SOURCE_EXTENSIONS.map(ext => `.${ext}`));
        assert.equal(new Set(extensions).size, extensions.length);
        assert.ok(packageJson.activationEvents.includes('onLanguage:qore'));
    });

    it('highlights Qore 3 declaration and data types', () => {
        const declarations = matchFor('storage_types', 'storage.type.declaration.qore');
        assert.match('enum', declarations);
        assert.match('typedef', declarations);

        const primitives = matchFor('storage_types', 'storage.type.primitive.qore');
        for (const type of ['buffer', 'char', 'decimal128', 'float32', 'float64', 'int8', 'int64', 'union']) {
            assert.match(type, primitives, `${type} should be highlighted as a Qore type`);
        }
        const softTypes = matchFor('storage_types', 'storage.type.primitive.soft.qore');
        assert.match('softchar', softTypes);
    });

    it('highlights Qore 3 assertions, debug blocks, streaming operators, and special floats', () => {
        const compileTime = matchFor('compile_time', 'keyword.control.compile-time.qore');
        assert.match('@assert', compileTime);
        assert.match('@debug', compileTime);

        const streaming = matchFor('keywords', 'keyword.operator.streaming.qore');
        for (const operator of ['iterate', 'first', 'last', 'one', 'all', 'count', 'take', 'drop', 'takewhile', 'takeuntil']) {
            assert.match(operator, streaming);
        }

        const specialFloat = matchFor('constants', 'constant.numeric.float.qore');
        assert.match('@inf@', specialFloat);
        assert.match('@nan@', specialFloat);
    });

    it('recognizes Qore 3 character literals and Unicode escapes', () => {
        const charPatterns = grammar.repository.chars.patterns.map(pattern => new RegExp(pattern.match!));
        assert.ok(charPatterns.some(pattern => pattern.test("c'λ'")));
        assert.ok(charPatterns.some(pattern => pattern.test('c"\\u{1F642}"')));

        const escapes = matchFor('escaped_chars', 'constant.character.escape.qore');
        for (const escape of ['\\x41', '\\u20AC', '\\u{1F642}', '\\U0001F642']) {
            assert.match(escape, escapes);
        }
        const formats = matchFor('format_chars', 'constant.character.format.qore');
        assert.match('%Y', formats);
    });

    it('ships modern snippets without legacy foreach syntax', () => {
        assert.equal(snippets.qore_foreach.body[0], 'foreach auto ${1:i} in (${2:a_list}) {');
        assert.equal(snippets.qore_enum.prefix, 'enum');
        assert.equal(snippets.qore_typedef.prefix, 'typedef');
        assert.equal(snippets.qore_assert.prefix, '@assert');
        assert.equal(snippets.qore_debug.prefix, '@debug');
    });
});
