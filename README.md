# qore-vscode

**qore-vscode** adds [Qore](https://qore.org/) language support to Visual Studio Code.

## Version 0.9.0 (2026-08-31)

- Requires Qore 3.0 or newer.
- Runs the `QLS` module integrated with Qore 3.0; the former `qls` submodule and wrapper script are no longer bundled.
- Supports `.qr` modern scripts and the complete Qore/Qorus source-extension set.
- Adds Qore 3 syntax highlighting and snippets for enums, typedefs, character and buffer types,
  streaming operators, `@assert`, and `@debug`.
- Starts and stops the language client deterministically and restarts it when the configured Qore executable changes.
- Adds `qore.index.*` settings for QLS workspace indexing, the command run by reference-count code lenses, and
  doc-comment, indentation and bracket editing rules.

See [CHANGELOG.md](CHANGELOG.md) for older releases.

## Requirements

Install Qore 3.0 or newer with its standard `astparser` binary module and `QLS` Qore module. A normal Qore 3
installation includes both. Set `qore.executable` to the interpreter path when it is not available as `qore`
on the VS Code process's `PATH`:

```json
{
    "qore.executable": "/usr/bin/qore",
    "qore.useQLS": true
}
```

The extension validates both the Qore version and `-l QLS` before starting the language server. It launches the
configured interpreter directly, so paths containing spaces are supported and a different `qls` executable cannot
be selected accidentally from `PATH`.

When testing an uninstalled Qore build, start VS Code with the build environment available. For example:

```bash
LD_LIBRARY_PATH=/path/to/qore/build \
QORE_MODULE_DIR=/path/to/qore/build/modules/astparser:/path/to/qore/build/modules/reflection:/path/to/qore/build/modules/json:/path/to/qore/qlib \
code /path/to/workspace
```

Debugging additionally requires `qdbg-vsc-adapter` in `PATH`, beside the extension, or at the path configured by
`qore.debugAdapter`.

## Features

This extension adds support for the following:

- Syntax highlighting and semantic tokens
- Completion, signature help and inlay hints
- Hover info
- Go to definition, type definition and implementation
- Find references, rename, and reference-count code lenses
- Call and type hierarchies
- Document and workspace symbol search
- Syntax error reporting
- Document and on-type formatting
- Folding, selection ranges, document highlights and source actions
- Comment continuation, indentation and bracket rules for the editor
- Debugger integration through `qdbg-vsc-adapter`

Most features other than syntax highlighting are provided by the
[QLS module](https://github.com/qorelanguage/qore/tree/develop/qlib/QLS) included in Qore 3.

Recognized source extensions are `.q`, `.ql`, `.qc`, `.qm`, `.qr`, `.qtest`, `.qclass`, `.qconn`, `.qwf`,
`.qsd`, `.qfd`, `.qjob`, `.qconst`, `.qsm`, `.qstep`, and `.qmc`.

## Development

Use Node 24 for builds and tests, as in the Qore and Qorus projects; `.nvmrc` selects it:

```bash
nvm use
npm ci
npm test
```

The extension itself runs in the Node.js runtime built into VS Code, so the bundle targets the Node.js version of
the oldest supported VS Code release (`engines.vscode` in `package.json`), not the development toolchain.

The live integration test requires a Qore 3 build and its local module paths:

```bash
QORE_TEST_EXECUTABLE=/path/to/qore/build/qore \
LD_LIBRARY_PATH=/path/to/qore/build \
QORE_MODULE_DIR=/path/to/qore/build/modules/astparser:/path/to/qore/build/modules/reflection:/path/to/qore/build/modules/json:/path/to/qore/qlib \
npm run test:qore3
```

Run `npm run package` to build the production bundle and VSIX.

## Workspace Indexing

QLS starts when a Qore file is opened or when the workspace contains Qore source files, and indexes the
workspace's Qore files so that workspace symbols, definitions and references work across files. Files that are
not open are kept as compact symbol indexes; their syntax trees are parsed when a request needs them.

These settings control indexing; changing them restarts QLS:

- `qore.index.excludeDirs` Glob patterns (`*` and `?`) for directory names that are not searched for Qore files,
  replacing the QLS defaults (`.git`, `.hg`, `.svn`, `.claude`, `.vscode-test`, `node_modules`, `build`,
  `build-*`). [default=QLS defaults]
- `qore.index.maxFileSize` Files larger than this many bytes are not indexed; `0` means no limit. [default=8 MiB]
- `qore.index.treeCacheSize` Syntax trees of files that are not open are cached up to this many bytes of source;
  a syntax tree takes about 20 times the size of its source in memory. `0` disables the cache. [default=8 MiB]

For example, to also skip generated code and allow more memory for cached syntax trees:

```json
{
    "qore.index.excludeDirs": [".git", "node_modules", "build*", "generated"],
    "qore.index.treeCacheSize": 33554432
}
```

## QLS Logging

If you want to log output of QLS, you can use the following configuration settings:

- `qore.useQLS` Boolean flag to turn on/off usage of QLS for providing Qore code information. [default=true]
- `qore.logging` Boolean flag to set logging on or off. [default=false]
- `qore.logFile` String specifying QLS log file path. If logging is turned on, all the operations will be logged to this file. If not defined, `~/.qls.log` is used on Unix-like systems and `%AppData%\QLS\qls.log` on Windows.
- `qore.logVerbosity` Verbosity of QLS logging. From 0 to 2. [default=0]
- `qore.appendToLog` Boolean flag specifying whether to append to the QLS log file or overwrite it on each restart. [default=false]

## Debugging

The sessions are configured in `launch.json` file referenced from `Debug` view.
The extension implements *qore* debugging type. Debugger can execute Qore script
in local debug host or attach to a remote *qdbg-server* host.

In the first case the `request` value is *launch* and `program` specifies Qore
script filename. In latter case the `request` value is *attach* and `connection`
specifies URL to connect to and `program` is program name to be debugged.

Note that VSCode macros and commands are expanded. The extension implements
`${command:AskForFilename}` for *launch* case and `${command:AskForConnection}`,
`${command:AskForProgram}` for *attach* case to specify value when debugging
session is started.

To start debugging prepare launch file, select a configuration from drop-down
menu and click `Start debugging`. When specified program is executed the
extension is notified, the program interrupted and then user can start stepping
the code, inspecting stack, variables, etc. To leave program stepping press `F5`.

The launch file data structure is explained by the following example:

```
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "qore",
            "request": "launch",
            "name": "Ask for file name",
            "program": "${workspaceFolder}/${command:AskForFilename}"
        },
        {
            "type": "qore",
            "request": "attach",
            "name": "Ask for conection and program",
            "connection": "${command:AskForConnection}",
            "program": "${command:AskForProgram}"
        },
        {
            "type": "qore",
            "request": "launch",
            "name": "Launch test-basic.q",
            "program": "test-basic.q",
        },
        {
            "type": "qore",
            "request": "attach",
            "name": "Attach test-program",
            "connection": "ws://localhost:8001",
            "program": "test-program",
        }
    ]
}
```
