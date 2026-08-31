/* serverArgs.ts Copyright 2026 Qore Technologies, s.r.o. */

export const QLS_SERVER_PROGRAM = 'QLS::QLSServer server(); exit(server.main());';

//! get arguments for starting QLS
export function getServerArgs(): string[] {
    return ['-l', 'QLS', '-e', QLS_SERVER_PROGRAM];
}
