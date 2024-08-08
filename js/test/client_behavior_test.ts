import * as RTI from "../src"
import { TokenVerificationResult } from "../src/rticlient"

const rti = new RTI.Client({
    application: "typescript test",
    station: "station1",
})
rti.on("connect", () => {
    // console.log("connected")
})
rti.on("disconnect", () => {
    // console.log("disconnected")
})
rti.on("error", (message: string) => {
    if (message != "test") console.error(`error: ${message}`)
})

const rti2 = new RTI.Client({ application: "typescript test 2" })
rti2.on("error", (message: string) => {
    if (message != "test") console.error(`error: ${message} (2nd client)`)
})

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

beforeAll(async () => {
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

test("connects", async () => {
    expect(rti.isConnected).toBeTruthy()
})

test("broker version is set", async () => {
    await sleep(100)
    expect(rti.brokerVersion).toBeTruthy()
})

test("subscribe callbackerror errorevent called", async () => {
    let called = false
    rti.on("error", (message: string) => {
        called = true
    })
    rti.subscribeText("test", (message: any) => {
        throw "test"
    })
    rti.publishText("test", "foo")
    let count = 0
    while (!called && count++ < 50) await sleep(10)
    expect(called).toBeTruthy()
})

test("unsubscribe single listener", async () => {
    let received = false
    const subscription = rti.subscribeText("test", (message: any) => {
        received = true
    })
    rti.publishText("test", "foo")
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()

    let received2 = false
    rti.subscribeText("test", (message: any) => {
        received2 = true
    })
    received = false
    rti.unsubscribe(subscription)
    await sleep(100)
    rti.publishText("test", "foo")
    await sleep(100)
    expect(received).toBeFalsy()
    expect(received2).toBeTruthy()
})

test("pubsub json", async () => {
    let received = false
    rti.subscribeJSON("json", (message: any) => {
        if (message.foo == "bar") received = true
    })
    const message = { foo: "bar" }
    rti.publishJSON("json", message)
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("multichannel subscriber", async () => {
    let received: any = {}
    const handler = (channel: string, message: string) => {
        received[channel] = message
    }
    rti.subscribeText("channel1", handler)
    rti.subscribeText("channel2", handler)
    rti.publishText("channel1", "foo")
    rti.publishText("channel2", "bar")
    let count = 0
    while (Object.keys(received).length < 2 && count++ < 50) await sleep(10)
    expect(received["channel1"]).toEqual("foo")
    expect(received["channel2"]).toEqual("bar")
})

test("publish subscribe", async () => {
    let received = false
    rti.subscribe("control-test", RTI.proto.RuntimeControl, (message: RTI.proto.RuntimeControl) => {
        received = true
    })
    rti.publish("control-test", RTI.proto.RuntimeControl, { pause: {} })
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("responds to client request", async () => {
    // another client (rti2) requests clients. self.rti should respond.
    let received = false
    rti2.subscribe(RTI.channel.clients, RTI.proto.Clients, (message: RTI.proto.Clients) => {
        if (message.client && message.client.id == rti.clientId) received = true
    })
    rti2.publish(RTI.channel.clients, RTI.proto.Clients, { requestClients: {} })
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("responds to channels request", async () => {
    // another client (rti2) requests channels. self.rti should respond.
    let received = false
    rti2.subscribe(RTI.channel.channels, RTI.proto.Channels, (message: RTI.proto.Channels) => {
        if (message.channelUsage && message.channelUsage.clientId == rti.clientId) received = true
    })
    rti2.publish(RTI.channel.channels, RTI.proto.Channels, { requestChannelUsage: {} })
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("set state publishes client", async () => {
    let received = false
    rti.subscribe(RTI.channel.clients, RTI.proto.Clients, (message: RTI.proto.Clients) => {
        if (message.client && message.client.id == rti.clientId) received = true
    })

    rti.state = RTI.proto.RuntimeState.PLAYBACK

    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("publish error", async () => {
    let received = false
    rti.subscribe(RTI.channel.control, RTI.proto.RuntimeControl, (message: RTI.proto.RuntimeControl) => {
        if (message.error && message.error.clientId == rti.clientId) received = true
    })

    rti.publishError("test")

    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
})

test("subscribe before connect", async () => {
    let received = false
    const rti3 = new RTI.Client({ application: "typescript test 3" })
    rti3.subscribeText("test", (message: string) => {
        received = true
    })
    expect(rti3.isConnected).toBeFalsy()
    let count = 0
    while (!rti3.isConnected && count++ < 50) await sleep(10)
    rti.publishText("test", "well hello there")
    await sleep(100)
    expect(received).toBeTruthy()
    rti3.disconnect()
})

test("responds to measures request", async () => {
    const measure = RTI.proto.Measure.create({ id: "test" })
    rti.registerMeasure(measure)
    // another client (rti2) requests measures. self.rti should respond.
    let received = false
    const subscription = rti2.subscribe(RTI.channel.measures, RTI.proto.Measures, (message: RTI.proto.Measures) => {
        if (message.measure && message.measure.id == measure.id) received = true
    })
    rti2.publish(RTI.channel.measures, RTI.proto.Measures, { requestMeasures: {} })
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
    rti2.unsubscribe(subscription)
})

test("measure without interval publishes instantly", async () => {
    let received = false
    const subscription = rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, (measurement: RTI.proto.Measurement) => {
        expect(measurement.value).toBeCloseTo(42)
        received = true
    })
    rti.measure("test", 42)
    let count = 0
    while (!received && count++ < 50) await sleep(10)
    expect(received).toBeTruthy()
    rti.unsubscribe(subscription)
})

test("measure with interval - one measurement - publishes value", async () => {
    const measure = RTI.proto.Measure.create({ id: "interval", interval: 1 })
    let received = false

    const subscription = rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, (measurement: RTI.proto.Measurement) => {
        expect(measurement.value).toBeCloseTo(42)
        received = true
    })

    // Measure
    rti.measure(measure, 42)

    // Should not be published until interval (1s) passes
    await sleep(500)
    expect(received).toBeFalsy()

    // Should be published after ~1s
    let count = 0
    while (!received && count++ < 50) await sleep(100)
    expect(received).toBeTruthy()
    rti.unsubscribe(subscription)
})

test("measure with interval - multiple measurements - publishes tumbling window", async () => {
    const measure = RTI.proto.Measure.create({ id: "interval", interval: 1 })
    let received = false

    const subscription = rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, (measurement: RTI.proto.Measurement) => {
        expect(measurement.window!.count).toEqual(3)
        expect(measurement.window!.mean).toBeCloseTo(42)
        expect(measurement.window!.max).toBeCloseTo(44)
        expect(measurement.window!.min).toBeCloseTo(40)
        received = true
    })

    // Measure
    rti.measure(measure, 42)
    rti.measure(measure, 44)
    rti.measure(measure, 40)

    // Should not be published until interval (1s) passes
    await sleep(500)
    expect(received).toBeFalsy()

    // Should be published after ~1s
    let count = 0
    while (!received && count++ < 50) await sleep(100)
    expect(received).toBeTruthy()
    rti.unsubscribe(subscription)
})

test("participant registration for station - sets participant", async () => {
    rti2.publish(RTI.channel.clients, RTI.proto.Clients.encode({
        registerParticipant: RTI.proto.ParticipantRegistration.create({
            participant: "mr.foo",
            station: "station1"
        })
    }))

    await sleep(500)

    expect(rti.participant).toBe("mr.foo")
    expect(rti2.knownClients.find((c) => c.id == rti.clientId)?.participant).toBe("mr.foo")
})

test("participant registration for client - sets participant", async () => {
    rti2.registerParticipant("mr.foo")

    await sleep(500)

    expect(rti.participant).toBe("mr.foo")
    expect(rti2.knownClients.find((c) => c.id == rti.clientId)?.participant).toBe("mr.foo")
})

test("ephemeral channel registered after first use - updates to ephemeral", async () => {
    let received = false
    let ephemeral = false
    rti2.subscribeText("ephem", () => {
        received = true
        ephemeral = rti2.knownChannels.find((c) => c.name == "ephem")!.ephemeral
    })

    rti.publishText("ephem", "foo")
    await sleep(100)

    rti.registerChannel(RTI.proto.Channel.create({name: "ephem", ephemeral: true}))
    received = false
    rti.publishText("ephem", "bar")
    let count = 0
    while (!received && count++ < 50) await sleep(100)

    expect(received).toBeTruthy()
    expect(ephemeral).toBeTruthy()
})

test("verify own token - works", async () => {
    const result = await rti.verifyToken(rti.socket.signedAuthToken!)
    expect(result.error).toBeFalsy()
    await sleep(500)
})

test("verify borked token - results in error", async () => {
    const result = await rti.verifyToken("borked")
    expect(result.error).toBeTruthy()
    expect(result.error!.message).toContain("jwt malformed")
    await sleep(500)
})

test("broker rpc", async () => {
    const message = await rti.invoke("echo", "hello")
    expect(message).toBe("hello")
})

test("broker rpc error", async () => {
    try {
        const message = await rti.invoke("echo", "error test")
        fail()
    } catch (error) {
        expect(error).toBe("error test")
    }
})
