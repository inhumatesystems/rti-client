import { EventEmitter } from "events"
import { AGClientSocket } from "socketcluster-client"
import { v4 as uuidv4 } from "uuid"
import * as base64 from "base64-js"
import constants, { channel as RTIchannel } from "./constants.js"
import { Clients, Client, ParticipantRegistration } from "./generated/Clients.js"
import { RuntimeState } from "./generated/RuntimeState.js"
import { Channels, Channel, ChannelUsage, ChannelUse } from "./generated/Channels.js"
import { RuntimeControl } from "./generated/RuntimeControl.js"
import { Measures, Measure } from "./generated/Measures.js"
import { Measurement, Measurement_Window } from "./generated/Measurement.js"

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
    user?: string
    password?: string
    participant?: string
    role?: string
    fullName?: string
    incognito?: boolean
    incognitoChannels?: boolean
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
    readonly incognitoChannels: boolean = false
    private connected: boolean = false
    private everConnected: boolean = false
    public get isConnected(): boolean {
        return this.connected
    }
    public get authToken(): any {
        return this.socket ? this.socket.authToken : undefined
    }
    private _url: string
    public get url(): string {
        return this._url
    }
    private _brokerVersion: string | undefined = undefined
    public get brokerVersion(): string | undefined {
        return this._brokerVersion
    }

    private _state: RuntimeState = RuntimeState.UNKNOWN
    get state(): RuntimeState {
        return this._state
    }
    set state(value: RuntimeState) {
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
            } else if (location.hostname && location.hostname.startsWith("127.")) {
                url = `ws://${location.hostname}:${constants.defaultPort}`
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
        if (options && options.incognitoChannels) this.incognitoChannels = options.incognitoChannels
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
        if (this.host && this.host.indexOf(".") >= 0) this.host = this.host.split(".")[0]
        this.station = ""
        if (!this.station && options && options.station) this.station = options.station
        if (!this.station) this.station = env["RTI_STATION"] || ""
        if (!this._user && options && options.user) this._user = options.user
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
                this.emit("authenticate")
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

    invoke(event: string, data?: any, options?: { ackTimeout?: number | undefined }) {
        return this.socket.invoke(event, data, options)
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
        if (message.requestClients) {
            if (!this.incognito && this.clientId) this.publishClient()
        } else if (message.client) {
            this._knownClients[message.client.id] = message.client
            this.emit("client", message.client)
        } else if (message.logClient) {
            if (!(message.logClient.id in this._knownClients)) {
                this._knownClients[message.logClient.id] = message.logClient
                this.emit("logclient", message.logClient)
            }
        } else if (message.registerParticipant) {
            const reg = message.registerParticipant
            if (
                (!reg.clientId || reg.clientId == this.clientId) &&
                (!reg.host || reg.host == this.host) &&
                (!reg.station || reg.station == this.station) &&
                (reg.participant != this.participant || reg.role != this.role || reg.fullName != this.fullName)
            ) {
                this._participant = reg.participant
                this._role = reg.role
                this._fullName = reg.fullName
                this.publishClient()
                this.emit("client", this.myClient)
            }
        }
    }

    onChannels(message: Channels) {
        if (message.requestChannelUsage && !this.incognito && !this.incognitoChannels) {
            const usage = ChannelUsage.create({ clientId: this.clientId })
            for (const use of Object.values(this._usedChannels)) {
                usage.usage.push(use)
            }
            this.publish(RTIchannel.channels, Channels, { channelUsage: usage }, false)
        } else if (message.channelUsage) {
            for (const usage of message.channelUsage.usage) {
                this.discoverChannel(usage.channel!)
                this.emit("channel", usage.channel!)
            }
        } else if (message.channel) {
            this.discoverChannel(message.channel)
            this.emit("channel", message.channel)
        } else if (message.logChannel) {
            if (!(message.logChannel.name in this._knownChannels)) {
                this.discoverChannel(message.logChannel)
                this.emit("logchannel", message.logChannel)
            }
        }
    }

    onMeasures(message: Measures) {
        if (message.requestMeasures) {
            if (!this.incognito) {
                this.publishMeasures()
            } else if (message.measure) {
                this._knownMeasures[message.measure.id] = message.measure
                this.emit("measure", message.measure)
            } else if (message.logMeasure) {
                if (!(message.logMeasure.id in this._knownMeasures)) {
                    this._knownMeasures[message.logMeasure.id] = message.logMeasure
                    this.emit("logmeasure", message.logMeasure)
                }
            }
        }
    }

    private publishClient() {
        this.publish(RTIchannel.clients, Clients, { client: this.myClient }, false)
    }

    private publishMeasures() {
        for (const measure of Object.values(this._usedMeasures)) {
            this.publish(RTIchannel.measures, Measures, { measure }, false)
        }
    }

    get myClient(): Client {
        return Client.create({
            id: this.clientId,
            state: this._state,
            host: this.host,
            station: this.station,
            user: this.user,
            participant: this.participant,
            role: this.role,
            fullName: this.fullName,
            application: this.application,
            applicationVersion: this.applicationVersion,
            clientLibraryVersion: constants.version,
            integrationVersion: this.integrationVersion,
            engineVersion:
                !this.engineVersion && typeof process !== "undefined" && process.version ? `Node ${process.version}` : this.engineVersion,
            userAgent: typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "",
            capabilities: this.capabilities,
        })
    }

    publishError(errorMessage: string, errorState?: RuntimeState) {
        this.publish(
            RTIchannel.control,
            RuntimeControl,
            {
                error: {
                    clientId: this.clientId,
                    message: errorMessage,
                    errorState,
                },
            },
            false
        )
    }

    publishHeartbeat() {
        this.publish(RTIchannel.clients, Clients, { clientHeartbeat: { clientId: this.clientId } }, false)
    }

    publishProgress(progress: number) {
        this.publish(RTIchannel.clients, Clients, { progress: { clientId: this.clientId, progress } }, false)
    }

    publishValue(value: string, highlight = false, error = false) {
        this.publish(RTIchannel.clients, Clients, { value: { clientId: this.clientId, value, highlight, error } }, false)
    }

    async changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
        const result = await this.socket.invoke("passwd", { oldPassword, newPassword })
        return result as ChangePasswordResult
    }

    subscribe(channelName: string, type: any, handler: Function, register = true): Subscription {
        if (!type) throw new Error("cannot subscribe with undefined type")
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

    static parse(type: DecodableMessageType, content: string) {
        return type.decode(base64.toByteArray(content))
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
                const handlers = this._handlers[channel.name]
                if (handlers && handlers.length > 0) {
                    const index = handlers.indexOf(subscription.handler)
                    if (index >= 0) handlers.splice(index, 1)
                    if (handlers.length == 0) channel.unsubscribe()
                }
            }
        }
    }

    publish(channelName: string, typeOrEncode: EncodableMessageType | any, data?: any, register = true, typeName?: string) {
        // no way of getting name of an interface in TypeScript I'm afraid
        if (register) this.registerChannelUsage(channelName, true, typeName || "proto")
        let bytes
        if (typeOrEncode.encode) {
            if (typeOrEncode.fromPartial) data = typeOrEncode.fromPartial(data)
            bytes = typeOrEncode.encode(data)
        } else {
            bytes = typeOrEncode
        }
        if (bytes.finish) bytes = bytes.finish()
        this.doPublish(channelName, base64.fromByteArray(bytes))
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
        if (!channelName) {
            console.warn("Can't publish with empty channel name - message dropped")
            return
        }
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
        this.socket.deauthenticate()
    }

    logout() {
        this._user = undefined
        this._password = undefined
        this.socket.deauthenticate()
        this.socket.disconnect()
        setTimeout(() => this.socket.connect(), 100)
    }

    registerChannelUsage(channelName: string | Channel, usePublish: boolean, type?: string) {
        let channel: Channel
        if (typeof channelName === "string") {
            if (channelName in this._knownChannels) {
                channel = this._knownChannels[channelName]
            } else {
                channel = Channel.create({ name: channelName })
            }
        } else {
            channel = channelName
        }
        if (type) channel.dataType = type
        if (channel.name.startsWith("@")) return
        let use = this._usedChannels[channel.name]
        if (!use) use = ChannelUse.create()
        use.channel = channel
        this._usedChannels[channel.name] = use
        if (usePublish) use.publish = true
        else use.subscribe = true
        if (!(channel.name in this._knownChannels)) this.registerChannel(channel)
    }

    registerChannel(channel: Channel) {
        if (channel.name.startsWith("@")) return
        this._knownChannels[channel.name] = channel
        if (!(channel.name in this._usedChannels)) this._usedChannels[channel.name] = ChannelUse.create()
        const use = this._usedChannels[channel.name]
        use.channel = channel
        if (this.connected && !this.incognito) {
            this.publish(RTIchannel.channels, Channels, { channel }, false)
        }
    }

    private discoverChannel(channel: Channel) {
        if (!(channel.name in this._knownChannels)) {
            this._knownChannels[channel.name] = channel
        } else {
            const known = this._knownChannels[channel.name]
            if (channel.dataType && !known.dataType) known.dataType = channel.dataType
            if (channel.ephemeral) known.ephemeral = true
            if (channel.state) known.state = true
            if (channel.firstFieldId) known.firstFieldId = true
        }
    }

    registerParticipant(participant: string, role?: string, fullName?: string) {
        const registration = ParticipantRegistration.create({
            participant,
            role,
            fullName,
            clientId: this.clientId,
            station: this.station,
            host: this.host,
        })
        this.publish(RTIchannel.clients, Clients, { registerParticipant: registration }, false)
        this._participant = participant
        this._role = role
        this._fullName = fullName
        this.publishClient()
    }

    registerMeasure(measure: Measure) {
        measure.application = this.application
        this._usedMeasures[measure.id] = measure
        if (!(measure.id in this._knownMeasures)) {
            this._knownMeasures[measure.id] = measure
            if (this.connected && !this.incognito) {
                this.publish(RTIchannel.measures, Measures, { measure }, false)
            }
        }
    }

    measure(measureOrId: Measure | string, value: number) {
        let measure: Measure | undefined = undefined
        if (typeof measureOrId == "string") {
            measure = this._usedMeasures[measureOrId]
            if (!measure) measure = this._knownMeasures[measureOrId]
            if (!measure) {
                measure = Measure.create({ id: measureOrId, application: this.application })
            }
        } else {
            measure = measureOrId
        }
        if (!measure) return
        if (!(measure.id in this._usedMeasures)) this.registerMeasure(measure)
        if (measure.interval > 1e-5) {
            if (!this.collectMeasurementsInterval) this.collectMeasurementsInterval = setInterval(() => this.collectMeasurements(), 500)
            if (!(measure.id in this.collectQueue)) this.collectQueue[measure.id] = []
            this.collectQueue[measure.id].push(value)
        } else {
            const measurement = Measurement.create({ measureId: measure.id, clientId: this.clientId, value })
            const channel = measure.channel || RTIchannel.measurement
            if (this.connected) this.publish(channel, Measurement, measurement, false)
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
                if ((new Date().getTime() - this.lastCollect[id]) * this.measurementIntervalTimeScale > measure.interval * 1000) {
                    const channel = measure.channel || RTIchannel.measurement
                    const measurement = Measurement.create({ measureId: id, clientId: this.clientId })
                    const values = this.collectQueue[id]
                    if (values.length == 1) {
                        measurement.value = values.pop()!
                        this.publish(channel, Measurement, measurement, false)
                    } else if (values.length > 1) {
                        const window = Measurement_Window.create({ min: Infinity, max: -Infinity, count: values.length })
                        for (const value of values) {
                            window.mean += value
                            if (value > window.max) window.max = value
                            if (value < window.min) window.min = value
                        }
                        this.collectQueue[id] = []
                        if (window.count > 0) window.mean /= window.count
                        window.duration = (new Date().getTime() - this.lastCollect[id]) * this.measurementIntervalTimeScale
                        measurement.window = window
                        this.publish(channel, Measurement, measurement, false)
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

    resetKnown() {
        this._knownChannels = {}
        this._knownClients = {}
        this._knownMeasures = {}
    }
}
