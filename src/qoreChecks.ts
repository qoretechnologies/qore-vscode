/* qoreChecks.ts Copyright 2026 Qore Technologies, s.r.o. */

import { SpawnSyncReturns, spawnSync } from 'child_process';
import { QoreLaunchConfig, QoreLaunchOptions } from './QoreLaunchConfig';
import { isQore3OrNewer, MINIMUM_QORE_VERSION } from './qore3';
import * as msg from './qore_message';

type QoreProbeOutput = string | Buffer;
type QoreProbeResult = SpawnSyncReturns<QoreProbeOutput>;

function outputText(value: QoreProbeOutput | null): string {
    return value ? value.toString().trim() : '';
}

function logProbeFailure(label: string, result: QoreProbeResult): void {
    msg.logPlusConsole(`${label} failed (status ${String(result.status)})`);
    if (result.error) {
        msg.logPlusConsole(`Error: ${result.error.message}`);
    }
    const stdout = outputText(result.stdout);
    const stderr = outputText(result.stderr);
    if (stdout) {
        msg.logPlusConsole(`Stdout: ${stdout}`);
    }
    if (stderr) {
        msg.logPlusConsole(`Stderr: ${stderr}`);
    }
}

//! check that executable is working
export function checkExecOkResult(
    exec: string,
    args: string[] | undefined,
    launchOptions: QoreLaunchOptions,
): QoreProbeResult {
    const result = spawnSync(
        exec,
        args,
        launchOptions
    );
    return result;
}

//! check that Qore executable is working
export function checkQoreOk(qoreExec: string, launchOptions: QoreLaunchOptions = {shell: false}): boolean {
    msg.logPlusConsole("Checking Qore executable: " + qoreExec);
    const result = checkExecOkResult(
        qoreExec,
        ['--short-version'],
        launchOptions
    );
    const version = outputText(result.stdout);
    if (result.status === 0 && isQore3OrNewer(version)) {
        msg.logPlusConsole(`Qore executable ok: ${qoreExec} (${version})`);
        return true;
    }
    if (result.status === 0) {
        msg.logPlusConsole(`Unsupported Qore version output: ${version || '<empty>'}`);
    } else {
        logProbeFailure(`Qore ${MINIMUM_QORE_VERSION}+ executable check`, result);
    }
    return false;
}

//! check that the integrated QLS module and its astparser dependency load
export function checkQLSOk(qoreExec: string, launchOptions: QoreLaunchOptions = {shell: false}): boolean {
    msg.logPlusConsole(`Checking integrated QLS module with: ${qoreExec}`);
    const result = checkExecOkResult(
        qoreExec,
        ['-l', 'QLS', '-e', 'exit(0);'],
        launchOptions,
    );
    if (result.status === 0) {
        msg.logPlusConsole('Integrated QLS module ok');
        return true;
    }
    logProbeFailure('Integrated QLS module check', result);
    return false;
}

//! check that QoreLaunchConfig is working
export function checkQoreLaunchConfig(config: QoreLaunchConfig): boolean {
    const qoreExec = config.getQoreExec();
    const launchOptions = config.getLaunchOptions();
    return checkQoreOk(qoreExec, launchOptions);
}

//! check that QLS can be loaded by a validated launch configuration
export function checkQLSWithLaunchConfig(config: QoreLaunchConfig): boolean {
    return checkQLSOk(config.getQoreExec(), config.getLaunchOptions());
}

//! check that Qore debugger is working
export function checkDebuggerWithLaunchConfig(config: QoreLaunchConfig, dbg: string): boolean {
    const qoreExec = config.getQoreExec();
    const launchOptions = config.getLaunchOptions();
    msg.logPlusConsole("Checking Qore debugger with Qore executable: " + qoreExec + " dbg: " + dbg);

    let res: boolean = false;
    const result = checkExecOkResult(
        qoreExec,
        [dbg, "-h"],
        launchOptions
    );
    if (result.status === 0) {
        res = true;
    } else if (result.status === 1 && /(usage|debug server)/.test(outputText(result.stdout))) {
        res = true;
    }

    if (res) {
        msg.logPlusConsole("Qore debugger ok");
    } else {
        msg.logPlusConsole("Qore debugger check failed");
    }
    return res;
}
