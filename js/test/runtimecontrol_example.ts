import * as RTI from "../src/index.js"

let simTime = 0.0

function update(dt: number) {
    console.log(`Update: simTime=${simTime.toFixed(3)} dt=${dt.toFixed(3)}`)
    // do simulation work
}

const rti = new RTI.Client({ application: "typescript_runtimecontrol_example" })
const runtime = new RTI.RuntimeControl(rti)

runtime.onStart = () => { console.log("Simulation started") }
runtime.onStop = () => { console.log("Simulation stopped") }
runtime.onEnd = () => { console.log("Simulation ended") }
runtime.onReset = () => { console.log("Simulation reset"); simTime = 0.0 }
runtime.onLoadScenario = (scenario, playback) => {
    console.log(`Loading scenario: ${scenario.name}`)
    return true
}
runtime.onTimeScale = (ts) => { console.log(`Time scale: ${ts}`) }

rti.on("connect", () => { console.log("Connected") })
rti.on("disconnect", () => { console.log("Disconnected") })
rti.on("error", (e: any) => { console.error("Error:", e) })

// Simulation loop using setInterval (Node.js real-time pattern)
let lastTime = Date.now()
const interval = setInterval(() => {
    if (rti.state === RTI.proto.RuntimeState.RUNNING) {
        const now = Date.now()
        const dt = (now - lastTime) / 1000
        lastTime = now
        simTime += dt * (runtime.timeScale ?? 1.0)
        update(dt)
    } else {
        lastTime = Date.now() // keep lastTime current when idle
    }
}, 10)

process.on("SIGINT", () => {
    clearInterval(interval)
    rti.disconnect()
    setTimeout(() => process.exit(0), 200)
})
