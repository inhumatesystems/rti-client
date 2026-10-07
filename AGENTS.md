# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains multi-language client libraries for the Inhumate RTI (RunTime Infrastructure) — a publish/subscribe middleware communicating over WebSocket (SocketCluster protocol). Implementations are provided for JavaScript/TypeScript, Python, C++, C#/.NET, and Vue 3.

The default broker URL is `ws://127.0.0.1:8000`, or from the `RTI_URL` environment variable. Tests require a running RTI broker.

## Build & Test Commands

### JavaScript (`js/`)
```sh
npm install
npm run build        # TypeScript compile + webpack
npm test             # Jest tests (broker required)
npm run lint         # ESLint (lint:fix to auto-fix)
npm start            # Run usage example
```

### Vue (`vue/`)
```sh
npm install
npm run build        # Type-check + Vite library build
npm run test:unit    # Vitest unit tests
npm run lint         # ESLint (lint:fix to auto-fix)
npm run format       # Prettier
```

### Linting (`js/` + `vue/`)

Both use ESLint flat config (`js/eslint.config.js`, `vue/eslint.config.ts`) with the recommended
non-type-checked typescript-eslint rules, loosened on purpose so existing code passes: `no-explicit-any`
and (js) `no-unsafe-function-type` are off, unused vars, `var`, `prefer-const` and useless assignments
are warnings, and `eslint-config-prettier` turns off everything prettier owns. Only errors fail. CI runs
`npm run lint -w js -w vue` in the `lint js and vue` job, which needs no generated code because
`src/generated` is ignored. `js/test` is not linted either. Vue's old `eslint-plugin-oxlint` hookup was removed: it pointed at a
`.oxlintrc.json` that never existed and oxlint was never run.

### npm dependency overrides (`js/` + `vue/`)

The root `package.json` is an npm-workspaces root (`js`, `vue`) and pins a few transitive dependencies via `overrides`. After changing any of these, run a **clean** install (`rm -rf node_modules js/node_modules vue/node_modules package-lock.json && npm install`) — a partial install can place packages inconsistently across the root and workspace `node_modules` and break webpack resolution.

| Override | Reason |
|---|---|
| `uuid: 11.1.1` | Transitive `uuid@8.3.2` (from `jest-junit` and `socketcluster-client`) was flagged by `npm audit` (GHSA-w5hq-g745-h8pq). `11.1.1` is the patched version and ships a **dual CJS/ESM** build — required because jest doesn't transform `node_modules`, so an ESM-only `uuid` (v12+) breaks the test run. `uuid@14` was tried and broke the build for exactly this reason. `uuid` is also a direct `js/` dependency (used in `src/rticlient.ts`); `@types/uuid` is intentionally absent since uuid@11 bundles its own types. |
| `test-exclude: ^7.0.1` | `babel-plugin-istanbul` (in jest's transform chain) pins `test-exclude@6`, which pulls the deprecated `glob@7` and the leaky `inflight@1`. `test-exclude@7` uses `glob@10+`, eliminating both. |
| `glob: ^13.0.6` | The `glob` maintainer deprecates every version below the latest as a nag (no actual vulnerability). Forcing the latest silences the warning across jest, `test-exclude`, and vue's `js-beautify`. This is aggressive (those packages request `glob@10`/`@11`) and may need re-bumping when a newer glob ships; dropping this line is safe and only re-introduces the harmless deprecation nag. |
| `js-yaml: ^4.2.0` | The only `js-yaml` in the installed tree is `3.14.2`, pulled by `@istanbuljs/load-nyc-config@1.1.0` (`^3.13.1`) deep inside jest's coverage transform chain (`babel-plugin-istanbul` → `@jest/transform`). It was flagged by `npm audit` (GHSA-h67p-54hq-rp68, quadratic-complexity DoS in merge-key handling, affecting `<=4.1.1`); this single dependency was the root cause of all 18 reported moderate vulnerabilities. `4.2.0` is the patched release. `npm audit fix --force` "fixes" it by downgrading `ts-jest` to `29.1.2` (which doesn't even patch js-yaml) — do not do that. The override is safe because `load-nyc-config` calls `require('js-yaml').load(...)` (not the 3.x-only `safeLoad`), which exists and is API-compatible in js-yaml 4.x. `npm ls` reports the override as `invalid` against the declared `^3.13.1` range — expected and cosmetic. |

The `js-yaml` override is also what removes `sprintf-js` (GHSA-hp3w-g68c-fv3c, no patched release): js-yaml 3.x
pulls `argparse@1` → `sprintf-js`, js-yaml 4.x uses `argparse@2` which doesn't. An incremental `npm install` /
`npm audit fix` can leave a nested `js-yaml@3.x` in the lock despite the override — if `npm ls js-yaml` shows
3.x, do the clean install above.

`braces` (GHSA-vfj7-8cjw-p6xm, every version `<=3.0.3` affected, no patched release as of 2026-10) remains in
`npm audit`, reached via vue's `@vue/eslint-config-typescript` → `fast-glob` → `micromatch`. It is dev-only lint
tooling that only expands the repo's own glob patterns, so it is accepted. Do not take `npm audit fix --force`'s
suggestion to downgrade `@vue/eslint-config-typescript` to 14.0.1.

The jest toolchain in `js/` was upgraded to v30 (`jest`, `@types/jest@30`, `jest-junit@17`, `ts-jest@29.4.x` which supports jest 30) so jest's own internals no longer use `glob@7`/`inflight`.

`js/jest.config.cjs` passes a ts-jest `tsconfig` override (`module: esnext`, `isolatedModules: true`). The library build uses `module: nodenext` (correct for dual CJS/ESM publishing), but that hybrid module kind triggers ts-jest warning TS151002 — ts-jest transpiles file-at-a-time and requires `isolatedModules`, which is only valid with a non-hybrid module kind. The override keeps `nodenext` for the actual build while giving ts-jest a plain ESM kind for transpilation. Do **not** set `isolatedModules` directly in `tsconfig.json`: combined with `module: nodenext` it makes ts-jest emit the wrong module format (`SyntaxError: Cannot use import statement outside a module`).

`vue/` lists `@vue/language-core` as a direct `devDependency` even though nothing in `vue/src` imports it. `vite-plugin-dts@5` (the `.d.ts` emitter for the library build) delegates to `unplugin-dts`, which imports `@vue/language-core` to handle `.vue` SFCs but declares it only as an **optional** peer — so npm won't install a hoisted copy. The single copy that exists is nested under `node_modules/vue-tsc/node_modules` (vue-tsc pins it exactly), which `unplugin-dts` can't resolve, so `npm run build` fails with `Cannot find package '@vue/language-core'`. Declaring it directly hoists a resolvable copy. Keep its range aligned with `vue-tsc` (both `^3.3.5`) so the tree dedupes to one version; do **not** drop to `unplugin-dts`'s `~3.1.5` peer range, which would split the tree into two language-core versions.

### Python (`python/`)
```sh
python -m virtualenv .venv
. .venv/bin/activate
pip install -r inhumate_rti/requirements.txt
pip install -r test/requirements.txt
pytest               # Run tests (broker required)
```

### .NET (`dotnet/`)
```sh
dotnet restore
dotnet build
dotnet test
```

### C++ (`cpp/`)
```sh
# Get dependencies first
scripts/get_dependencies.sh

# Platform builds (from repo root scripts/)
scripts/linux_static_build.sh
scripts/linux_ue5_build.sh       # requires: export UE5=/path/to/UE5
scripts/windows_static_build.sh
scripts/windows_ue5_build.sh     # requires: export UE5=/c/path/to/UE5
scripts/macos_ue5_build.sh       # requires: export UE5=/path/to/UE5
```

### Code Generation — the contract

Protobuf types, channel names, capabilities and the other constants are **generated for every
client from the RTI contract** by the [Inhumate Contract tool](https://gitlab.com/inhumate/contract)
(`../contract`), driven by the `inhumate-contract.yml` manifest at the repo root:

```sh
npm run generate         # npx inhumate-contract - idempotent, safe to run in a build
npm run generate:force   # regenerate even when the lock says everything is up to date
```

Requires **inhumate-contract >= 0.2.0** (constant groups, flat C# constant classes). Generation is
tracked in `inhumate-contract.lock` (gitignored, as is the generated code), so a fresh checkout
generates once and later runs are a no-op. Output lands in `js/src/generated`,
`python/inhumate_rti/generated`, `dotnet/src/generated` and `cpp/generated` — do not edit by hand.
CI runs it once in the `generate` job and passes the result to every build job. That job installs
git and rewrites `https://gitlab.com/` to a `CI_JOB_TOKEN` URL, because the contract repo is private
and `node:22-slim` ships no git — see the comment on the job.

The contract itself no longer lives here. It is its own repo,
[inhumate/contracts/rti](https://gitlab.com/inhumate/contracts/rti) (`../contracts/rti`), and every
manifest entry names it as `source: inhumate:rti@<version>` — the `inhumate:` shortcut expands to
`https://gitlab.com/inhumate/contracts/`. The tool fetches it with plain git (so private repos work
with whatever authentication git already has) and caches it under `~/.inhumate/contracts`;
`--refresh` re-fetches. Pulling in a new contract release is a one-line version bump in
`inhumate-contract.yml`, in all four entries.

**C++ is pinned separately.** Generated C++ links only against the libprotobuf it was generated for
(`.pb.h` carries a `#error` version guard), so the cpp entry pins `protobufVersion: 3.11.2` while
the other three stay on the 23.3 from the manifest's `options` — their runtimes are version
tolerant. That version is
deliberately old: protobuf 22+ pulls in abseil, which caused dependency hell here
([#12292](https://github.com/protocolbuffers/protobuf/issues/12292)).

The same job's `protobufSource: cpp/protobuf` unpacks the matching protobuf **C++ source**, which
`cpp/scripts/linux_static_build.sh` and friends then build the runtime library from. So one line in
the manifest decides both the protoc and the runtime, and they cannot drift apart.
`get_dependencies.sh` no longer fetches protobuf — it only checks the source is there and handles
asio/websocketpp/openssl. Re-running generation is a no-op once `cpp/protobuf` holds the right
version, so it never destroys an existing protobuf build.

`targets.cpp.dllexportDecl: INHUMATE_RTI_PROTOS_EXPORT` in the contract replaces what CMake used
to pass as `protobuf_generate_cpp(... EXPORT_MACRO …)`, so the Windows DLL build still exports the
generated message classes. CMake now compiles `cpp/generated/*.pb.cc` instead of running protoc.

**Build order for C++**: `npm run generate` (protos, constants and the protobuf source) →
`cpp/scripts/get_dependencies.sh` → a platform build script. CMake fails with a pointed message if
`cpp/generated` is empty.

**The protobuf runtime builds outside its source tree**, into `cpp/protobuf-build` (or
`cpp/protobuf-ue5-build`, `cpp/protobuf-build-<variant>` on Windows) rather than
`cpp/protobuf/cmake-build`. `cpp/protobuf` is shipped fresh by the generate job every pipeline, so a
build directory inside it could not be cached — the artifact extraction would give the source newer
timestamps than the objects. Keeping the two apart lets CI cache `cpp/protobuf-build`, which matters
because protobuf 3.11.2 is pinned and never changes. The build scripts skip the protobuf build
entirely when that directory already exists.

### Contract constants and where they land

A nested mapping under `constants:` in the contract is a **group**; `channel` and `channelType`
are built-in groups filled from `channels:`. Each language renders a group its own way:

| Contract          | TypeScript                | Python                       | C#                              | C++                          |
| ----------------- | ------------------------- | ---------------------------- | ------------------------------- | ---------------------------- |
| channel           | `channel.runtimeControl`  | `channel.runtime_control`    | `RTIChannel.RuntimeControl`     | `RUNTIME_CONTROL_CHANNEL`    |
| capability        | `capability.log`          | `capability.log`             | `RTICapability.Log`             | `LOG_CAPABILITY`             |
| ungrouped         | `constants.internalPrefix`| `constants.internal_prefix`  | `RTIConstants.InternalPrefix`   | `INTERNAL_PREFIX`            |

C# gets one **top-level** static class per group (`RTIChannel`, `RTICapability`, `RTIConstants`),
not classes nested in one — C# resolves types and namespaces in one flat scope, so an unprefixed
`Channel` class would be ambiguous with the `Channel` protobuf message from `Channels.proto` in
every file importing both namespaces.

### Two different versions

`RTIConstants.Version` / `constants.version` / `constants.__version__` / `RTI_VERSION` are the
**contract** version, stamped by the generator from the contract's git tag.

The **client library** version is separate and hand written, because the two diverge once the
contract moves to its own repo. It lives on the client class in each language, and it is what CI
`sed`s the `0.0.1-dev-version` placeholder into:

| Language | Library version      | Stamped in                        |
| -------- | -------------------- | --------------------------------- |
| JS/TS    | `RTIClient.version`  | `js/src/rticlient.ts`             |
| Python   | `inhumate_rti.__version__` | `python/inhumate_rti/__init__.py` |
| .NET     | `RTIClient.Version`  | `dotnet/src/RTIClient.cs`         |
| C++      | `RTI_CLIENT_VERSION` | `cpp/inhumaterti.hpp`             |

### The default broker address

Where a client connects when neither its constructor/options nor `RTI_URL` says otherwise is a
**client** concern, not part of the contract — the contract describes the wire, not where to dial.
So `defaultUrl` / `defaultHost` / `defaultPort` are hand written next to the library version in each
client, not generated:

| Language | Constants                                                        | Declared in                     |
| -------- | ---------------------------------------------------------------- | ------------------------------- |
| JS/TS    | `RTIClient.defaultUrl` / `.defaultHost` / `.defaultPort`         | `js/src/rticlient.ts`           |
| Python   | `RTIClient.default_url` / `.default_host` / `.default_port`      | `python/inhumate_rti/rticlient.py` |
| .NET     | `RTIClient.DefaultUrl` / `.DefaultHost` / `.DefaultPort`         | `dotnet/src/RTIClient.cs`       |
| C++      | `RTI_DEFAULT_URL` / `RTI_DEFAULT_HOST` / `RTI_DEFAULT_PORT`      | `cpp/inhumaterti.hpp`           |

They used to be `constants.defaultUrl` / `RTIConstants.DefaultUrl` / the generated `DEFAULT_URL`;
those names are gone. `RTI_DEFAULT_URL` keeps the name it has always had because downstream C++
(`unreal/`) uses it.

## Architecture

### Protocol Layer
All clients share the same protobuf definitions, which live in the contract repo (`../contracts/rti/proto`, 19 `.proto` files) and are compiled for every language by the contract tool (see Code Generation above). Message categories include: channels, clients, runtime state/control, measurements, commands, logs, launch and fast-time. Generated code is **not** committed — it is gitignored and regenerated from the contract.

### Client Structure
Each language client follows the same conceptual API:
- **`RTIClient`** — main class; aliased as `Client` in public exports
- **EventEmitter pattern** — `connect`, `disconnect`, and custom events
- **Channel pub/sub** — `publishText` / `subscribeText` for plain text; `publish` / `subscribe` for protobuf messages
- **Runtime state tracking** — measures, entities, channels, other clients
- **Authentication** — token (JWT) or secret-based

### Threading Models
This is the most important architectural difference between clients:

| Client | Default | Alternative |
|--------|---------|-------------|
| JavaScript / Vue | Event-driven (single-threaded) | — |
| Python | Multi-threaded (callbacks on receive thread) | `main_loop=` constructor arg for single-threaded |
| .NET | Multi-threaded (callbacks on receive thread) | `new RTIClient(polling: true)` + `rti.Poll()` |
| C++ | **Polling only** — must call `rti.Poll()` in main loop | — |

### Key Files by Client

**JavaScript** (`js/src/`):
- `rticlient.ts` — main `RTIClient` class (extends `EventEmitter`)
- `index.ts` — public exports (`Client`, `Options`, `proto`, `constants`, `channel`, `channelType`, `capability`); everything the contract generates is re-exported from `generated/index.ts` rather than restated here
- `generated/index.ts`, `generated/constants.ts`, `generated/proto.ts` — generated from the contract

**Python** (`python/inhumate_rti/`):
- `rticlient.py` — `RTIClient` class
- `rtisocketclusterclient.py` — WebSocket transport layer
- `rtiruntimecontrol.py`, `rticommand.py` — runtime control and command execution (see Runtime Control Helper section below)
- `__init__.py` — library `__version__`, and re-exports of `generated/` (`proto`, `constants`, `channel`, `channel_type`, `capability`) plus `Client`, `RTIRuntimeControl`, `StepGrant`, `RTICommand`
- `generated/` — the contract's protobuf modules and constant modules

**C++** (`cpp/`):
- `inhumaterti.hpp` + `inhumaterti.cpp` — single header/impl pair; the header `#include`s `rticontract.hpp`
- `generated/rticontract.hpp` — contract constants (generated); shipped alongside `inhumaterti.hpp` by the packaging scripts
- `rtiruntimecontrol.hpp` + `rtiruntimecontrol.cpp` — runtime control helper (see Runtime Control Helper section below)
- Dependencies: websocketpp, asio (both header-only), protobuf, OpenSSL

**.NET** (`dotnet/src/`):
- `RTIClient.cs` — main class, and the library `Version`
- `generated/RTIConstants.cs` — `RTIConstants`, `RTIChannel`, `RTIChannelType`, `RTICapability` (generated)
- `RTIWebSocket.cs` — WebSocket transport (`System.Net.WebSockets`)
- `RTIRuntimeControl.cs` — runtime control helper (see Runtime Control Helper section below)

**Vue** (`vue/src/`):
- `rti.ts` — Pinia store wrapper around the JS client
- `index.ts` — Vue plugin installation; requires Pinia as peer dependency

## Dispatch Mode (Fast-Time Simulation)

All clients support two message dispatch modes for subscribers:

- **IMMEDIATE** (default) — messages are dispatched to the handler as soon as they arrive (existing behavior).
- **BUFFERED** — messages are queued in an internal buffer and only dispatched when `flushBuffers()` is called.

The dispatch mode can be set per-subscription (as the last argument to `subscribe`/`subscribeText`/`subscribeJSON`) or globally via `client.defaultDispatchMode`. Changing the default after subscribing affects all subscriptions that use the default (i.e., those without an explicit mode).

Internal RTI channel subscriptions (`rti/clients`, `rti/channels`, `rti/measures`, `rti/client-disconnect`) are always IMMEDIATE regardless of the client default.

| Concept | JS/TS | Python | C++ | .NET |
|---|---|---|---|---|
| Enum | `DispatchMode.IMMEDIATE / .BUFFERED` | `DispatchMode.IMMEDIATE / .BUFFERED` | `DispatchMode::IMMEDIATE / ::BUFFERED` | `DispatchMode.Immediate / .Buffered` |
| Client default | `client.defaultDispatchMode` | `client.default_dispatch_mode` | `client.defaultDispatchMode` | `client.DefaultDispatchMode` |
| Flush | `client.flushBuffers()` | `client.flush_buffers()` | `client.FlushBuffers()` | `client.FlushBuffers()` |
| Buffer depth | `client.bufferDepth` | `client.buffer_depth` | `client.BufferDepth()` | `client.BufferDepth` |

## Runtime Control Helper

`RTIRuntimeControl` simplifies responding to runtime control messages (start, stop, reset, load scenario, time scale) and adds fast-time worker support. Implemented for **TypeScript/JavaScript**, **Python**, **.NET**, and **C++**.

### TypeScript/JavaScript (`js/src/rtiruntimecontrol.ts`)

```typescript
const runtime = new RTI.RuntimeControl(rti)                          // real-time only
const runtime = new RTI.RuntimeControl(rti, true, true)              // fast-time (getStepGrant pattern)
const runtime = new RTI.RuntimeControl(rti, true, false, stepFn)     // fast-time (callback pattern)
```

Exported as `RTI.RuntimeControl` (class) from `index.ts`; `RTI.StepGrant` for the grant type.

Override methods by assigning or subclassing: `onReset`, `onLoadScenario(msg, playback) -> bool`, `onStart`, `onPlay`, `onPause`, `onEnd`, `onStop`, `onEndStop`, `onResetEndStop`, `onTimeScale(ts)`, `onTimeSync(msg)`, `onStepGrant(grant)`

Fast-time: `runtime.isFastTime`, `runtime.getStepGrant(timeoutMs=1000)` (returns `Promise<StepGrant | null>`), `runtime.completeStep(grant, failed?, reason?)`

**Important**: In Node.js the event loop processes incoming socket messages while `await`ing `getStepGrant()`, so a blocking timeout is safe and natural:
```typescript
while (true) {
    const grant = await runtime.getStepGrant()  // default 1000ms timeout
    if (grant === null) continue                 // timeout/stopped — loop again
    // do simulation work
    runtime.completeStep(grant)
}
```

On play/stop/end/reset, `resetFastTime()` resolves all pending `getStepGrant()` promises with `null` immediately.

See `js/test/runtimecontrol_example.ts` and `js/test/fasttime_example.ts` for working examples.

### Python (`python/inhumate_rti/rtiruntimecontrol.py`)

```python
runtime = RTI.RuntimeControl(rti)                          # real-time only
runtime = RTI.RuntimeControl(rti, fast_time=True)          # fast-time worker (get_step_grant pattern)
runtime = RTI.RuntimeControl(rti, step_fn=my_step)         # fast-time worker (callback pattern)
```

Override methods: `on_reset`, `on_load_scenario(msg, playback) -> bool`, `on_start`, `on_play`, `on_pause`, `on_end`, `on_stop`, `on_end_stop`, `on_reset_end_stop`, `on_time_scale(ts)`, `on_time_sync(msg)`, `on_step_grant(grant)`

Fast-time properties/methods: `runtime.is_fast_time`, `runtime.get_step_grant(timeout=30)`, `runtime.complete_step(grant, failed=False, reason="")`

**Important**: When using `main_loop=` (single-threaded `MainLoopDispatcher`), always call `get_step_grant(timeout=0)` (non-blocking). A blocking timeout stalls the socket read loop, preventing the StepGrant from being received. Blocking timeouts are safe in multi-threaded mode (no `main_loop=`).

See `python/test/fasttime_example.py` for a working example of both patterns.

### .NET (`dotnet/src/RTIRuntimeControl.cs`)

```csharp
var runtime = new RTIRuntimeControl(rti);                                    // real-time only
var runtime = new RTIRuntimeControl(rti, fastTime: true);                    // fast-time (GetStepGrant pattern)
var runtime = new RTIRuntimeControl(rti, stepFn: grant => { ... });         // fast-time (callback pattern)
```

Subclass and override virtual methods: `OnReset`, `OnLoadScenario(msg, playback) -> bool`, `OnStart`, `OnPlay`, `OnPause`, `OnEnd`, `OnStop`, `OnEndStop`, `OnResetEndStop`, `OnTimeScale(ts)`, `OnTimeSync(msg)`, `OnStepGrant(grant)`

Fast-time: `runtime.IsFastTime`, `runtime.GetStepGrant(timeout=30)`, `runtime.CompleteStep(grant, failed, reason)`

`GetStepGrant` uses `BlockingCollection` + `CancellationToken`; `ResetFastTime` (called on stop/end/reset) cancels the token to wake any blocked callers immediately.

**Important**: In polling mode (`rti.Polling = true`), call `GetStepGrant(timeout: 0)` (non-blocking) for the same reason as the Python `main_loop=` case.

See `../cli/Inhumate.CLI/MockSim/MockSim.cs` for an example using the subclassing pattern with `stepFn`.

### C++ (`cpp/rtiruntimecontrol.hpp` + `cpp/rtiruntimecontrol.cpp`)

```cpp
RTIRuntimeControl runtime(rti);                                                  // real-time only
RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);          // fast-time (GetStepGrant pattern)
RTIRuntimeControl runtime(rti, true, false, [](const StepGrant& g) { /*...*/ }); // fast-time (callback pattern)
```

Subclass and override virtual methods: `OnReset`, `OnLoadScenario(msg, playback) -> bool`, `OnStart`, `OnPlay`, `OnPause`, `OnEnd`, `OnStop`, `OnEndStop`, `OnResetEndStop`, `OnTimeScale(ts)`, `OnTimeSync(msg)`, `OnStepGrant(grant)`

Fast-time: `runtime.is_fast_time()`, `runtime.GetStepGrant()` (returns `std::unique_ptr<StepGrant>`, `nullptr` if none queued), `runtime.CompleteStep(grant, failed, reason)`

**Important**: C++ is polling-only — `GetStepGrant()` is always non-blocking. Drive it from your main loop:
```cpp
while (running) {
    rti.Poll();
    if (auto grant = runtime.GetStepGrant()) {
        // do simulation work
        runtime.CompleteStep(*grant);
    }
}
```

`WaitForApplicationState` / `WaitForClientState` call `rti.Poll()` internally while waiting and throw `std::runtime_error` on timeout.

### Shared behaviour (all four languages)

- Constructor auto-adds `runtime`, `scenario`, `timescale` capabilities (and `fasttimeworker` when fast-time is enabled)
- Runtime control channel subscriptions (`rti/control`) are always `IMMEDIATE` so stop/end/reset messages are processed even while in `BUFFERED` dispatch mode during a fast-time step
- On `Configure`: sends `Acknowledge`; dispatch mode stays `IMMEDIATE` (clients can still exchange messages during LOADING/READY)
- On a `Configuration` fast-time message with `mode <= REAL_TIME` (i.e. `UNKNOWN_MODE` or `REAL_TIME`): calls `ResetFastTime` — the run is not fast-time stepped, so the run id is cleared and fast-time mode is left
- On `StepGrant`: switches client to `BUFFERED` dispatch mode (first step), calls `flush_buffers()` / `FlushBuffers()` to dispatch messages buffered since last step, then calls `stepFn` (auto-completing) or queues for `GetStepGrant`
- On play: calls `ResetFastTime` — disables fast-time during playback (BUFFERED mode not needed)
- On stop/end/reset: calls `ResetFastTime` — drains grant queue, cancels waiters, restores `IMMEDIATE` dispatch mode
