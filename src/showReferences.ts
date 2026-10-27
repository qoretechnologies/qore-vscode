/* showReferences.ts Copyright 2026 Qore Technologies, s.r.o. */

//! the command that QLS reference-count code lenses execute
export const SHOW_REFERENCES_COMMAND = 'qls.showReferences';

//! the position of a code lens target as sent by QLS
export interface LensTarget {
    uri: string;
    line: number;
    character: number;
}

//! the VS Code functionality needed to show references; injected so the command can be tested without VS Code
export interface ShowReferencesApi<UriT, PositionT> {
    parseUri(uri: string): UriT;
    makePosition(line: number, character: number): PositionT;
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
    showWarning(message: string): void;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

//! returns the lens target from the command arguments sent by QLS: (uri, {line, character})
export function parseShowReferencesArgs(args: unknown[]): LensTarget | undefined {
    const [uri, position] = args;
    if (typeof uri !== 'string' || !uri || typeof position !== 'object' || position === null) {
        return undefined;
    }
    const {line, character} = position as {line?: unknown; character?: unknown};
    if (!isNonNegativeInteger(line) || !isNonNegativeInteger(character)) {
        return undefined;
    }
    return {uri, line, character};
}

//! shows the references of the symbol at the lens target in the references peek view
/** @return true if the references were shown, false if the arguments were invalid
*/
export async function showReferences<UriT, PositionT>(
    api: ShowReferencesApi<UriT, PositionT>,
    ...args: unknown[]
): Promise<boolean> {
    const target = parseShowReferencesArgs(args);
    if (!target) {
        api.showWarning(`Cannot show references: invalid arguments ${JSON.stringify(args)}`);
        return false;
    }
    const uri = api.parseUri(target.uri);
    const position = api.makePosition(target.line, target.character);
    const locations = (await api.executeCommand('vscode.executeReferenceProvider', uri, position)
        ?? []) as unknown[];
    await api.executeCommand('editor.action.showReferences', uri, position, locations);
    return true;
}
