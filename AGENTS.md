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
npm start            # Run usage example
```

### Vue (`vue/`)
```sh
npm install
npm run build        # Type-check + Vite library build
npm run test:unit    # Vitest unit tests
npm run lint         # ESLint with auto-fix
npm run format       # Prettier
```

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

### Protobuf Code Generation
```sh
scripts/get_protobuf.sh          # Download protobuf compiler v23.3
scripts/generate_all.sh          # Regenerate protobuf code for all clients
```
Each client also has its own `generate.sh` script. Generated code lives in `*/generated/` directories — do not edit these manually.

## Architecture

### Protocol Layer
All clients share the same protobuf definitions in `proto/` (33 `.proto` files). Message categories include: channels, clients, runtime state/control, entities, measurements, commands, logs, geometry, events, and injection/launch. Generated code is committed to each client's `generated/` directory.

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
- `index.ts` — public exports (`Client`, `Options`, `proto`, `constants`, `channel`, `capability`)
- `constants.ts` — channel names and capability constants

**Python** (`python/inhumate_rti/`):
- `rticlient.py` — `RTIClient` class
- `rtisocketclusterclient.py` — WebSocket transport layer
- `rtiruntimecontrol.py`, `rticommand.py` — runtime control and command execution (see Runtime Control Helper section below)
- `__init__.py` — exports `Client`, `RTIRuntimeControl`, `StepGrant`, `RTICommand`

**C++** (`cpp/`):
- `inhumaterti.hpp` + `inhumaterti.cpp` — single header/impl pair
- Dependencies: websocketpp, asio (both header-only), protobuf, OpenSSL

**.NET** (`dotnet/src/`):
- `RTIClient.cs` — main class
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

`RTIRuntimeControl` simplifies responding to runtime control messages (start, stop, reset, load scenario, time scale) and adds fast-time worker support. Implemented for **TypeScript/JavaScript**, **Python**, and **.NET**; C++ does not have this helper yet.

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

### Shared behaviour (all three languages)

- Constructor auto-adds `runtime`, `scenario`, `timescale` capabilities (and `fasttimeworker` when fast-time is enabled)
- Runtime control channel subscriptions (`rti/control`) are always `IMMEDIATE` so stop/end/reset messages are processed even while in `BUFFERED` dispatch mode during a fast-time step
- On `Configure`: sends `Acknowledge`; dispatch mode stays `IMMEDIATE` (clients can still exchange messages during LOADING/READY)
- On `StepGrant`: switches client to `BUFFERED` dispatch mode (first step), calls `flush_buffers()` / `FlushBuffers()` to dispatch messages buffered since last step, then calls `stepFn` (auto-completing) or queues for `GetStepGrant`
- On play: calls `ResetFastTime` — disables fast-time during playback (BUFFERED mode not needed)
- On stop/end/reset: calls `ResetFastTime` — drains grant queue, cancels waiters, restores `IMMEDIATE` dispatch mode
