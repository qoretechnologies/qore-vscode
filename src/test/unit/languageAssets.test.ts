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
const languageConfig = JSON.parse(readFileSync(resolve(root, 'qore.configuration.json'), 'utf8'));

//! returns the words that the language configuration's word pattern finds in the text
function words(text: string): string[] {
    return text.match(new RegExp(languageConfig.wordPattern, 'g')) ?? [];
}

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

    it('activates when the workspace contains Qore source files of any extension', () => {
        const event = packageJson.activationEvents.find((e: string) => e.startsWith('workspaceContains:'));
        assert.equal(event, `workspaceContains:**/*.{${QORE_SOURCE_EXTENSIONS.join(',')}}`);
    });

    it('declares the non-standard semantic token modifiers in the QLS legend', () => {
        const modifiers = packageJson.contributes.semanticTokenModifiers.map((m: {id: string}) => m.id);
        assert.deepEqual(modifiers, ['documentation']);
        const scopes = packageJson.contributes.semanticTokenScopes.find(
            (s: {language: string}) => s.language === 'qore');
        assert.deepEqual(scopes.scopes['comment.documentation'], ['comment.block.documentation.qore']);
    });

    it('selects Qore variables, members and scoped names as words', () => {
        assert.deepEqual(words('$var + $.member'), ['$var', '$.member']);
        assert.deepEqual(words('Ns::Class::method(arg_1)'), ['Ns', 'Class', 'method', 'arg_1']);
        assert.deepEqual(words('x = 3.14 + .5'), ['x', '3.14', '.5']);
    });

    it('indents after opening brackets but not in comments', () => {
        const increase = new RegExp(languageConfig.indentationRules.increaseIndentPattern);
        const decrease = new RegExp(languageConfig.indentationRules.decreaseIndentPattern);
        for (const line of ['class Foo {', 'if (x) {', 'list l = (', 'hash h = {', 'call(a,']) {
            assert.match(line, increase, line);
        }
        for (const line of ['x = {};', '# comment {', 'string s = "{";', 'foo();']) {
            assert.doesNotMatch(line, increase, line);
        }
        for (const line of ['}', '    }', ')', '];']) {
            assert.match(line, decrease, line);
        }
        assert.doesNotMatch('x = 1;', decrease);
    });

    it('continues doc comments on enter', () => {
        const rules = languageConfig.onEnterRules as Array<{beforeText: string; afterText?: string;
            action: {appendText?: string; removeText?: number}}>;
        const appendFor = (before: string, after = ''): string | undefined => rules.find(rule =>
            new RegExp(rule.beforeText).test(before)
                && (!rule.afterText || new RegExp(rule.afterText).test(after)))?.action.appendText;
        assert.equal(appendFor('/**', ' */'), ' * ');
        assert.equal(appendFor('    /** Returns the value'), ' * ');
        assert.equal(appendFor('     * @param x the value'), '* ');
        assert.equal(appendFor('/* plain comment'), undefined);
        assert.equal(appendFor('x = 1;'), undefined);
        const closing = rules.find(rule => new RegExp(rule.beforeText).test('     */'));
        assert.equal(closing?.action.removeText, 1);
    });

    it('does not auto-close quotes in strings and comments, and folds regions', () => {
        const pairs = languageConfig.autoClosingPairs as Array<{open: string; notIn?: string[]}>;
        for (const quote of ['"', "'", '`']) {
            assert.deepEqual(pairs.find(pair => pair.open === quote)?.notIn, ['string', 'comment']);
        }
        const start = new RegExp(languageConfig.folding.markers.start);
        const end = new RegExp(languageConfig.folding.markers.end);
        assert.match('    # region Helpers', start);
        assert.match('# endregion', end);
        assert.doesNotMatch('# regional data', start);
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
