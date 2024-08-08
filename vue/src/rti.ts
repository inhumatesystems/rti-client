import { defineStore } from "pinia"
import { computed, inject, reactive, ref } from "vue"
import * as RTI from "@inhumate/rti"
import { runtimeStateToJSON } from "@inhumate/rti/lib/generated/RuntimeState"

export const useRtiStore = defineStore("rti", () => {
    const rti = inject("rti-client") as RTI.Client

    const connected = ref(rti.isConnected)
    const connectionError = ref(undefined as string | undefined)
    rti.on("error", (err: string) => (connectionError.value = err))
    rti.on("fail", (err: string) => (connectionError.value = err))

    const needAuthentication = computed(() => connectionError.value && typeof(connectionError.value) == "string" &&  connectionError.value.toLowerCase().includes("authentication"))
    const canChangePassword = computed(() => authToken && authToken.password && authToken.password != "static")

    const authToken = reactive({} as any)
    const user = computed(() => authToken.user)
    rti.on("connect", () => {
        connected.value = rti.isConnected
        connectionError.value = undefined
        rti.publish(RTI.channel.control, RTI.proto.RuntimeControl, { requestCurrentLog: {} })
    })
    rti.on("disconnect", () => (connected.value = rti.isConnected))
    rti.on("authenticate", () => {
        for (const key in authToken) delete authToken[key]
        if (rti.authToken) Object.assign(authToken, rti.authToken)
    })

    const _state = ref(rti.state)
    rti.on("state", (newState: RTI.proto.RuntimeState) => {
        _state.value = newState
        if (myClient.value) myClient.value.state = newState
    })
    const state = computed({
        get() {
            return _state.value
        },
        set(value) {
            rti.state = value
        },
    })
    const stateText = computed(() => {
        const text = runtimeStateToJSON(_state.value).toLowerCase().replace("_", " ")
        return text[0].toUpperCase() + text.substring(1)
    })
    const time = ref(null as number | null)
    const stopTime = ref(null as number | null)
    const timeScale = ref(1)
    const lastTimeSyncRealTime = ref(new Date(0))
    const timeSyncMasterClientId = ref("")

    const log = ref(undefined as RTI.proto.Log | undefined)
    const recorderClient = computed(() => connectedClients.value.find((c) => c.capabilities.includes(RTI.capability.log)))
    const myClient = ref(rti.myClient)
    const clients = ref(rti.knownClients)
    const connectedClients = ref<RTI.proto.Client[]>([])
    const errors = ref([] as RTI.proto.RuntimeControl_Error[])
    rti.on("client", (client: RTI.proto.Client) => {
        if (client.id == rti.clientId) {
            myClient.value = rti.myClient
            myClient.value.state = _state.value
        } else {
            const hadRecorder = !!recorderClient.value
            clients.value = rti.knownClients.filter((client: RTI.proto.Client) => client.id != rti.clientId)
            const connectedIndex = connectedClients.value.findIndex((c) => c.id == client.id)
            if (connectedIndex < 0) {
                connectedClients.value.push(client)
            } else {
                connectedClients.value[connectedIndex] = client
            }
            if (hadRecorder && !recorderClient.value) {
                log.value = undefined
            } else {
                rti.publish(RTI.channel.logs, RTI.proto.Logs, { requestLog: {} })
            }
        }
    })
    rti.on("logclient", (client: RTI.proto.Client) => {
        clients.value = rti.knownClients.filter((client: RTI.proto.Client) => client.id != rti.clientId)
    })
    rti.subscribe(
        RTI.channel.control,
        RTI.proto.RuntimeControl,
        (message: RTI.proto.RuntimeControl) => {
            if (message.currentLog) {
                log.value = message.currentLog
            } else if (message.timeSync) {
                time.value = message.timeSync.time
                timeScale.value = message.timeSync.timeScale
                timeSyncMasterClientId.value = message.timeSync.masterClientId
                lastTimeSyncRealTime.value = new Date()
            } else if (message.setTimeScale) {
                timeScale.value = message.setTimeScale.timeScale
            } else if (message.reset) {
                time.value = null
                stopTime.value = null
            } else if (message.start) {
                stopTime.value = null
            } else if (message.play) {
                stopTime.value = null
            } else if (message.stop) {
                stopTime.value = time.value
                time.value = 0
            } else if (message.end) {
                stopTime.value = time.value
                time.value = 0
            } else if (message.error) {
                errors.value.push(message.error)
            }
        },
        false
    )
    rti.subscribeText(
        RTI.channel.clientDisconnect,
        (clientId: string) => {
            const connectedIndex = connectedClients.value.findIndex((c) => c.id == clientId)
            if (connectedIndex >= 0) connectedClients.value.splice(connectedIndex, 1)
        },
        false
    )
    const channels = ref(rti.knownChannels)
    rti.on("channel", () => (channels.value = rti.knownChannels))
    rti.on("logchannel", () => (channels.value = rti.knownChannels))

    function anyClientWithStates(states: RTI.proto.RuntimeState[]) {
        for (const state of states) if (anyClientWithState(state)) return true
        return false
    }

    function anyClientWithState(state: RTI.proto.RuntimeState) {
        return !!connectedClients.value.find((c) => c.state == state)
    }

    function anyClientWithCapability(capability: string) {
        return !!connectedClients.value.find((c) => c.capabilities.includes(capability))
    }

    function refresh() {
        rti.resetKnown()
        log.value = undefined
        clients.value = []
        connectedClients.value = []
        errors.value = []
        channels.value = []
        rti.publish(RTI.channel.control, RTI.proto.RuntimeControl, { requestCurrentLog: {} })
        rti.publish(RTI.channel.clients, RTI.proto.Clients, { requestClients: {} })
        rti.publish(RTI.channel.channels, RTI.proto.Channels, { requestChannels: {} })
    }

    return {
        client: rti,
        connected,
        connectionError,
        needAuthentication,
        canChangePassword,
        authToken,
        user,
        state,
        stateText,
        time,
        stopTime,
        timeScale,
        lastTimeSyncTime: lastTimeSyncRealTime,
        timeSyncMasterClientId,
        log,
        recorderClient,
        myClient,
        clients,
        connectedClients,
        channels,
        errors,
        anyClientWithStates,
        anyClientWithState,
        anyClientWithCapability,
        refresh,
    }
})
