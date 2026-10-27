/* initializationOptions.ts Copyright 2026 Qore Technologies, s.r.o. */

//! settings that are sent to QLS as initialization options; changing them restarts QLS
export const QLS_INIT_SETTINGS = 'qore.index';

//! QLS initialization options
export interface QLSInitializationOptions {
    excludeDirs?: string[];
    maxIndexFileSize?: number;
    treeCacheSize?: number;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

//! returns the QLS initialization options from the `qore.index` settings
/** Only settings with valid values are included, so QLS uses its own defaults for the others.

    @param get returns the value of a setting in the `qore.index` section, or undefined/null if not set
*/
export function getInitializationOptions(get: (key: string) => unknown): QLSInitializationOptions {
    const options: QLSInitializationOptions = {};
    const excludeDirs = get('excludeDirs');
    if (Array.isArray(excludeDirs) && excludeDirs.every(pattern => typeof pattern === 'string' && pattern)) {
        options.excludeDirs = excludeDirs;
    }
    const maxFileSize = get('maxFileSize');
    if (isNonNegativeInteger(maxFileSize)) {
        options.maxIndexFileSize = maxFileSize;
    }
    const treeCacheSize = get('treeCacheSize');
    if (isNonNegativeInteger(treeCacheSize)) {
        options.treeCacheSize = treeCacheSize;
    }
    return options;
}
