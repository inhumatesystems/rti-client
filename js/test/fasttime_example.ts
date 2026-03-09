import * as RTI from "../src/index.js"

let simTime = 0.0

function update(dt: number) {
    console.log(`Update: simTime=${simTime.toFixed(3)} dt=${dt.toFixed(3)}`)
    // do simulation work
}

const rti = new RTI.Client({ application: "typescript_fasttime_example" })

// fast_time=true adds the fastTimeWorker capability and subscribes to rti/fasttimecontrol.
// When a Configure message arrives the helper automatically sends Acknowledge and
// switches the client to BUFFERED dispatch mode so that incoming messages are
// queued until flushBuffers() is called at step start.
const runtime = new RTI.RuntimeControl(rti, true, true)

rti.on("connect", () => { console.log("Connected") })
rti.on("disconnect", () => { console.log("Disconnected") })
rti.on("error", (e: any) => { console.error("Error:", e) })

// ---------------------------------------------------------------------------
// Main loop: async fast-time + real-time fallback
//
// In Node.js the event loop processes incoming socket messages while awaiting
// getStepGrant(), so a blocking timeout is safe. The default timeout (1000ms)
// means the loop will check for state changes at most once per second when idle.
// ---------------------------------------------------------------------------

async function simLoop() {
    let lastRealTime = Date.now()

    while (true) {
        if (runtime.isFastTime) {
            // Fast-time: wait for controller to grant the next step
            const grant = await runtime.getStepGrant(1000)
            if (grant !== null) {
                simTime = grant.startTime
                update(grant.timeStep)
                simTime = grant.endTime
                runtime.completeStep(grant)
            }
            // else: timeout (paused, no grant yet) — loop again
        } else if (rti.state === RTI.proto.RuntimeState.RUNNING) {
            // Real-time: advance sim time using wall clock
            const now = Date.now()
            const dt = (now - lastRealTime) / 1000
            lastRealTime = now
            simTime += dt * (runtime.timeScale ?? 1.0)
            update(dt)
            await sleep(10) // yield to event loop
        } else {
            lastRealTime = Date.now()
            await sleep(100) // idle
        }
    }
}

simLoop().catch(console.error)

// ---------------------------------------------------------------------------
// Alternative: stepFn pattern (simpler, no async loop needed)
//
//   function step(grant: RTI.StepGrant) {
//       update(grant.timeStep)
//       // completeStep() is called automatically after this function returns
//   }
//
//   const runtime2 = new RTI.RuntimeControl(rti, true, false, step)
// ---------------------------------------------------------------------------

process.on("SIGINT", () => {
    rti.disconnect()
    setTimeout(() => process.exit(0), 200)
})

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
