import { EventEmitter } from "events"
import { AGClientSocket } from "socketcluster-client"
import { v4 as uuidv4 } from "uuid"
import * as base64 from "base64-js"
import * as jspb from "google-protobuf"
import constants, { channel as RTIchannel } from "./constants"
import { Clients, Client, ParticipantRegistration, ClientHeartbeat, ClientProgress, ClientValue } from "./generated/Clients_pb"
import { RuntimeState, RuntimeStateMap } from "./generated/RuntimeState_pb"
import { Channels, Channel, ChannelUsage, ChannelUse } from "./generated/Channels_pb"
import { RuntimeControl } from "./generated/RuntimeControl_pb"
import { Measures, Measure } from "./generated/Measures_pb"
import { Measurement } from "./generated/Measurement_pb"

export interface RTIOptions {
    url?: string
    application?: string
    applicationVersion?: string
    integrationVersion?: string
    engineVersion?: string
    clientId?: string
    federation?: string
    host?: string
    station?: string
    secret?: string
    incognito?: boolean
    user?: string
    password?: string
    participant?: string
    role?: string
    fullName?: string
    connect?: boolean
    clientUrl?: string
    capabilities?: string[]
}

export interface Subscription {
    channel?: any
    handler?: Function
}

export interface EncodableMessageType {
    encode(message: any): any
}

export interface DecodableMessageType {
    decode(message: Uint8Array): any
}

export interface TokenData {
    application?: string
    clientId?: string
    clientLibraryVersion?: string
    user?: string
    participant?: string
    fullName?: string
    role?: string
}

export interface TokenVerificationError {
    name?: string
    message?: string
}

export interface TokenVerificationResult extends TokenData {
    iat?: number
    exp?: number
    error?: TokenVerificationError
}

export interface ChangePasswordResult {
    success: boolean
    reason?: string
}

export interface GetTokenResult {
    success: boolean
    token?: string
    reason?: string
}

export class RTIClient extends EventEmitter {
    readonly socket: AGClientSocket

    readonly application: string = "typescript"
    readonly applicationVersion: string = ""
    readonly integrationVersion: string = ""
    readonly engineVersion: string = ""
    private _clientId!: string
    public get clientId(): string {
        return this._clientId
    }
    readonly federation: string
    readonly host: string
    readonly station: string
    private _user: string | undefined = undefined
    public get user(): string | undefined {
        return this._user
    }
    private _secret: string | undefined = undefined
    private _password: string | undefined = undefined
    public get authenticated(): boolean {
        return typeof this._secret !== "undefined" || typeof this._user !== "undefined"
    }
    private _participant: string | undefined = undefined
    public get participant(): string | undefined {
        return this._participant
    }
    private _role: string | undefined = undefined
    public get role(): string | undefined {
        return this._role
    }
    private _fullName: string | undefined = undefined
    public get fullName(): string | undefined {
        return this._fullName
    }
    private _capabilities: string[] = []
    public get capabilities(): string[] {
        return this._capabilities
    }
    readonly incognito: boolean = false
    private connected: boolean = false
    private everConnected: boolean = false
    public get isConnected(): boolean {
        return this.connected
    }
    private _authToken: string | undefined = undefined
    public get authToken(): string | undefined {
        return this._authToken
    }
    private _url: string
    public get url(): string {
        return this._url
    }
    private _brokerVersion: string | undefined = undefined
    public get brokerVersion(): string | undefined {
        return this._brokerVersion
    }

    private _state: RuntimeStateMap[keyof RuntimeStateMap] = RuntimeState.UNKNOWN
    get state(): RuntimeStateMap[keyof RuntimeStateMap] {
        return this._state
    }
    set state(value: RuntimeStateMap[keyof RuntimeStateMap]) {
        if (value != this._state) {
            this._state = value
            this.emit("state", this._state)
            this.emit("client", this.myClient)
            this.publishClient()
        }
    }

    private _usedChannels: { [key: string]: ChannelUse } = {}
    private _knownChannels: { [key: string]: Channel } = {}
    private _knownClients: { [key: string]: Client } = {}
    private _usedMeasures: { [key: string]: Measure } = {}
    private _knownMeasures: { [key: string]: Measure } = {}

    get usedChannels(): ChannelUse[] {
        return Object.values(this._usedChannels)
    }
    get knownChannels(): Channel[] {
        return Object.values(this._knownChannels)
    }
    get knownClients(): Client[] {
        return Object.values(this._knownClients)
    }
    get usedMeasures(): Measure[] {
        return Object.values(this._usedMeasures)
    }
    get knownMeasures(): Measure[] {
        return Object.values(this._knownMeasures)
    }

    private _compatibilityMode = false
    get compatibilityMode() {
        return this._compatibilityMode
    }

    public measurementIntervalTimeScale = 1
    private collectMeasurementsInterval: any = undefined
    private collectQueue: { [key: string]: number[] } = {}
    private lastCollect: { [key: string]: number } = {}

    get ownChannelPrefix(): string {
        if (!this.clientId)
            throw new Error(this.everConnected ? "RTI can't use ownChannelPrefix until connected" : "RTI ownChannelPrefix but no clientId")
        return `@${this.clientId}:`
    }

    constructor(options?: RTIOptions) {
        super()

        const env = typeof process === "undefined" ? {} : process.env || {}

        var url: string | undefined = options && options.url
        if (!url) url = env["RTI_URL"]
        if (!url && typeof location == "object" && location.host) {
            if (location.protocol == "https:") {
                url = `wss://${location.host}`
            } else if (location.protocol == "app:" && location.hostname == ".") {
                // i.e. in an electron app
                url = `ws://localhost:${constants.defaultPort}`
            } else if (location.host && location.host != "localhost" && !location.host.startsWith("localhost:")) {
                url = `ws://${location.host}`
            }
        }
        if (!url) url = `ws://${constants.defaultHost}:${constants.defaultPort}`
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
            if (url.startsWith("localhost") || url.startsWith("127.")) url = `ws://${url}`
            else url = `wss://${url}`
        }
        this._url = url

        if (options && options.application) this.application = options.application
        if (options && options.applicationVersion) this.applicationVersion = options.applicationVersion
        if (options && options.integrationVersion) this.integrationVersion = options.integrationVersion
        if (options && options.engineVersion) this.engineVersion = options.engineVersion
        if (options && options.incognito) this.incognito = options.incognito
        this._clientId = ""
        if (!this._clientId && options && options.clientId) this._clientId = options.clientId
        this.federation = ""
        if (!this.federation && options && options.federation) this.federation = options.federation
        if (!this.federation) this.federation = env["RTI_FEDERATION"] || ""
        // slashes quietly not allowed in federation id
        if (this.federation) this.federation = this.federation.replace("/", "_")
        this.host = ""
        if (!this.host && options && options.host) this.host = options.host
        if (!this.host) this.host = env["RTI_HOST"] || ""
        this.station = ""
        if (!this.station && options && options.station) this.station = options.station
        if (!this.station) this.station = env["RTI_STATION"] || ""
        if (!this._participant && options && options.participant) this._participant = options.participant
        if (!this._role && options && options.role) this._role = options.role
        if (!this._fullName && options && options.fullName) this._fullName = options.fullName
        if (options && options.capabilities) this._capabilities = options.capabilities

        let secret = env["RTI_SECRET"]
        if (!secret && options && options.secret) secret = options.secret
        this._secret = secret

        const socketOptions = {} as AGClientSocket.ClientOptions

        // parse url into socketcluster options
        var u = new URL(this._url)
        socketOptions.port = parseInt(u.port)
        socketOptions.hostname = u.hostname
        socketOptions.secure = u.protocol == "wss:" || u.protocol == "https:"
        socketOptions.path = u.pathname
        if (options && typeof options.connect !== "undefined") {
            socketOptions.autoConnect = options.connect
        }

        this.socket = new AGClientSocket(socketOptions)
        this.setupSocket()
    }

    private setupSocket() {
        const tokenData = () => {
            if (!this._clientId) this._clientId = uuidv4()
            const authToken = {} as any
            if (this._secret) authToken.secret = this._secret
            if (this._user) authToken.user = this._user
            if (this._password) authToken.password = this._password
            if (this._participant) authToken.participant = this._participant
            if (this._fullName) authToken.fullName = this._fullName
            if (this._role) authToken.role = this._role

            authToken.application = this.application
            authToken.clientId = this.clientId
            authToken.clientLibraryVersion = constants.version
            if (this.federation) authToken.federation = this.federation
            return authToken
        }
        this.forAwait(this.socket.listener("error"), (error) => {
            this.emit("error", typeof error == "object" && "error" in error ? error.error : error)
        })
        this.forAwait(this.socket.listener("connect"), (event) => {
            const token = this.socket.authToken as any
            if (
                (!token && !this.socket.signedAuthToken) ||
                (this._clientId && token && this._clientId != token.clientId) ||
                (this._user && token && this._user != token.user)
            ) {
                // Don't consider RTI client connected (even though socket is connected) until authenticated
                this.socket.transmit("auth", tokenData())
            }
        })
        this.forAwait(this.socket.listener("close"), (event) => {
            this.connected = false
            this.emit("disconnect")
        })
        this.forAwait(this.socket.listener("authenticate"), (event) => {
            const token = this.socket.authToken as any
            if (
                ((this._user || token.user) && this._user != token.user) ||
                ((this._participant || token.participant) && this._participant != token.participant) ||
                ((this.federation || token.federation) && this.federation != token.federation)
            ) {
                // Reauthenticate when user, participant, or federation changes
                this.socket.deauthenticate()
                this.socket.reconnect()
            } else {
                if (token.clientId && this._clientId != token.clientId) {
                    if (this._clientId) console.warn("RTI authenticated with unexpected client id", token.clientId)
                    this._clientId = token.clientId
                }
                if (token.user) this._user = token.user
                if ("secret" in token) this._secret = undefined
                if ("password" in token) this._password = undefined
                if (!this.connected) {
                    this.connected = this.everConnected = true
                    if (!this.incognito && this.clientId) {
                        this.publishClient()
                        this.publishMeasures()
                    }
                    this.emit("connect")
                }
            }
        })
        this.forAwait(this.socket.receiver("fail"), (error) => {
            this.emit("error", typeof error == "object" && "error" in error ? error.error : error)
            this.disconnect()
        })
        this.forAwait(this.socket.receiver("ping"), (content) => {
            this.socket.transmit("pong", content)
        })
        this.forAwait(this.socket.receiver("broker-version"), (content) => {
            this._brokerVersion = content
            this.emit("broker-version", content)
        })
        // below hack for backwards compatibility with geistt rti
        if (this.socket.transport?.socket) {
            const sockSocket = this.socket.transport?.socket as any
            sockSocket.addEventListener("message", (message: MessageEvent) => {
                if (message.data === "#1") {
                    this.socket.send("#2")
                    if (!this._compatibilityMode) {
                        this._compatibilityMode = true
                        this.emit("compatibility-mode", this._compatibilityMode)
                        this.socket.transport!.pingTimeoutDisabled = true
                        clearInterval((this.socket.transport as any)._pingTimeoutTicker)
                    }
                }
            })
        }

        this.subscribe(RTIchannel.clients, Clients, (m: Clients) => this.onClients(m), false)
        this.subscribe(RTIchannel.channels, Channels, (m: Channels) => this.onChannels(m), false)
        this.subscribe(RTIchannel.measures, Measures, (m: Measures) => this.onMeasures(m), false)
    }

    private die = false

    async forAwait<T>(iterable: AsyncIterable<T>, handler: (data: T) => boolean | void) {
        for await (let item of iterable) {
            if (this.die || handler(item) === false) break
        }
    }

    kill() {
        if (this.socket.state == "open") this.socket.disconnect()
        this.socket.killAllChannels()
        this.socket.killAllListeners()
        this.socket.killAllReceivers()
        this.socket.killAllProcedures()
        this.die = true
        this.connected = false
    }

    async getToken(data: TokenData): Promise<GetTokenResult> {
        const result = await this.socket.invoke("gettoken", data)
        return result as GetTokenResult
    }

    async verifyToken(token: string): Promise<TokenVerificationResult> {
        const result = await this.socket.invoke("verifytoken", token)
        return result as TokenVerificationResult
    }

    onClients(message: Clients) {
        if (message.hasRequestClients()) {
            if (!this.incognito) this.publishClient()
        } else if (message.hasClient()) {
            this._knownClients[message.getClient()!.getId()] = message.getClient()!
            this.emit("client", message.getClient())
        } else if (message.hasRegisterParticipant()) {
            const reg = message.getRegisterParticipant()!
            if (
                (!reg.getClientId() || reg.getClientId() == this.clientId) &&
                (!reg.getHost() || reg.getHost() == this.host) &&
                (!reg.getStation() || reg.getStation() == this.station) &&
                (reg.getParticipant() != this.participant || reg.getRole() != this.role || reg.getFullName() != this.fullName)
            ) {
                this._participant = reg.getParticipant()
                this._role = reg.getRole()
                this._fullName = reg.getFullName()
                this.publishClient()
                this.emit("client", this.myClient)
            }
        }
    }

    onChannels(message: Channels) {
        if (message.hasRequestChannelUsage()) {
            const usage = new ChannelUsage()
            usage.setClientId(this.clientId)
            for (const use of Object.values(this._usedChannels)) {
                usage.getUsageList().push(use)
            }
            const message = new Channels()
            message.setChannelUsage(usage)
            if (!this.incognito) this.publish(RTIchannel.channels, message, false)
        } else if (message.hasChannelUsage()) {
            for (const usage of message.getChannelUsage()!.getUsageList()) {
                this.discoverChannel(usage.getChannel()!)
                this.emit("channel", usage.getChannel())
            }
        } else if (message.hasChannel()) {
            this.discoverChannel(message.getChannel()!)
            this.emit("channel", message.getChannel())
        }
    }

    onMeasures(message: Measures) {
        if (message.hasRequestMeasures()) {
            if (!this.incognito) {
                this.publishMeasures()
            } else if (message.hasMeasure()) {
                this._knownMeasures[message.getMeasure()!.getId()] = message.getMeasure()!
                this.emit("measure", message.getMeasure())
            } else if (message.getLogMeasure()) {
                if (!(message.getLogMeasure()!.getId() in this._knownMeasures)) {
                    this._knownMeasures[message.getLogMeasure()!.getId()] = message.getLogMeasure()!
                    this.emit("logmeasure", message.getLogMeasure())
                }
            }
        }
    }

    private publishClient() {
        const message = new Clients()
        message.setClient(this.myClient)
        this.publish(RTIchannel.clients, message, false)
    }

    private publishMeasures() {
        for (const measure of Object.values(this._usedMeasures)) {
            const message = new Measures()
            message.setMeasure(measure)
            this.publish(RTIchannel.measures, message, false)
        }
    }

    get myClient(): Client {
        const client = new Client()
        client.setApplication(this.application)
        client.setApplicationVersion(this.applicationVersion)
        client.setIntegrationVersion(this.integrationVersion)
        if (!this.engineVersion && typeof process !== "undefined" && process.version) {
            client.setEngineVersion(`Node ${process.version}`)
        } else {
            client.setEngineVersion(this.engineVersion)
        }
        if (typeof navigator !== "undefined" && navigator.userAgent) client.setUserAgent(navigator.userAgent)
        client.setId(this.clientId)
        client.setState(this._state)
        client.setClientLibraryVersion(constants.version)
        client.setHost(this.host)
        client.setStation(this.station)
        if (this.user) client.setUser(this.user)
        if (this.participant) client.setParticipant(this.participant)
        if (this.role) client.setRole(this.role)
        if (this.fullName) client.setFullName(this.fullName)
        if (this._capabilities.length > 0) client.setCapabilitiesList(this._capabilities)
        return client
    }

    publishError(errorMessage: string, errorState?: RuntimeStateMap[keyof RuntimeStateMap]) {
        const error = new RuntimeControl.Error()
        error.setClientId(this.clientId)
        error.setMessage(errorMessage)
        if (errorState) error.setState(errorState)
        const message = new RuntimeControl()
        message.setError(error)
        this.publish(RTIchannel.control, message, false)
    }

    publishHeartbeat() {
        const heartbeat = new ClientHeartbeat()
        heartbeat.setClientId(this.clientId)
        const message = new Clients()
        message.setHeartbeat(heartbeat)
        this.publish(RTIchannel.clients, message, false)
    }

    publishProgress(progress: number) {
        const prg = new ClientProgress()
        prg.setClientId(this.clientId)
        prg.setProgress(progress)
        const message = new Clients()
        message.setProgress(prg)
        this.publish(RTIchannel.clients, message, false)
    }

    publishValue(value: string, highlight = false, error = false) {
        const val = new ClientValue()
        val.setClientId(this.clientId)
        val.setValue(value)
        val.setHighlight(highlight)
        val.setError(error)
        const message = new Clients()
        message.setValue(val)
        this.publish(RTIchannel.clients, message, false)
    }

    subscribe(channelName: string, type: any, handler: Function, register = true): Subscription {
        if (register) this.registerChannelUsage(channelName, false, type.name)
        return this.doSubscribe(channelName, (message: any) => {
            const data = RTIClient.parse(type, message)
            if (handler.length == 2) {
                handler(channelName, data)
            } else {
                handler(data)
            }
        })
    }

    static parse(type: any, content: string) {
        return type.deserializeBinary(base64.toByteArray(content))
    }

    subscribeText(channelName: string, handler: Function, register = true): Subscription {
        if (register) this.registerChannelUsage(channelName, false, "text")
        return this.doSubscribe(channelName, handler)
    }

    subscribeJSON(channelName: string, handler: Function, register = true): Subscription {
        if (register) this.registerChannelUsage(channelName, false, "json")
        return this.doSubscribe(channelName, (message: string) => {
            const data = JSON.parse(message)
            if (handler.length == 2) {
                handler(channelName, data)
            } else {
                handler(data)
            }
        })
    }

    private _handlers: any = {}

    private doSubscribe(channelName: string, handler: Function): Subscription {
        const channel = this.socket.subscribe((this.federation ? "//" + this.federation + "/" : "") + channelName)
        const wrappedHandler = (data: any) => {
            try {
                if (handler.length == 2) {
                    handler(channelName, data)
                } else {
                    handler(data)
                }
            } catch (error) {
                this.emit("error", error)
            }
        }
        if (!(channelName in this._handlers)) this._handlers[channelName] = []
        this._handlers[channelName].push(handler)
        this.forAwait(channel, (data) => {
            if (this._handlers[channelName].indexOf(handler) < 0) return false
            wrappedHandler(data)
        })
        return { channel, handler }
    }

    unsubscribe(channelNameOrSubscription: string | Subscription) {
        if (typeof channelNameOrSubscription === "string") {
            this.socket.unsubscribe(channelNameOrSubscription)
        } else {
            const subscription = channelNameOrSubscription
            const channel = subscription.channel
            if (channel) {
                const index = this._handlers[channel.name].indexOf(subscription.handler)
                if (index >= 0) this._handlers[channel.name].splice(index, 1)
                if (this._handlers[channel.name].length == 0) channel.unsubscribe()
            }
        }
    }

    publish(channelName: string, message: jspb.Message, register = true) {
        if (register) this.registerChannelUsage(channelName, true, message.constructor.name)
        this.doPublish(channelName, base64.fromByteArray(message.serializeBinary()))
    }

    publishBytes(channelName: string, bytes: Uint8Array | any, register = true, typeName?: string) {
        if (register) this.registerChannelUsage(channelName, true, typeName || "bytes")
        if ((bytes as any).finish) bytes = (bytes as any).finish()
        this.doPublish(channelName, base64.fromByteArray(bytes))
    }

    publishText(channelName: string, message: string, register = true) {
        if (register) this.registerChannelUsage(channelName, true, "text")
        this.doPublish(channelName, message)
    }

    publishJSON(channelName: string, message: any, register = true) {
        if (register) this.registerChannelUsage(channelName, true, "json")
        this.doPublish(channelName, JSON.stringify(message))
    }

    private doPublish(channelName: string, message: string) {
        if (!this.everConnected) {
            console.warn("RTI can't publish before connected - message dropped")
            return
        }
        if (this.federation && !channelName.startsWith("@")) channelName = "//" + this.federation + "/" + channelName
        this.socket.transmitPublish(channelName, message)
    }

    connect() {
        this.socket.connect()
    }

    disconnect() {
        //this.socket.deauthenticate()
        this.socket.disconnect()
    }

    setCredentials(user: string, password: string) {
        this._user = user
        this._password = password
    }

    registerChannelUsage(channelName: string | Channel, usePublish: boolean, type?: string) {
        try {
            let channel: Channel
            if (typeof channelName === "string") {
                if (channelName in this._knownChannels) {
                    channel = this._knownChannels[channelName]
                } else {
                    channel = new Channel()
                    channel.setName(channelName)
                }
            } else {
                channel = channelName
            }
            if (type) channel.setDataType(type)
            if (channel.getName().startsWith("@")) return
            let use = this._usedChannels[channel.getName()]
            if (!use) use = new ChannelUse()

            // Complicated version due to weird error in legacy vue client... c.g is not a function
            // use.setChannel(channel)
            const useChannel = new Channel()
            useChannel.setName(channel.getName())
            useChannel.setDataType(channel.getDataType())
            useChannel.setEphemeral(channel.getEphemeral())
            useChannel.setState(channel.getState())
            useChannel.setFirstFieldId(channel.getFirstFieldId())
            use.setChannel(useChannel)

            this._usedChannels[channel.getName()] = use
            if (usePublish) use.setPublish(true)
            else use.setSubscribe(true)
            if (!(channel.getName() in this._knownChannels)) this.registerChannel(channel)
        } catch (e) {
            console.error("RTI error registering channel usage", e)
        }
    }

    registerChannel(channel: Channel) {
        if (channel.getName().startsWith("@")) return
        this._knownChannels[channel.getName()] = channel
        if (!(channel.getName() in this._usedChannels)) this._usedChannels[channel.getName()] = new ChannelUse()
        const use = this._usedChannels[channel.getName()]
        use.setChannel(channel)
        if (this.connected && !this.incognito) {
            const message = new Channels()
            message.setChannel(channel)
            this.publish(RTIchannel.channels, message, false)
        }
    }

    private discoverChannel(channel: Channel) {
        if (!(channel.getName() in this._knownChannels)) {
            this._knownChannels[channel.getName()] = channel
        } else {
            const known = this._knownChannels[channel.getName()]
            if (channel.getDataType() && !known.getDataType()) known.setDataType(channel.getDataType())
            if (channel.getEphemeral()) known.setEphemeral(true)
            if (channel.getState()) known.setState(true)
            if (channel.getFirstFieldId()) known.setFirstFieldId(true)
        }
    }

    registerParticipant(participant: string, role?: string, fullName?: string) {
        const registration = new ParticipantRegistration()
        registration.setParticipant(participant)
        if (role) registration.setRole(role)
        if (fullName) registration.setFullName(fullName)
        if (this.station) registration.setStation(this.station)
        else if (this.host) registration.setHost(this.host)
        else registration.setClientId(this.clientId)
        const message = new Clients()
        message.setRegisterParticipant(registration)
        this.publish(RTIchannel.clients, message, false)
        this._participant = participant
        this._role = role
        this._fullName = fullName
        this.publishClient()
    }

    registerMeasure(measure: Measure) {
        measure.setApplication(this.application)
        this._usedMeasures[measure.getId()] = measure
        if (!(measure.getId() in this._knownMeasures)) {
            this._knownMeasures[measure.getId()] = measure
            if (this.connected && !this.incognito) {
                const message = new Measures()
                message.setMeasure(measure)
                this.publish(RTIchannel.measures, message, false)
            }
        }
    }

    measure(measureOrId: Measure | string, value: number) {
        let measure: Measure | undefined = undefined
        if (typeof measureOrId == "string") {
            measure = this._usedMeasures[measureOrId]
            if (!measure) measure = this._knownMeasures[measureOrId]
            if (!measure) {
                measure = new Measure()
                measure.setId(measureOrId)
                measure.setApplication(this.application)
            }
        } else {
            measure = measureOrId
        }
        if (!measure) return
        if (!(measure.getId() in this._usedMeasures)) this.registerMeasure(measure)
        if (measure.getInterval() > 1e-5) {
            if (!this.collectMeasurementsInterval) this.collectMeasurementsInterval = setInterval(() => this.collectMeasurements(), 500)
            if (!(measure.getId() in this.collectQueue)) this.collectQueue[measure.getId()] = []
            this.collectQueue[measure.getId()].push(value)
        } else {
            const measurement = new Measurement()
            measurement.setMeasureId(measure.getId())
            measurement.setClientId(this.clientId)
            measurement.setValue(value)
            const channel = measure.getChannel() || RTIchannel.measurement
            if (this.connected) this.publish(channel, measurement, false)
        }
    }

    private collectMeasurements() {
        if (!this.connected && this.collectMeasurementsInterval) {
            clearInterval(this.collectMeasurementsInterval)
            this.collectMeasurementsInterval = undefined
            return
        }
        for (const id in this.collectQueue) {
            if (!(id in this.lastCollect)) {
                this.lastCollect[id] = new Date().getTime()
            } else {
                const measure = this._knownMeasures[id]
                if ((new Date().getTime() - this.lastCollect[id]) * this.measurementIntervalTimeScale > measure.getInterval() * 1000) {
                    const channel = measure.getChannel() || RTIchannel.measurement
                    const measurement = new Measurement()
                    measurement.setMeasureId(id)
                    measurement.setClientId(this.clientId)
                    const values = this.collectQueue[id]
                    if (values.length == 1) {
                        measurement.setValue(values.pop()!)
                        this.publish(channel, measurement, false)
                    } else if (values.length > 1) {
                        const window = new Measurement.Window()
                        window.setMax(-Infinity)
                        window.setMin(Infinity)
                        window.setCount(values.length)
                        for (const value of values) {
                            window.setMean(window.getMean() + value)
                            if (value > window.getMax()) window.setMax(value)
                            if (value < window.getMin()) window.setMin(value)
                        }
                        this.collectQueue[id] = []
                        if (window.getCount() > 0) window.setMean(window.getMean() / window.getCount())
                        window.setDuration((new Date().getTime() - this.lastCollect[id]) * this.measurementIntervalTimeScale)
                        measurement.setWindow(window)
                        this.publish(channel, measurement, false)
                    }
                    this.lastCollect[id] = new Date().getTime()
                }
            }
        }
    }

    whenConnected(callback: Function) {
        if (this.connected) callback()
        else this.once("connect", () => callback())
    }
}
