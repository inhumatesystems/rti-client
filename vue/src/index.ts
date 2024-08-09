import type { App } from "vue"
import * as RTI from "inhumate-rti"
export { RTI }
import { useRtiStore } from "@/rti"
export { useRtiStore }
import RuntimeState from "./components/RuntimeState.vue"
export { RuntimeState }
import ImageSubscription from "./components/ImageSubscription.vue"
export { ImageSubscription}
import { version as vueVersion } from "vue"
import constants from "./constants"
export { constants }

export default {
    install: (app: App, options: RTI.Options) => {
        const url = new URL(location.href)
        if (!options.federation && url.searchParams.has("federation")) options.federation = url.searchParams.get("federation")!
        if (!options.user && url.searchParams.has("user")) options.user = url.searchParams.get("user")!
        if (!options.participant && url.searchParams.has("participant")) options.participant = url.searchParams.get("participant")!
        if (!options.role && url.searchParams.has("role")) options.role = url.searchParams.get("role")!
        if (!options.fullName && url.searchParams.has("full_name")) options.fullName = url.searchParams.get("full_name")!
        if (!options.host && url.searchParams.has("host")) options.host = url.searchParams.get("host")!
        if (!options.station && url.searchParams.has("station")) options.station = url.searchParams.get("station")!
        if (!options.engineVersion) options.engineVersion = `Vue ${vueVersion}`
        const client = new RTI.Client(options)
        app.provide("rti-client", client)
        app.component("RtiRuntimeState", RuntimeState)
        app.component("RtiImageSubscription", ImageSubscription)
    }
}
