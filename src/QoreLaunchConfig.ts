/* QoreLaunchConfig.ts Copyright 2026 Qore Technologies, s.r.o. */

import { mergeLaunchEnvironment, QoreEnvironment } from './qore3';

export interface QoreLaunchOptions {
    cwd?: string;
    env?: QoreEnvironment;
    shell: false;
}

export class QoreLaunchConfig {
    //! qore executable
    private _qoreExec: string = "qore";

    //! env needed for launching qore
    private _launchEnv: NodeJS.ProcessEnv | undefined = undefined;

    constructor(qoreExec: string, launchEnv?: NodeJS.ProcessEnv) {
        this._qoreExec = qoreExec;
        this._launchEnv = launchEnv;
    }

    getQoreExec(): string {
        return this._qoreExec;
    }

    getLaunchEnv(): NodeJS.ProcessEnv | undefined {
        return this._launchEnv;
    }

    getLaunchOptions(): QoreLaunchOptions {
        return {
            env: mergeLaunchEnvironment(this._launchEnv),
            shell: false,
        };
    }
}
