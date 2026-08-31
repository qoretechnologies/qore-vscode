/* utils.ts Copyright 2026 Qore Technologies, s.r.o. */

import { existsSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

export function findScript(extensionPath: string, scriptName: string): string {
    if (isAbsolute(scriptName)) {
        return scriptName;
    }
    // try extension directory
    let s = join(extensionPath, scriptName);
    if (existsSync(s)) {
        return s;
    }
    // try PATH environment variable
    const pathArr = (process.env.PATH || "").split(delimiter);
    for (let p of pathArr) {
        s = join(p, scriptName);
        if (existsSync(s)) {
            return s;
        }
    }
    return scriptName;
}
