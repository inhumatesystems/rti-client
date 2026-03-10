import * as RTI from "../src"
import { RTIRuntimeControl, StepGrant } from "../src/rtiruntimecontrol"

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Helper: read rti.state without TypeScript literal-type narrowing
function rtiState(): RTI.proto.RuntimeState { return rti.state as RTI.proto.RuntimeState }

// Simulator client with RTIRuntimeControl
const rti = new RTI.Client({ application: "typescript runtimecontrol test" })
rti.on("error", (e: any) => { /* suppress */ })

// Controller client
const rti2 = new RTI.Client({ application: "typescript runtimecontrol test 2" })
rti2.on("error", (e: any) => { /* suppress */ })

let runtime: RTIRuntimeControl

beforeAll(async () => {
    runtime = new RTIRuntimeControl(rti)
    let count = 0
    while ((!rti.isConnected || !rti2.isConnected) && count++ < 50) await sleep(100)
})

afterAll(async () => {
    rti.kill()
    rti2.kill()
    await sleep(100)
    ;(rti.socket as any)._destroy()
    ;(rti2.socket as any)._destroy()
})

// --- State/capability tests ---

test("state starts at INITIAL", () => {
    expect(rti.state).toBe(RTI.proto.RuntimeState.INITIAL)
})

test("capabilities include runtime, scenario, timescale", () => {
    expect(rti.capabilities).toContain(RTI.capability.runtimeControl)
    expect(rti.capabilities).toContain(RTI.capability.scenario)
    expect(rti.capabilities).toContain(RTI.capability.timeScale)
})

test("fast time capability added when fastTime=true", () => {
    const rti3 = new RTI.Client({ application: "typescript runtimecontrol test 3" })
    const rt3 = new RTIRuntimeControl(rti3, false, true)
    expect(rti3.capabilities).toContain(RTI.capability.fastTimeWorker)
    rti3.kill()
})

// --- Runtime control message tests ---

test("reset sets state to INITIAL and calls onReset", async () => {
    let onResetCalled = false
    let onResetEndStopCalled = false
    runtime.onReset = () => { onResetCalled = true }
    runtime.onResetEndStop = () => { onResetEndStopCalled = true }
    rti.state = RTI.proto.RuntimeState.RUNNING
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { reset: {} })
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.INITIAL && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.INITIAL)
    expect(onResetCalled).toBe(true)
    expect(onResetEndStopCalled).toBe(true)
    runtime.onReset = () => {}
    runtime.onResetEndStop = () => {}
})

test("load scenario sets state to READY and stores scenario", async () => {
    let loadScenarioCalled = false
    runtime.onLoadScenario = (ls, playback) => { loadScenarioCalled = true; return true }
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { loadScenario: { name: "test-scenario", parameterValues: {} } })
    let count = 0
    while (rti.state !== RTI.proto.RuntimeState.READY && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.READY)
    expect(runtime.scenario?.name).toBe("test-scenario")
    expect(loadScenarioCalled).toBe(true)
    runtime.onLoadScenario = () => true
})

test("load scenario returning false sets state to UNKNOWN", async () => {
    runtime.onLoadScenario = () => false
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { loadScenario: { name: "fail-scenario", parameterValues: {} } })
    let count = 0
    while (rti.state !== RTI.proto.RuntimeState.UNKNOWN && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.UNKNOWN)
    expect(runtime.scenario).toBeUndefined()
    runtime.onLoadScenario = () => true
})

test("start sets state to RUNNING and calls onStart", async () => {
    let called = false
    runtime.onStart = () => { called = true }
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { start: {} })
    let count = 0
    while (rti.state !== RTI.proto.RuntimeState.RUNNING && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.RUNNING)
    expect(called).toBe(true)
    runtime.onStart = () => {}
})

test("pause sets state to PAUSED and calls onPause", async () => {
    let called = false
    runtime.onPause = () => { called = true }
    rti.state = RTI.proto.RuntimeState.RUNNING
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { pause: {} })
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.PAUSED && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.PAUSED)
    expect(called).toBe(true)
    runtime.onPause = () => {}
})

test("play sets state to PLAYBACK and calls onPlay", async () => {
    let called = false
    runtime.onPlay = () => { called = true }
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { play: {} })
    let count = 0
    while (rti.state !== RTI.proto.RuntimeState.PLAYBACK && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.PLAYBACK)
    expect(called).toBe(true)
    runtime.onPlay = () => {}
})

test("end sets state to END and calls onEnd/onEndStop/onResetEndStop", async () => {
    let endCalled = false, endStopCalled = false, resetEndStopCalled = false
    runtime.onEnd = () => { endCalled = true }
    runtime.onEndStop = () => { endStopCalled = true }
    runtime.onResetEndStop = () => { resetEndStopCalled = true }
    rti.state = RTI.proto.RuntimeState.RUNNING
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { end: {} })
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.END && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.END)
    expect(endCalled).toBe(true)
    expect(endStopCalled).toBe(true)
    expect(resetEndStopCalled).toBe(true)
    runtime.onEnd = () => {}
    runtime.onEndStop = () => {}
    runtime.onResetEndStop = () => {}
})

test("stop sets state to STOPPED and calls onStop/onEndStop/onResetEndStop", async () => {
    let stopCalled = false, endStopCalled = false, resetEndStopCalled = false
    runtime.onStop = () => { stopCalled = true }
    runtime.onEndStop = () => { endStopCalled = true }
    runtime.onResetEndStop = () => { resetEndStopCalled = true }
    rti.state = RTI.proto.RuntimeState.RUNNING
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { stop: {} })
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.STOPPED && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.STOPPED)
    expect(stopCalled).toBe(true)
    expect(endStopCalled).toBe(true)
    expect(resetEndStopCalled).toBe(true)
    runtime.onStop = () => {}
    runtime.onEndStop = () => {}
    runtime.onResetEndStop = () => {}
})

test("stop during playback sets state to PLAYBACK_STOPPED", async () => {
    rti.state = RTI.proto.RuntimeState.PLAYBACK
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { stop: {} })
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.PLAYBACK_STOPPED && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.PLAYBACK_STOPPED)
})

test("set time scale calls onTimeScale and stores value", async () => {
    let receivedScale: number | undefined
    runtime.onTimeScale = (ts) => { receivedScale = ts }
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { setTimeScale: { timeScale: 2.5 } })
    let count = 0
    while (receivedScale === undefined && count++ < 50) await sleep(10)
    expect(receivedScale).toBeCloseTo(2.5)
    expect(runtime.timeScale).toBeCloseTo(2.5)
    runtime.onTimeScale = () => {}
})

test("time sync calls onTimeSync and stores timeScale", async () => {
    let received: RTI.proto.RuntimeControl_TimeSync | undefined
    runtime.onTimeSync = (ts) => { received = ts }
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { timeSync: { time: 10.0, timeScale: 1.5, masterClientId: "master" } })
    let count = 0
    while (received === undefined && count++ < 50) await sleep(10)
    expect(received!.timeScale).toBeCloseTo(1.5)
    expect(runtime.timeScale).toBeCloseTo(1.5)
    runtime.onTimeSync = () => {}
})

// --- RTIRuntimeControl publish methods ---

test("runtime.start() publishes start and sets state to RUNNING", async () => {
    // Reset state first
    rti.state = RTI.proto.RuntimeState.INITIAL
    runtime.start()
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.RUNNING && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.RUNNING)
})

test("runtime.stop() publishes stop and sets state to STOPPED", async () => {
    rti.state = RTI.proto.RuntimeState.RUNNING
    runtime.stop()
    let count = 0
    while (rtiState() !== RTI.proto.RuntimeState.STOPPED && count++ < 50) await sleep(10)
    expect(rti.state).toBe(RTI.proto.RuntimeState.STOPPED)
})

// --- Subclass override pattern ---

test("subclass can override hooks", async () => {
    class MySim extends RTIRuntimeControl {
        startCalled = false
        override onStart() { this.startCalled = true }
    }
    const rti4 = new RTI.Client({ application: "typescript runtimecontrol test 4" })
    rti4.on("error", () => {})
    const sim = new MySim(rti4)
    let count = 0
    while (!rti4.isConnected && count++ < 50) await sleep(100)
    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { start: {} })
    count = 0
    while (!sim.startCalled && count++ < 50) await sleep(10)
    expect(sim.startCalled).toBe(true)
    rti4.kill()
    ;(rti4.socket as any)._destroy()
})

// --- Fast-time tests ---

test("fast time configure sends acknowledge and stays IMMEDIATE until first step", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    let ackReceived = false
    rti2.subscribe(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, (msg: RTI.proto.FastTimeControl) => {
        if (msg.acknowledge && msg.acknowledge.clientId === rtiFt.clientId) ackReceived = true
    })

    const runId = "test-run-1"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!ackReceived && count++ < 50) await sleep(10)
    expect(ackReceived).toBe(true)
    expect(rtiFt.fastTimeMode).toBe(true)
    expect(rtFt.isFastTime).toBe(true)
    // Dispatch mode should still be IMMEDIATE after configure — only switches on first step grant
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.IMMEDIATE)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("first step grant switches dispatch mode to BUFFERED", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 1b" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-1b"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.IMMEDIATE)

    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        stepGrant: { runId, stepNumber: 1, startTime: 0.0, endTime: 0.1 }
    })
    const grant = await rtFt.getStepGrant(1000)
    expect(grant).not.toBeNull()
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.BUFFERED)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("play during fast time resets fast time mode", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 1c" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-1c"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)
    expect(rtFt.isFastTime).toBe(true)

    rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { play: {} })
    count = 0
    while (rtFt.isFastTime && count++ < 50) await sleep(10)
    expect(rtFt.isFastTime).toBe(false)
    expect(rtiFt.fastTimeMode).toBe(false)
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.IMMEDIATE)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("getStepGrant returns grant and completeStep sends StepComplete", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 2" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-2"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)

    let stepCompleteReceived = false
    rti2.subscribe(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, (msg: RTI.proto.FastTimeControl) => {
        if (msg.stepComplete && msg.stepComplete.clientId === rtiFt.clientId && msg.stepComplete.stepNumber === 1) {
            stepCompleteReceived = true
        }
    })

    // Publish step grant
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        stepGrant: { runId, stepNumber: 1, startTime: 0.0, endTime: 0.1 }
    })

    const grant = await rtFt.getStepGrant(1000)
    expect(grant).not.toBeNull()
    expect(grant!.stepNumber).toBe(1)
    expect(grant!.startTime).toBeCloseTo(0.0)
    expect(grant!.endTime).toBeCloseTo(0.1)
    expect(grant!.timeStep).toBeCloseTo(0.1)

    rtFt.completeStep(grant!)
    count = 0
    while (!stepCompleteReceived && count++ < 50) await sleep(10)
    expect(stepCompleteReceived).toBe(true)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("getStepGrant returns null on timeout", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 3" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const grant = await rtFt.getStepGrant(50) // 50ms timeout, no grant sent
    expect(grant).toBeNull()

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("stop during fast time wakes getStepGrant with null", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 4" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-stop"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)

    // Start waiting for a grant (long timeout)
    const grantPromise = rtFt.getStepGrant(5000)

    // After a short delay, send stop
    setTimeout(() => {
        rti2.publish(RTI.channel.control, RTI.proto.RuntimeControl, { stop: {} })
    }, 50)

    const grant = await grantPromise
    expect(grant).toBeNull()
    expect(rtFt.isFastTime).toBe(false)
    expect(rtiFt.fastTimeMode).toBe(false)
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.IMMEDIATE)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("stepFn callback is called with grant", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 5" })
    rtiFt.on("error", () => {})
    let stepFnCalled = false
    let receivedGrant: StepGrant | undefined
    const rtFt = new RTIRuntimeControl(rtiFt, true, false, (grant) => {
        stepFnCalled = true
        receivedGrant = grant
    })
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-stepfn"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.05 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)

    let stepCompleteReceived = false
    rti2.subscribe(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, (msg: RTI.proto.FastTimeControl) => {
        if (msg.stepComplete && msg.stepComplete.clientId === rtiFt.clientId) stepCompleteReceived = true
    })

    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        stepGrant: { runId, stepNumber: 1, startTime: 0.0, endTime: 0.05 }
    })
    count = 0
    while (!stepFnCalled && count++ < 50) await sleep(10)
    expect(stepFnCalled).toBe(true)
    expect(receivedGrant!.timeStep).toBeCloseTo(0.05)

    count = 0
    while (!stepCompleteReceived && count++ < 50) await sleep(10)
    expect(stepCompleteReceived).toBe(true)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("controller disconnect resets fast time when not running/paused", async () => {
    const rtiCtrl = new RTI.Client({ application: "typescript fasttime ctrl test" })
    rtiCtrl.on("error", () => {})
    const rtiFt = new RTI.Client({ application: "typescript fasttime worker test" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while ((!rtiCtrl.isConnected || !rtiFt.isConnected) && count++ < 50) await sleep(100)

    const runId = "test-run-ctrl-disc"
    rtiCtrl.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rtiCtrl.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)
    expect(rtFt.isFastTime).toBe(true)

    // Disconnect the controller while in non-running/paused state (INITIAL)
    rtiCtrl.kill()
    ;(rtiCtrl.socket as any)._destroy()
    count = 0
    while (rtFt.isFastTime && count++ < 100) await sleep(10)
    expect(rtFt.isFastTime).toBe(false)
    expect(rtiFt.fastTimeMode).toBe(false)
    expect(rtiFt.defaultDispatchMode).toBe(RTI.DispatchMode.IMMEDIATE)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("controller disconnect does not reset fast time when running", async () => {
    const rtiCtrl = new RTI.Client({ application: "typescript fasttime ctrl running test" })
    rtiCtrl.on("error", () => {})
    const rtiFt = new RTI.Client({ application: "typescript fasttime worker running test" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let count = 0
    while ((!rtiCtrl.isConnected || !rtiFt.isConnected) && count++ < 50) await sleep(100)

    const runId = "test-run-ctrl-running"
    rtiCtrl.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rtiCtrl.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)
    rtiFt.state = RTI.proto.RuntimeState.RUNNING

    rtiCtrl.kill()
    ;(rtiCtrl.socket as any)._destroy()
    await sleep(200)
    // Fast time should still be active when disconnect happens during RUNNING
    expect(rtFt.isFastTime).toBe(true)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})

test("fast time capability added when stepFn is provided", () => {
    const rti5 = new RTI.Client({ application: "typescript runtimecontrol test 5" })
    const rt5 = new RTIRuntimeControl(rti5, false, false, () => {})
    expect(rti5.capabilities).toContain(RTI.capability.fastTimeWorker)
    rti5.kill()
})

test("onStepGrant hook is called in getStepGrant pattern", async () => {
    const rtiFt = new RTI.Client({ application: "typescript fasttime test 6" })
    rtiFt.on("error", () => {})
    const rtFt = new RTIRuntimeControl(rtiFt, true, true)
    let onStepGrantCalled = false
    rtFt.onStepGrant = () => { onStepGrantCalled = true }
    let count = 0
    while (!rtiFt.isConnected && count++ < 50) await sleep(100)

    const runId = "test-run-hook"
    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        configure: { controllerClientId: rti2.clientId, runId, timeStep: 0.1 }
    })
    count = 0
    while (!rtFt.isFastTime && count++ < 50) await sleep(10)

    rti2.publish(RTI.channel.fastTimeControl, RTI.proto.FastTimeControl, {
        stepGrant: { runId, stepNumber: 1, startTime: 0.0, endTime: 0.1 }
    })
    count = 0
    while (!onStepGrantCalled && count++ < 50) await sleep(10)
    expect(onStepGrantCalled).toBe(true)

    rtiFt.kill()
    ;(rtiFt.socket as any)._destroy()
})
