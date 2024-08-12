import * as RTI from "../src"

const rti = new RTI.Client({ application: "typescript test", user: "foo" })

rti.on("connect", () => {
    console.log("connected!")

    const sub = rti.subscribeText("text", (message: string) => {
        console.log(`received text: ${message}`)
    })
    const sub2 = rti.subscribeText("text", (message: string) => {
        console.log(`received text 2: ${message}`)
    })
    setTimeout(() => {
        rti.publishText("text", "foobar")
    }, 500)
    setTimeout(() => {
        rti.unsubscribe(sub2)
    }, 750)
    setTimeout(() => {
        rti.publishText("text", "only 1 should receive this")
    }, 1000)
    setTimeout(() => {
        rti.unsubscribe(sub)
    }, 1500)
    setTimeout(() => {
        rti.publishText("text", "should not receive this at all")
    }, 2000)

    rti.subscribe(RTI.channel.control, RTI.proto.RuntimeControl, (message: RTI.proto.RuntimeControl) => {
        console.log("received control message", message.toObject())
    })

    setTimeout(() => {
        console.log("publishing control message")
        const message = new RTI.proto.RuntimeControl()
        const loadScenario = new RTI.proto.RuntimeControl.LoadScenario()
        loadScenario.setName("foo")
        message.setLoadScenario(loadScenario)
        rti.publish(RTI.channel.control, message)
    }, 1000)

    setTimeout(() => {
        console.log("end")
        rti.disconnect()
    }, 3000)
})

rti.on("disconnect", () => {
    console.log("disconnected")
    process.exit(0)
})

rti.on("error", (message: any) => {
    console.error(`Error: ${message}`)
})
