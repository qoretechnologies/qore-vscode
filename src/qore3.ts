/* qore3.ts Copyright 2026 Qore Technologies, s.r.o. */

export const MINIMUM_QORE_VERSION = '3.0.0';

export const QORE_SOURCE_EXTENSIONS = [
    'q', 'ql', 'qc', 'qm', 'qr', 'qtest',
    'qclass', 'qconn', 'qwf', 'qsd', 'qfd', 'qjob', 'qconst', 'qsm', 'qstep', 'qmc',
] as const;

export interface QoreVersion {
    major: number;
    minor: number;
    patch: number;
}

export type QoreEnvironment = {[key: string]: string};

export function parseQoreVersion(output: string): QoreVersion | undefined {
    const match = output.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) {
        return undefined;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

export function isQore3OrNewer(output: string): boolean {
    const version = parseQoreVersion(output);
    return !!version && version.major >= 3;
}

export function mergeLaunchEnvironment(
    overrides?: NodeJS.ProcessEnv,
    base: NodeJS.ProcessEnv = process.env,
): QoreEnvironment | undefined {
    if (!overrides) {
        return undefined;
    }
    const merged: QoreEnvironment = {};
    for (const [name, value] of Object.entries({...base, ...overrides})) {
        if (value !== undefined) {
            merged[name] = value;
        }
    }
    return merged;
}
