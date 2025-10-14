<template>
    <header><h1>Inhumate RTI Vue Integration</h1></header>

    <main>
        <div>
            State: <span v-if="!rti.connected" class="red">Disconnected</span><span v-else class="green">{{ rti.stateText }}</span>
        </div>
        <div>
            <pre>{{ obj2str(rti.myClient) }}</pre>
        </div>
        <div v-if="rti.connectedClients.length > 0">
            <h3>Connected clients</h3>
            <span v-for="client in rti.connectedClients" :key="client.id" style="font: 12px monospace">
                {{ client.application + " " }}
            </span>
        </div>
        <div v-if="rti.channels.length > 0">
            <h3>Channels</h3>
            <span v-for="channel in rti.channels" :key="channel.name" style="font: 12px monospace">
                {{ channel.name + " " }}
            </span>
        </div>
        <image-subscription channel="image" type="image/jpeg" fade="0.1s" scale style="width: 500px; height: 300px; margin-top: 30px">
            <div style="opacity: 0.4; padding: 50px 20px 50px 20px; border: 1px solid grey">Try posting a jpeg image to the "image" channel, e.g. <pre>cat myimage.jpg | base64 | rti publish image</pre></div>
        </image-subscription>
    </main>
</template>

<script setup lang="ts">
import * as RTI from "inhumate-rti"
import { useRtiStore } from "@/rti"
import ImageSubscription from "../src/components/ImageSubscription.vue"

const rti = useRtiStore()
;(window as any).rti = rti
;(window as any).RTI = RTI

setTimeout(() => {
    rti.state = RTI.proto.RuntimeState.INITIAL
}, 1000)

// // this provokes a warning about publishing before first connect
// rti.client.publishText("foo", "bar")
// // publishing after disconnect automatically reconnects though...
// rti.client.whenConnected(() => rti.client.publishText("foo", "baz"))
// setTimeout(() => rti.client.disconnect(), 1000)
// setTimeout(() => rti.client.publishText("foo", "bazinga"), 2000)

rti.client.whenConnected(rti.requestClients)
rti.client.whenConnected(rti.requestChannels)

function obj2str(obj: any) {
    let str = ""
    for (const key in obj) if (obj[key]) str += `${key}: ${obj[key]}\n`
    return str
}
</script>
