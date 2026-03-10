
// Utility class to simplify sending and responding to "start", "stop" messages etc.
// and to add fast-time worker support to a TypeScript/JavaScript RTI client.

import { RTIClient, DispatchMode } from "./rticlient.js"
import { channel as RTIchannel, capability as RTIcapability } from "./constants.js"
import { RuntimeControl, RuntimeControl_LoadScenario, RuntimeControl_TimeSync } from "./generated/RuntimeControl.js"
import { FastTimeControl } from "./generated/FastTimeControl.js"
import { RuntimeState } from "./generated/RuntimeState.js"
import { Clients } from "./generated/Clients.js"
import { Log } from "./generated/Logs.js"

export class StepGrant {
    readonly stepNumber: number
    readonly startTime: number
    readonly endTime: number
    readonly timeStep: number
    /** @internal */ readonly _runId: string
    /** @internal */ readonly _realStart: number

    /** @internal */
    constructor(proto: { stepNumber: number; startTime: number; endTime: number }, runId: string) {
        this.stepNumber = proto.stepNumber
        this.startTime = proto.startTime
        this.endTime = proto.endTime
        this.timeStep = proto.endTime - proto.startTime
        this._runId = runId
        this._realStart = Date.now()
    }
}

export class RTIRuntimeControl {
    protected readonly rti: RTIClient

    scenario: RuntimeControl_LoadScenario | undefined = undefined
    publishScenario: boolean = false
    asyncReady: boolean = false
    timeScale: number | undefined = undefined
    currentLog: Log | undefined = undefined

    private _subscribed: boolean = false
    private readonly _stepFn: ((grant: StepGrant) => void | Promise<void>) | undefined
    private readonly _fastTimeEnabled: boolean
    private _fastTimeRunId: string | undefined = undefined
    private _fastTimeControllerClientId: string | undefined = undefined

    // Promise-based grant queue
    private _grantWaiters: Array<(grant: StepGrant | null) => void> = []
    private _grantQueue: StepGrant[] = []

    get isFastTime(): boolean {
        return this._fastTimeRunId !== undefined
    }

    constructor(rti: RTIClient, subscribe = true, fastTime = false, stepFn?: (grant: StepGrant) => void | Promise<void>) {
        this.rti = rti
        this._stepFn = stepFn
        this._fastTimeEnabled = fastTime || stepFn !== undefined

        if (!rti.capabilities.includes(RTIcapability.runtimeControl)) rti.capabilities.push(RTIcapability.runtimeControl)
        if (!rti.capabilities.includes(RTIcapability.scenario)) rti.capabilities.push(RTIcapability.scenario)
        if (!rti.capabilities.includes(RTIcapability.timeScale)) rti.capabilities.push(RTIcapability.timeScale)

        rti.state = RuntimeState.INITIAL

        if (this._fastTimeEnabled) {
            if (!rti.capabilities.includes(RTIcapability.fastTimeWorker))
                rti.capabilities.push(RTIcapability.fastTimeWorker)
        }

        if (subscribe) this.subscribe()
    }

    // Override hooks — subclass and override to add custom behavior

    onReset(): void {}
    onLoadScenario(loadScenario: RuntimeControl_LoadScenario, playback: boolean): boolean { return true }
    onStart(): void {}
    onPlay(): void {}
    onPause(): void {}
    onEnd(): void {}
    onStop(): void {}
    onEndStop(): void {}
    onResetEndStop(): void {}
    onTimeScale(timeScale: number): void {}
    onTimeSync(timeSync: RuntimeControl_TimeSync): void {}

    /** Called when a fast-time step grant is received. Override to add custom behavior.
     * Only called when using the getStepGrant() pattern (no stepFn provided). */
    onStepGrant(grant: StepGrant): void {}

    /** Returns a Promise that resolves to a StepGrant when one arrives, or null on timeout/stop.
     * For use in an async loop. Call completeStep(grant) when simulation work is done.
     *
     * In Node.js (the primary target), the event loop handles incoming messages while the
     * caller is awaiting this promise, so a blocking timeout is safe and natural:
     *   while (true) { const grant = await runtime.getStepGrant(); if (!grant) continue; ... }
     *
     * @param timeoutMs Timeout in milliseconds. 0 = no timeout (wait indefinitely). Default: 1000.
     */
    getStepGrant(timeoutMs: number = 1000): Promise<StepGrant | null> {
        if (this._grantQueue.length > 0) {
            return Promise.resolve(this._grantQueue.shift()!)
        }
        return new Promise<StepGrant | null>((resolve) => {
            let settled = false
            const settle = (value: StepGrant | null) => {
                if (!settled) {
                    settled = true
                    const idx = this._grantWaiters.indexOf(settle)
                    if (idx >= 0) this._grantWaiters.splice(idx, 1)
                    resolve(value)
                }
            }
            this._grantWaiters.push(settle)
            if (timeoutMs > 0) setTimeout(() => settle(null), timeoutMs)
        })
    }

    /** Send StepComplete to the fast-time controller. */
    completeStep(grant: StepGrant, failed = false, reason = ""): void {
        const duration = Date.now() - grant._realStart
        this.rti.publish(RTIchannel.fastTimeControl, FastTimeControl, {
            stepComplete: {
                clientId: this.rti.clientId,
                runId: grant._runId,
                stepNumber: grant.stepNumber,
                duration,
                failed,
                reason,
            }
        }, false)
    }

    // Runtime control publish methods

    reset(): void { this._publishAndReceive({ reset: {} }) }
    loadScenario(scenarioName: string): void { this._publishAndReceive({ loadScenario: { name: scenarioName, parameterValues: {} } }) }
    start(): void { this._publishAndReceive({ start: {} }) }
    play(): void { this._publishAndReceive({ play: {} }) }
    pause(): void { this._publishAndReceive({ pause: {} }) }
    end(): void { this._publishAndReceive({ end: {} }) }
    stop(): void { this._publishAndReceive({ stop: {} }) }
    setTimeScale(timeScale: number): void { this._publishAndReceive({ setTimeScale: { timeScale } }) }
    seek(time: number): void { this._publishAndReceive({ seek: { time } }) }
    requestCurrentLog(): void { this._publishAndReceive({ requestCurrentLog: {} }) }

    subscribe(): void {
        if (!this._subscribed) {
            const onMsg = (_ch: string, message: RuntimeControl) => this._receive(message)
            // Always IMMEDIATE so stop/end/reset pierce BUFFERED mode during fast-time steps
            this.rti.subscribe(RTIchannel.control, RuntimeControl, onMsg, false, DispatchMode.IMMEDIATE)
            // Subscribe to own (targeted) channel once clientId is known
            const subscribeOwn = () => {
                this.rti.subscribe(this.rti.ownChannelPrefix + RTIchannel.control, RuntimeControl, onMsg, false, DispatchMode.IMMEDIATE)
            }
            if (this.rti.clientId) subscribeOwn()
            else this.rti.once("firstconnect", subscribeOwn)
            if (this._fastTimeEnabled) {
                this.rti.subscribe(RTIchannel.fastTimeControl, FastTimeControl,
                    (_ch: string, message: FastTimeControl) => this._receiveFastTime(message),
                    false, DispatchMode.IMMEDIATE)
                this.rti.subscribeText(RTIchannel.clientDisconnect,
                    (_ch: string, clientId: string) => this._onControllerDisconnect(clientId),
                    false, DispatchMode.IMMEDIATE)
            }
            this._subscribed = true
        }
    }

    /** Async wait until all clients with the given application are in one of the specified states.
     * Throws on timeout. */
    async waitForApplicationState(application: string, states: RuntimeState | RuntimeState[], timeoutSec: number = 30): Promise<void> {
        if (!this._subscribed) throw new Error("Cannot wait for application state without being subscribed")
        const stateSet = new Set(Array.isArray(states) ? states : [states])
        if (!this.rti.knownClients.some(c => c.application === application)) {
            this.rti.publish(RTIchannel.clients, Clients, { requestClients: {} }, false)
        }
        const deadline = Date.now() + timeoutSec * 1000
        while (true) {
            const clients = this.rti.knownClients.filter(c => c.application === application)
            if (clients.length > 0 && clients.every(c => stateSet.has(c.state!))) return
            if (Date.now() > deadline) throw new Error(`Timeout waiting for ${application} state ${[...stateSet].join(", ")}`)
            await sleep(100)
        }
    }

    /** Async wait until the client with the given ID is in one of the specified states.
     * Throws on timeout. */
    async waitForClientState(clientId: string, states: RuntimeState | RuntimeState[], timeoutSec: number = 30): Promise<void> {
        if (!this._subscribed) throw new Error("Cannot wait for client state without being subscribed")
        const stateSet = new Set(Array.isArray(states) ? states : [states])
        if (!this.rti.knownClients.some(c => c.id === clientId)) {
            this.rti.publish(RTIchannel.clients, Clients, { requestClients: {} }, false)
        }
        const deadline = Date.now() + timeoutSec * 1000
        while (true) {
            const client = this.rti.knownClients.find(c => c.id === clientId)
            if (client && stateSet.has(client.state!)) return
            if (Date.now() > deadline) throw new Error(`Timeout waiting for client ${clientId} state ${[...stateSet].join(", ")}`)
            await sleep(100)
        }
    }

    private _publishAndReceive(message: Partial<RuntimeControl>): void {
        this.rti.publish(RTIchannel.control, RuntimeControl, message, false)
        if (!this.rti.isConnected || !this._subscribed) this._receive(RuntimeControl.fromPartial(message))
    }

    private _onControllerDisconnect(clientId: string): void {
        if (this._fastTimeControllerClientId === clientId && this.isFastTime &&
            this.rti.state !== RuntimeState.RUNNING && this.rti.state !== RuntimeState.PAUSED) {
            this._resetFastTime()
        }
    }

    private _receiveFastTime(message: FastTimeControl): void {
        if (message.configure) {
            this._fastTimeRunId = message.configure.runId
            this._fastTimeControllerClientId = message.configure.controllerClientId
            // defaultDispatchMode stays IMMEDIATE until the first step grant arrives
            this.rti.publish(RTIchannel.fastTimeControl, FastTimeControl, {
                acknowledge: {
                    clientId: this.rti.clientId,
                    runId: message.configure.runId,
                    failed: false,
                    reason: "",
                }
            }, false)
            this.rti.fastTimeMode = true
        } else if (message.stepGrant && message.stepGrant.runId === this._fastTimeRunId) {
            const grant = new StepGrant(message.stepGrant, this._fastTimeRunId!)
            this.rti.defaultDispatchMode = DispatchMode.BUFFERED // switch to BUFFERED on first step
            this.rti.flushBuffers() // dispatch messages buffered since last step
            if (this._stepFn) {
                Promise.resolve(this._stepFn(grant))
                    .then(() => this.completeStep(grant))
                    .catch((e: any) => this.completeStep(grant, true, e?.message ?? String(e)))
            } else {
                this.onStepGrant(grant)
                if (this._grantWaiters.length > 0) {
                    this._grantWaiters.shift()!(grant)
                } else {
                    this._grantQueue.push(grant)
                }
            }
        }
    }

    private _resetFastTime(): void {
        if (this._fastTimeRunId !== undefined) {
            this._fastTimeRunId = undefined
            this._fastTimeControllerClientId = undefined
            // Cancel all pending waiters and drain the queue
            const waiters = this._grantWaiters.splice(0)
            this._grantQueue.length = 0
            for (const waiter of waiters) waiter(null)
            this.rti.defaultDispatchMode = DispatchMode.IMMEDIATE
            this.rti.flushBuffers()
            this.rti.fastTimeMode = false
        }
    }

    private _receive(message: RuntimeControl): void {
        if (message.reset !== undefined) {
            this.onResetEndStop()
            this.onReset()
            this.rti.state = RuntimeState.INITIAL
            if (this._fastTimeEnabled) this._resetFastTime()
        } else if (message.loadScenario !== undefined) {
            this.scenario = undefined
            const playback = this.rti.state === RuntimeState.PLAYBACK
            this.rti.state = RuntimeState.LOADING
            const success = this.onLoadScenario(message.loadScenario, playback)
            if (!success) {
                this.rti.state = RuntimeState.UNKNOWN
                return
            }
            this.scenario = message.loadScenario
            this.rti.state = playback ? RuntimeState.PLAYBACK : RuntimeState.READY
        } else if (message.requestCurrentScenario !== undefined && this.publishScenario && this.scenario) {
            this.rti.publish(RTIchannel.control, RuntimeControl, {
                currentScenario: { name: this.scenario.name, parameterValues: this.scenario.parameterValues }
            }, false)
        } else if (message.start !== undefined) {
            this.onStart()
            this.rti.state = RuntimeState.RUNNING
        } else if (message.play !== undefined) {
            this.onPlay()
            this.rti.state = RuntimeState.PLAYBACK
            if (this._fastTimeEnabled) this._resetFastTime()
        } else if (message.pause !== undefined) {
            this.onPause()
            if (this.rti.state === RuntimeState.PLAYBACK || this.rti.state === RuntimeState.PLAYBACK_PAUSED)
                this.rti.state = RuntimeState.PLAYBACK_PAUSED
            else if (
                this.rti.state !== RuntimeState.END && this.rti.state !== RuntimeState.PLAYBACK_END &&
                this.rti.state !== RuntimeState.STOPPED && this.rti.state !== RuntimeState.PLAYBACK_STOPPED
            )
                this.rti.state = RuntimeState.PAUSED
        } else if (message.end !== undefined) {
            this.onResetEndStop()
            this.onEndStop()
            this.onEnd()
            this.rti.state = this.rti.state === RuntimeState.PLAYBACK ? RuntimeState.PLAYBACK_END : RuntimeState.END
            if (this._fastTimeEnabled) this._resetFastTime()
        } else if (message.stop !== undefined) {
            this.onResetEndStop()
            this.onEndStop()
            this.onStop()
            if (
                this.rti.state === RuntimeState.PLAYBACK || this.rti.state === RuntimeState.PLAYBACK_PAUSED ||
                this.rti.state === RuntimeState.PLAYBACK_STOPPED || this.rti.state === RuntimeState.PLAYBACK_END
            )
                this.rti.state = RuntimeState.PLAYBACK_STOPPED
            else
                this.rti.state = RuntimeState.STOPPED
            if (this._fastTimeEnabled) this._resetFastTime()
        } else if (message.setTimeScale !== undefined) {
            this.timeScale = message.setTimeScale.timeScale
            this.onTimeScale(message.setTimeScale.timeScale)
        } else if (message.timeSync !== undefined) {
            this.timeScale = message.timeSync.timeScale
            this.onTimeSync(message.timeSync)
        } else if (message.currentLog !== undefined) {
            this.currentLog = message.currentLog
        } else if (message.currentScenario !== undefined) {
            this.scenario = message.currentScenario
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
