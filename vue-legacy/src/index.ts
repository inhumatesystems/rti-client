import RTIClient, { Options as RTIOptions } from "@inhumate/rti-legacy"

import Vue, { VueConstructor } from "vue"
declare module "vue/types/vue" {
    export interface Vue {
        $rti: RTIClient
    }
    export interface VueConstructor {
        $rti: RTIClient
    }
}

import RuntimeState from "./components/RuntimeState.vue"
import ImageSubscription from "./components/ImageSubscription.vue"

const components = {
    RuntimeState,
    ImageSubscription,
    // don't forget to update exports below, and index.d.ts as well
}
export { RuntimeState, ImageSubscription }

import constants from "./constants"
export * from "./formatting"
import SubscribingComponent from "./components/subscribingcomponent"
export { constants, SubscribingComponent }

export interface RTIPluginOptions extends RTIOptions {
    store?: any
}
import { initializeStore } from "./store/rti"

const install = (Vue: VueConstructor, options: RTIPluginOptions) => {
    if ((install as any).installed) return
    ;(install as any).installed = true

    // Parse standard query params for RTI options
    const query = parseQuery(location.search)
    if ("sc_token" in query) localStorage["socketCluster.authToken"] = query.token
    if ("sct" in query && !("secret" in options)) options.secret = query.sct
    if ("federation" in query && !("federation" in options)) options.federation = query.federation
    if ("host" in query && !("host" in options)) options.host = query.host
    if ("station" in query && !("station" in options)) options.station = query.station
    if ("participant" in query && !("participant" in options)) options.participant = query.participant
    if ("role" in query && !("role" in options)) options.role = query.role
    if ("full_name" in query && !("fullName" in options)) options.fullName = query.full_name

    // Get temp token from hash
    {
        const tokenregexp = /sc_token=([A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/
        const match = location.hash.match(tokenregexp)
        if (match && match[1]) {
            localStorage["socketCluster.authToken"] = match[1]
            history.replaceState("", document.title, location.href.replace(tokenregexp, "").replace(/#$/, ""))
        }
    }

    // Get temp secret from hash
    if (!("secret" in options)) {
        const secretregexp = /sct=([^&]+)/
        const match = location.hash.match(secretregexp)
        if (match && match[1]) {
            options.secret = match[1]
            history.replaceState("", document.title, location.href.replace(secretregexp, "").replace(/#$/, ""))
        }
    }

    // RTI options from session storage
    if ("rtiFederation" in sessionStorage && !("federation" in options)) options.federation = sessionStorage.rtiFederation
    if (options.federation) sessionStorage.rtiFederation = options.federation
    else delete sessionStorage.rtiFederation

    if ("rtiHost" in sessionStorage && !("host" in options)) options.host = sessionStorage.rtiHost
    if (options.host) sessionStorage.rtiHost = options.host
    else delete sessionStorage.rtiHost

    if ("rtiStation" in sessionStorage && !("station" in options)) options.station = sessionStorage.rtiStation
    if (options.station) sessionStorage.rtiStation = options.station
    else delete sessionStorage.rtiStation

    if ("rtiParticipant" in sessionStorage && !("participant" in options)) options.participant = sessionStorage.rtiParticipant
    if (options.participant) sessionStorage.rtiParticipant = options.participant
    else delete sessionStorage.rtiParticipant

    if ("rtiRole" in sessionStorage && !("role" in options)) options.role = sessionStorage.rtiRole
    if (options.role) sessionStorage.rtiRole = options.role
    else delete sessionStorage.rtiRole

    if ("rtiFullName" in sessionStorage && !("fullName" in options)) options.fullName = sessionStorage.rtiFullName
    if (options.fullName) sessionStorage.rtiFullName = options.fullName
    else delete sessionStorage.rtiFullName

    // Install RTI mixin
    Vue.$rti = new RTIClient(options)
    Vue.mixin({
        beforeCreate() {
            this.$rti = Vue.$rti
        },
    })

    // Install components
    for (const key in components) {
        let name = key
        if (name.indexOf("Rti") != 0) name = "Rti" + name
        Vue.component(name, (components as any)[key])
    }

    if (options && options.store) initializeStore(options.store)
}

export default { ...components, install }

function parseQuery(queryString: string) {
    const query: any = {}
    const pairs = (queryString[0] === "?" ? queryString.substr(1) : queryString).split("&")
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i].split("=")
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "")
    }
    return query
}
