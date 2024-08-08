import Vue from "vue"
import { Module, VuexModule, Mutation, Action } from "vuex-module-decorators"
import * as RTI from "@inhumate/rti-legacy"
import constants from "@/constants"

@Module({ namespaced: true })
export default class RTIStore extends VuexModule {
    connected = false
    user = ""
    password = ""
    participant = ""
    role = ""
    fullName = ""
    needAuthentication = false
    time: number | null = null
    timeScale: number | null = null
    stopTime: number | null = null
    federations: string[] = []
    federation = ""
    clients: RTI.proto.Client[] = []
    logClients: RTI.proto.Client[] = []
    errors: RTI.proto.RuntimeControl.Error[] = []
    channels: RTI.proto.Channel[] = []
    publishers: { [key: string]: string[] } = {}
    subscribers: { [key: string]: string[] } = {}
    log: RTI.proto.Log | null = null
    runtimeState: RTI.proto.RuntimeStateMap[keyof RTI.proto.RuntimeStateMap] = RTI.proto.RuntimeState.UNKNOWN
    states: { [key: number]: number } = {}
    aggregatedState: number | null = null
    error: string | null = null
    // injectables: RTI.Injectable[] = []
    // injections: RTI.Injection[] = []
    private brokerStatsByWorker: any = {}
    brokerStats: any | null = null
    private brokerPingsByWorker: any = {}
    brokerPings: { [key: string]: number } = {}
    selectedScenarioName = ""
    scenarioParameterValues: { [key: string]: { [key: string]: string } } = {}
    selectedLaunchConfigurationName = ""
    launchParameterValues: { [key: string]: { [key: string]: string } } = {}
    // injectParameterValues: { [key: string]: { [key: string]: string } } = {}

    subscribedClients = false
    subscribedChannels = false
    subscribedInjectables = false
    subscribedInjections = false
    subscribedBrokerStats = false
    subscribedBrokerPings = false
    recorderAvailable = false
    recorderApiAvailable = false

    brand: any = {}

    get clientById() {
        return (clientId: string) => {
            if (clientId == Vue.$rti.clientId) return Vue.$rti.myClient
            let client = this.clients.find((c) => c.getId() == clientId)
            if (!client) client = this.logClients.find((c) => c.getId() == clientId)
            if (!client) {
                client = new RTI.proto.Client()
                client.setId(clientId)
            }
            return client
        }
    }

    get stations() {
        const stations: string[] = []
        for (const client of this.clients) {
            if (!stations.includes(client.getStation().toUpperCase())) stations.push(client.getStation().toUpperCase())
        }
        return stations.sort()
    }

    get hosts() {
        const hosts: string[] = []
        for (const client of this.clients) {
            if (!hosts.includes(client.getHost().toUpperCase())) hosts.push(client.getHost().toUpperCase())
        }
        return hosts.sort()
    }

    get recorderClient() {
        return this.clients.find((c) => c.getCapabilitiesList().includes(RTI.capability.log))
    }

    get hostsByStation() {
        return (station: string | undefined) => {
            const hosts: string[] = []
            let clients = this.clients
            if (typeof station != "undefined") clients = this.clients.filter((c) => c.getStation().toUpperCase() == station.toUpperCase())
            for (const client of clients) {
                if (!hosts.includes(client.getHost().toUpperCase())) hosts.push(client.getHost().toUpperCase())
            }
            return hosts.sort()
        }
    }

    get applicationIcon() {
        return (id: string) => {
            switch (id) {
                case "RTI UI":
                case "Control UI":
                case "ControlUI":
                case "Control":
                    return "mdi-play"
                case "Viewer":
                    return "mdi-image-outline"
                case "Recorder":
                    return "mdi-database"
                case "Launcher":
                    return "mdi-rocket-launch"
                case "AVRecorder":
                    return "mdi-video"
                case "AVPlayer":
                case "A/V Player":
                    return "mdi-video-image"
                case "FMVCS":
                case "Radio":
                case "Radiobot":
                case "Voice":
                case "Voicecom":
                case "Voicebot":
                    return "mdi-headset"
                default:
                    return null
            }
        }
    }

    get applicationOrder() {
        return (id: string) => {
            switch (id) {
                case "RTI UI":
                case "Control UI":
                case "ControlUI":
                case "Control":
                    return 6
                case "Viewer":
                    return 5
                case "Recorder":
                    return 3
                case "Launcher":
                    return 4
                case "AVRecorder":
                    return 2
                case "FMVCS":
                case "Radio":
                case "Radiobot":
                case "Voice":
                case "Voicecom":
                case "Voicebot":
                    return 1
                default:
                    return 0
            }
        }
    }

    get clientsByHostAndStation() {
        return (station: string | undefined, host: string | undefined) => {
            const clients: RTI.proto.Client[] = this.clients.filter(
                (c) =>
                    (typeof station == undefined || c.getStation().toUpperCase() == station!.toUpperCase()) &&
                    (typeof host == undefined || c.getHost().toUpperCase() == host!.toUpperCase())
            )
            return clients.sort((a, b) => {
                const aOrder = this.applicationOrder(a.getApplication())
                const bOrder = this.applicationOrder(b.getApplication())
                if (aOrder && bOrder) {
                    if (aOrder == bOrder) return a.getId().localeCompare(b.getId())
                    return aOrder > bOrder ? 1 : -1
                } else if (aOrder) {
                    return -1
                } else if (bOrder) {
                    return 1
                } else {
                    return a.getApplication().localeCompare(b.getApplication())
                }
            })
        }
    }

    @Mutation
    login(credentials: any) {
        this.user = credentials.user
        this.password = credentials.password
        Vue.$rti.setCredentials(this.user, this.password)
        Vue.$rti.connect()
        this.needAuthentication = false
    }

    @Mutation
    logout() {
        this.connected = false
        this.password = ""
        Vue.$rti.disconnect()
        this.needAuthentication = true
        delete localStorage["socketCluster.authToken"]
    }

    @Mutation
    updateRuntimeState(state: RTI.proto.RuntimeStateMap[keyof RTI.proto.RuntimeStateMap]) {
        this.runtimeState = state
    }

    @Mutation
    updateClient(client: RTI.proto.Client) {
        if (client.getId() == Vue.$rti.clientId) return
        const index = this.clients.findIndex((c) => c.getId() == client.getId())
        if (index < 0) {
            this.clients.push(client)
        } else {
            this.clients.splice(index, 1, client)
        }

        const isTransientState = (state: number) => {
            return (
                state == RTI.proto.RuntimeState.LOADING ||
                state == RTI.proto.RuntimeState.STOPPING ||
                state == RTI.proto.RuntimeState.LAUNCHING ||
                state == RTI.proto.RuntimeState.SHUTTING_DOWN
            )
        }

        const isActiveState = (state: number) => {
            return (
                state != RTI.proto.RuntimeState.INACTIVE &&
                (state == RTI.proto.RuntimeState.RUNNING ||
                    state == RTI.proto.RuntimeState.PLAYBACK ||
                    state == RTI.proto.RuntimeState.LAUNCHED)
            )
        }

        this.aggregatedState = null
        this.states = {}
        let recorderFound = false
        for (const client of this.clients) {
            if (client.getCapabilitiesList().includes(RTI.capability.log)) recorderFound = true
            const state = client.getState()

            if (!isActiveState(state) && !isTransientState(state)) {
                continue
            }

            if (!this.states[client.getState()]) this.states[client.getState()] = 1
            else this.states[client.getState()]++

            const expected = state
            if (expected) {
                if (!this.aggregatedState) {
                    this.aggregatedState = expected
                } else if (this.aggregatedState != expected) {
                    if (
                        this.aggregatedState == RTI.proto.RuntimeState.SHUT_DOWN ||
                        this.aggregatedState == RTI.proto.RuntimeState.LAUNCHED ||
                        expected == RTI.proto.RuntimeState.RUNNING ||
                        expected == RTI.proto.RuntimeState.PLAYBACK ||
                        (!isTransientState(this.aggregatedState) &&
                            (isTransientState(expected) ||
                                (this.aggregatedState <= RTI.proto.RuntimeState.INITIAL && expected > this.aggregatedState) ||
                                (this.aggregatedState >= RTI.proto.RuntimeState.PAUSED &&
                                    expected > this.aggregatedState &&
                                    expected != RTI.proto.RuntimeState.SHUT_DOWN)))
                    ) {
                        this.aggregatedState = expected
                    } else if (
                        expected == RTI.proto.RuntimeState.SHUT_DOWN ||
                        expected == RTI.proto.RuntimeState.LAUNCHED ||
                        this.aggregatedState == RTI.proto.RuntimeState.RUNNING ||
                        this.aggregatedState == RTI.proto.RuntimeState.PLAYBACK ||
                        (isTransientState(this.aggregatedState) && !isTransientState(expected)) ||
                        (this.aggregatedState > expected && expected >= RTI.proto.RuntimeState.PAUSED)
                    ) {
                        // let aggregatedState be
                    } else {
                        this.aggregatedState = -1
                    }
                }
            }
        }
        if (recorderFound != this.recorderAvailable) {
            Vue.set(this, "recorderAvailable", recorderFound)
            if (!recorderFound) {
                Vue.set(this, "log", null)
                Vue.set(this, "recorderApiAvailable", false)
            }
        }
        Vue.set(this, "clients", this.clients)
    }

    @Mutation
    removeClient(clientId: string) {
        const index = this.clients.findIndex((c) => c.getId() == clientId)
        if (index >= 0) {
            this.clients.splice(index, 1)
        }
        Vue.set(this, "clients", this.clients)
    }

    @Mutation
    updateLogClient(client: RTI.proto.Client) {
        if (client.getId() == Vue.$rti.clientId) return
        const index = this.logClients.findIndex((c) => c.getId() == client.getId())
        if (index < 0) {
            this.logClients.push(client)
        } else {
            this.logClients.splice(index, 1, client)
        }
    }

    @Mutation
    updateChannel(channel: RTI.proto.Channel) {
        const index = this.channels.findIndex((c) => c.getName() == channel.getName())
        if (index < 0) {
            this.channels.push(channel)
        } else {
            this.channels.splice(index, 1, channel)
        }
    }

    @Mutation
    updateChannelUsage(usage: RTI.proto.ChannelUsage) {
        const clientId = usage.getClientId()
        for (const use of usage.getUsageList()) {
            const channel = use.getChannel()!
            if (!this.channels.find((c) => c.getName() == channel.getName())) {
                this.channels.push(channel)
            }
            const name = channel.getName()
            if (use.getPublish()) {
                if (!(name in this.publishers)) this.publishers[name] = []
                if (!this.publishers[name].includes(clientId)) this.publishers[name].push(clientId)
            }
            if (use.getSubscribe()) {
                if (!(name in this.subscribers)) this.subscribers[name] = []
                if (!this.subscribers[name].includes(clientId)) this.subscribers[name].push(clientId)
            }
        }
    }

    @Action
    setRuntimeState(state: RTI.proto.RuntimeStateMap[keyof RTI.proto.RuntimeStateMap]) {
        Vue.$rti.state = state
        this.context.commit("updateRuntimeState", state)
    }

    @Action
    requestClients() {
        const message = new RTI.proto.Clients()
        message.setRequestClients(new RTI.proto.Empty())
        Vue.$rti.publish(RTI.channel.clients, message, false)
    }

    @Action
    subscribeClients() {
        if (this.subscribedClients) return
        Vue.$rti.subscribe(
            RTI.channel.clients,
            RTI.proto.Clients,
            (message: RTI.proto.Clients) => {
                switch (message.getWhichCase()) {
                    case RTI.proto.Clients.WhichCase.CLIENT:
                        this.context.commit("updateClient", message.getClient())
                        break
                    case RTI.proto.Clients.WhichCase.LOG_CLIENT:
                        this.context.commit("updateLogClient", message.getLogClient())
                        break
                }
            },
            false
        )
        Vue.$rti.subscribeText(
            RTI.channel.clientDisconnect,
            (clientId: string) => {
                setTimeout(() => {
                    this.context.commit("removeClient", clientId)
                    // the client might still be there (e.g. another browser tab from same instance, so let's re-request)
                    this.context.dispatch("requestClients")
                }, 250)
            },
            false
        )
        this.context.commit("setSubscribedClients")
        Vue.$rti.whenConnected(() => this.context.dispatch("requestClients"))
    }

    @Mutation
    setSubscribedClients() {
        this.subscribedClients = true
    }

    @Mutation
    clearClients() {
        this.clients = []
    }

    @Action
    requestChannels() {
        const message = new RTI.proto.Channels()
        message.setRequestChannelUsage(new RTI.proto.Empty())
        Vue.$rti.publish(RTI.channel.channels, message, false)
    }

    @Action
    subscribeChannels() {
        if (this.subscribedChannels) return
        Vue.$rti.subscribe(
            RTI.channel.channels,
            RTI.proto.Channels,
            (message: RTI.proto.Channels) => {
                switch (message.getWhichCase()) {
                    case RTI.proto.Channels.WhichCase.CHANNEL:
                        this.context.commit("updateChannel", message.getChannel())
                        break
                    case RTI.proto.Channels.WhichCase.CHANNEL_USAGE:
                        this.context.commit("updateChannelUsage", message.getChannelUsage())
                        break
                }
            },
            false
        )
        this.context.commit("setSubscribedChannels")
        Vue.$rti.whenConnected(() => this.context.dispatch("requestChannels"))
    }

    @Mutation
    setSubscribedChannels() {
        this.subscribedChannels = true
    }

    @Mutation
    clearChannels() {
        this.channels = []
    }

    @Mutation
    updateLog(log: RTI.proto.Log | null) {
        if (this.log && (!log || this.log.getId() != log!.getId())) {
            this.logClients = []
        }
        this.log = log
    }

    @Action
    requestCurrentLog() {
        const message = new RTI.proto.RuntimeControl()
        message.setRequestCurrentLog(new RTI.proto.Empty())
        Vue.$rti.publish(RTI.channel.control, message, false)
    }

    @Action
    deleteLog(id: string) {
        const message = new RTI.proto.Logs()
        message.setDeleteLog(id)
        Vue.$rti.publish(RTI.channel.logs, message, false)
    }

    @Action
    registerParticipant(payload: any) {
        Vue.$rti.registerParticipant(payload.id, payload.role, payload.fullName)
        if (payload.id) sessionStorage.rtiParticipant = payload.id
        else delete sessionStorage.rtiParticipant
        if (payload.role) sessionStorage.rtiRole = payload.role
        else delete sessionStorage.rtiRole
        if (payload.fullName) sessionStorage.rtiFullName = payload.fullName
        else delete sessionStorage.rtiFullName
    }

    @Action
    unregisterParticipant() {
        Vue.$rti.registerParticipant("")
        delete sessionStorage.rtiParticipant
        delete sessionStorage.rtiRole
        delete sessionStorage.rtiFullName
    }

    @Mutation
    setRecorderApiAvailable(value = true) {
        this.recorderApiAvailable = value
    }

    @Action
    probeRecorderApi() {
        let recorderUrl = this.recorderClient?.getUrl()
        if (!recorderUrl && location.hostname == "localhost") recorderUrl = "http://localhost:8001"
        if (!this.recorderClient) {
            this.context.commit("setRecorderApiAvailable", false)
            return
        }
        if (!recorderUrl) {
            console.warn("There is a recorder available, but it has no url")
            this.context.commit("setRecorderApiAvailable", false)
            return
        }
        const request = new XMLHttpRequest()
        request.open("GET", `${recorderUrl}/download/probe?sc_token=${localStorage["socketCluster.authToken"]}`)
        request.onloadend = (progress) => {
            if (!progress || !progress.currentTarget) return
            const response = progress.currentTarget as XMLHttpRequest
            if (response.status != 200) {
                console.warn("Recorder API probe failed", response)
            } else {
                console.log("Recorder API probe response", response.responseText)
                this.context.commit("setRecorderApiAvailable", true)
            }
        }
        request.send()
    }

    // @Action
    // subscribeInjectables() {
    //     if (this.subscribedInjectables) return
    //     Vue.$rti.subscribe(
    //         RTI.channel.injectables,
    //         RTI.Injectables,
    //         (message: RTI.Injectables) => {
    //             if (message.getWhichCase() == RTI.Injectables.WhichCase.INJECTABLE) {
    //                 const injectable = message.getInjectable()!
    //                 const existing = this.injectables.find((i) => i.getName() == injectable.getName())
    //                 if (!existing) {
    //                     this.injectables.push(injectable)
    //                 } else {
    //                     Vue.set(this.injectables, this.injectables.indexOf(existing), injectable)
    //                 }
    //             }
    //         },
    //         false
    //     )
    //     this.context.commit("setSubscribedInjectables")
    //     Vue.$rti.whenConnected(() => this.context.dispatch("requestInjectables"))
    // }

    // @Mutation
    // setSubscribedInjectables() {
    //     this.subscribedInjectables = true
    // }

    // @Action
    // requestInjectables() {
    //     const message = new RTI.Injectables()
    //     message.setRequestInjectables(new RTI.Empty())
    //     Vue.$rti.publish(RTI.channel.injectables, message, false)
    // }

    // @Mutation
    // clearInjectables() {
    //     this.injectables = []
    // }

    // @Action
    // subscribeInjections() {
    //     if (this.subscribedInjections) return
    //     Vue.$rti.subscribe(
    //         RTI.channel.injection,
    //         RTI.Injection,
    //         (injection: RTI.Injection) => {
    //             const existing = this.injections.find((i) => i.getId() == injection.getId())
    //             if (!existing) {
    //                 this.injections.push(injection)
    //             } else {
    //                 Vue.set(this.injections, this.injections.indexOf(existing), injection)
    //             }
    //         },
    //         false
    //     )
    //     Vue.$rti.subscribe(
    //         RTI.channel.injectionOperation,
    //         RTI.InjectionOperation,
    //         (message: RTI.InjectionOperation) => {
    //             if (message.getWhichCase() == RTI.InjectionOperation.WhichCase.CLEAR) {
    //                 this.context.commit(
    //                     "setInjections",
    //                     this.injections.filter((i) => i.getInjectable() != message.getClear())
    //                 )
    //             }
    //         },
    //         false
    //     )
    //     this.context.commit("setSubscribedInjections")
    //     Vue.$rti.whenConnected(() => this.context.dispatch("requestInjections"))
    // }

    // @Mutation
    // setInjections(injections: RTI.Injection[]) {
    //     this.injections = injections
    // }

    // @Mutation
    // setSubscribedInjections() {
    //     this.subscribedInjections = true
    // }

    // @Action
    // requestInjections() {
    //     const message = new RTI.InjectionOperation()
    //     message.setRequestInjections(new RTI.Empty())
    //     Vue.$rti.publish(RTI.channel.injectionOperation, message, false)
    // }

    // @Mutation
    // clearInjections() {
    //     this.injections = []
    // }

    @Action
    subscribeBrokerStats() {
        if (this.subscribedBrokerStats) return
        Vue.$rti.subscribeJSON(
            RTI.channel.brokerStats,
            (stats: any) => {
                this.context.commit("updateBrokerStats", stats)
            },
            false
        )
        this.context.commit("setSubscribedBrokerStats")
    }

    @Mutation
    updateBrokerStats(stats: any) {
        this.brokerStatsByWorker[stats.worker] = stats
        let maxTime = 0
        for (const worker in this.brokerStatsByWorker) {
            const stat = this.brokerStatsByWorker[worker]
            if (stat.time > maxTime) maxTime = stat.time
        }
        this.brokerStats = { interval: 0, count: 0, bytes: 0, channels: {} }
        for (const worker in this.brokerStatsByWorker) {
            const stat = this.brokerStatsByWorker[worker]
            if (this.brokerStats.interval && stat.interval != this.brokerStats.interval) continue // skip interval change
            if (maxTime - stat.time > stat.interval * 2.5) continue // skip old stats
            this.brokerStats.interval = stat.interval
            this.brokerStats.count += stat.count
            this.brokerStats.bytes += stat.bytes
            for (const name in stat.channels) {
                if (!(name in this.brokerStats.channels)) {
                    this.brokerStats.channels[name] = { count: 0, bytes: 0 }
                }
                this.brokerStats.channels[name].count += stat.channels[name].count
                this.brokerStats.channels[name].bytes += stat.channels[name].bytes
            }
        }
    }

    @Mutation
    setSubscribedBrokerStats() {
        this.subscribedBrokerStats = true
    }

    @Mutation
    clearBrokerStats() {
        this.brokerStatsByWorker = {}
        this.brokerStats = null
    }

    get brokerPing() {
        return this.brokerPings[Vue.$rti.clientId]
    }

    @Action
    subscribeBrokerPings() {
        if (this.subscribedBrokerPings) return
        Vue.$rti.subscribeJSON(
            RTI.channel.brokerPings,
            (pings: any) => {
                this.context.commit("updateBrokerPings", pings)
            },
            false
        )
        this.context.commit("setSubscribedBrokerPings")
    }

    @Mutation
    updateBrokerPings(pings: any) {
        this.brokerPingsByWorker[pings.worker] = pings
        this.brokerPings = {}
        for (const worker in this.brokerPingsByWorker) {
            const pings = this.brokerPingsByWorker[worker]
            for (const clientId in pings) {
                if (clientId == "worker") continue
                Vue.set(this.brokerPings, clientId, pings[clientId])
            }
        }
    }

    @Mutation
    setSubscribedBrokerPings() {
        this.subscribedBrokerPings = true
    }

    @Mutation
    clearBrokerPings() {
        this.brokerPingsByWorker = {}
        this.brokerPings = {}
    }

    @Mutation
    setSelectedScenarioName(scenarioName: string) {
        this.selectedScenarioName = scenarioName
    }

    @Mutation
    setScenarioParameterValues(parameterValues: { [key: string]: { [key: string]: string } }) {
        this.scenarioParameterValues = parameterValues
    }

    @Mutation
    setSelectedLaunchConfigurationName(configurationName: string) {
        this.selectedLaunchConfigurationName = configurationName
    }

    @Mutation
    setLaunchParameterValues(parameterValues: { [key: string]: { [key: string]: string } }) {
        this.launchParameterValues = parameterValues
    }

    // @Mutation
    // setInjectParameterValues(parameterValues: { [key: string]: { [key: string]: string } }) {
    //     this.injectParameterValues = parameterValues
    // }

    @Mutation
    clearAllErrors() {
        this.errors.splice(0, this.errors.length)
    }

    @Mutation
    clearError(error: RTI.proto.RuntimeControl.Error) {
        this.errors.splice(this.errors.indexOf(error), 1)
    }

    @Action({ root: true })
    refresh() {
        this.context.commit("clearAllErrors")
        if (this.subscribedChannels) {
            this.context.commit("clearChannels")
            this.context.dispatch("requestChannels")
        }
        if (this.subscribedClients) {
            this.context.commit("clearClients")
            this.context.dispatch("requestClients")
        }
        if (this.subscribedInjectables) {
            this.context.commit("clearInjectables")
            this.context.dispatch("requestInjectables")
        }
        if (this.subscribedInjections) {
            this.context.commit("clearInjections")
            this.context.dispatch("requestInjections")
        }
        if (this.subscribedBrokerStats) {
            this.context.commit("clearBrokerStats")
        }
        if (this.subscribedBrokerPings) {
            this.context.commit("clearBrokerPings")
        }
    }
}

export function initializeStore(store: any) {
    if (store.hasModule("rti")) return

    store.registerModule("rti", RTIStore)

    // Vue.$rti.socket.on("brand", (data: any) => {
    //     store.state.rti.brand = data
    // })

    Vue.$rti.on("connect", () => {
        setTimeout(() => {
            if (Vue.$rti.isConnected && !store.state.rti.needAuthentication) {
                console.log(`RTI connected to ${Vue.$rti.url}` + (Vue.$rti.federation ? ` federation ${Vue.$rti.federation}` : ""))
                store.state.rti.connected = true
            }
        }, 500)
        if (Vue.$rti.federation) {
            store.state.rti.federation = Vue.$rti.federation
            if (store.state.rti.federations.indexOf(Vue.$rti.federation) < 0) {
                store.state.rti.federations.push(Vue.$rti.federation)
            }
        }
        if (Vue.$rti.user) store.state.rti.user = Vue.$rti.user
        // Vue.$rti.socket.emit("brand")
    })

    Vue.$rti.on("error", (message: string) => {
        console.error(`RTI error: ${message}`)
        if (typeof message == "string") {
            store.state.rti.error = message
            message = message.toLowerCase()
            if (message.indexOf("authentication required") >= 0 || message.indexOf("authentication failed") >= 0) {
                store.state.rti.needAuthentication = true
                Vue.$rti.disconnect()
            }
        }
    })

    Vue.$rti.on("disconnect", () => {
        store.state.rti.connected = false
    })

    Vue.$rti.subscribeText(
        "federations",
        (message: string) => {
            if (message && message != "?" && store.state.rti.federations.indexOf(message) < 0) {
                store.state.rti.federations.push(message)
            }
        },
        false
    )

    Vue.$rti.subscribe(
        RTI.channel.control,
        RTI.proto.RuntimeControl,
        (message: RTI.proto.RuntimeControl) => {
            switch (message.getControlCase()) {
                case RTI.proto.RuntimeControl.ControlCase.CURRENT_LOG:
                    store.commit("rti/updateLog", message.getCurrentLog()!)
                    break
                case RTI.proto.RuntimeControl.ControlCase.SET_TIME_SCALE:
                    store.state.rti.timeScale = message.getSetTimeScale()!.getTimeScale()
                    break
                case RTI.proto.RuntimeControl.ControlCase.TIME_SYNC:
                    store.state.rti.time = message.getTimeSync()!.getTime()
                    store.state.rti.timeScale = message.getTimeSync()!.getTimeScale()
                    break
                case RTI.proto.RuntimeControl.ControlCase.NEW_LOG:
                    store.state.rti.time = null
                    store.state.rti.stopTime = null
                    break
                case RTI.proto.RuntimeControl.ControlCase.LOAD_SCENARIO:
                    // if (store.state.rti.aggregatedState != RTI.proto.RuntimeState.PLAYBACK) {
                    //     store.state.rti.injectables.splice(0)
                    //     store.state.rti.injections.splice(0)
                    // }
                    break
                case RTI.proto.RuntimeControl.ControlCase.START:
                    store.state.rti.stopTime = null
                    // if (store.state.rti.time < 0.1) {
                    //     Vue.set(
                    //         store.state.rti,
                    //         "injections",
                    //         store.state.rti.injections.filter((i: RTI.Injection) => i.getState() < RTI.Injection.State.RUNNING)
                    //     )
                    // }
                    break
                case RTI.proto.RuntimeControl.ControlCase.RESET:
                    // store.state.rti.injectables.splice(0)
                    // store.state.rti.injections.splice(0)
                    store.state.rti.time = null
                    store.state.rti.stopTime = null
                    if (location.search.includes("on_reset=back")) {
                        history.back()
                    } else if (location.search.includes("on_reset=close")) {
                        window.close()
                    }
                    break
                case RTI.proto.RuntimeControl.ControlCase.STOP:
                    store.state.rti.stopTime = store.state.rti.time
                    store.state.rti.time = 0
                    if (location.search.includes("on_stop=back")) {
                        history.back()
                    } else if (location.search.includes("on_stop=close")) {
                        window.close()
                    }
                    break
                case RTI.proto.RuntimeControl.ControlCase.END:
                    store.state.rti.stopTime = store.state.rti.time
                    store.state.rti.time = 0
                    if (location.search.includes("on_end=back")) {
                        history.back()
                    } else if (location.search.includes("on_end=close")) {
                        window.close()
                    }
                    break
                case RTI.proto.RuntimeControl.ControlCase.SEEK:
                    store.state.rti.stopTime = null
                    store.state.rti.time = message.getSeek()!.getTime()
                    break
                case RTI.proto.RuntimeControl.ControlCase.ERROR:
                    store.state.rti.errors.push(message.getError()!)
                    break
            }
        },
        false
    )

    Vue.$rti.subscribe(
        RTI.channel.clients,
        RTI.proto.Clients,
        (message: RTI.proto.Clients) => {
            // This enables reactive updates on participant registrations...
            store.state.rti.participant = Vue.$rti.participant
            store.state.rti.role = Vue.$rti.role
            store.state.rti.fullName = Vue.$rti.fullName
        },
        false
    )

    setInterval(() => {
        if (
            isFinite(store.state.rti.time) &&
            (store.state.rti.aggregatedState == RTI.proto.RuntimeState.RUNNING ||
                store.state.rti.aggregatedState == RTI.proto.RuntimeState.PLAYBACK)
        ) {
            store.state.rti.time += 0.1 * store.state.rti.timeScale
        }
    }, 100)
}
