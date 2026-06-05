
// Utility class to simplify sending and responding to runtime control messages (start, stop, etc.)
// and to add fast-time worker support to a C# RTI client application.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Collections.Concurrent;
using Inhumate.RTI.Proto;

namespace Inhumate.RTI {

    public class StepGrant {
        public long StepNumber { get; }
        public double StartTime { get; }
        public double EndTime { get; }
        public double TimeStep { get; }
        internal string RunId { get; }
        internal DateTime RealStart { get; }

        internal StepGrant(FastTimeControl.Types.StepGrant proto, string runId) {
            StepNumber = proto.StepNumber;
            StartTime = proto.StartTime;
            EndTime = proto.EndTime;
            TimeStep = proto.EndTime - proto.StartTime;
            RunId = runId;
            RealStart = DateTime.Now;
        }
    }

    public class RTIRuntimeControl {

        protected readonly RTIClient rti;

        private bool subscribed;
        private readonly Action<StepGrant> stepFn;
        private readonly bool fastTimeEnabled;
        private string fastTimeRunId;
        private string fastTimeControllerClientId;
        private BlockingCollection<StepGrant> grantQueue = new BlockingCollection<StepGrant>(new ConcurrentQueue<StepGrant>());
        private CancellationTokenSource resetCts = new CancellationTokenSource();

        public double? TimeScale { get; private set; }
        public RuntimeControl.Types.ScenarioSpecification Scenario { get; private set; }

        public bool IsFastTime => fastTimeRunId != null;

        public RTIRuntimeControl(RTIClient rti, bool subscribe = true, bool fastTime = false, Action<StepGrant> stepFn = null) {
            this.rti = rti;
            this.stepFn = stepFn;
            this.fastTimeEnabled = fastTime || stepFn != null;

            rti.Capabilities.Add(RTICapability.RuntimeControl);
            rti.Capabilities.Add(RTICapability.Scenario);
            rti.Capabilities.Add(RTICapability.TimeScale);

            rti.State = RuntimeState.Initial;
            if (fastTimeEnabled) rti.Capabilities.Add(RTICapability.FastTimeWorker);

            if (subscribe) Subscribe();
        }

        // Virtual override hooks — override these in a subclass to add custom behavior.

        public virtual void OnReset() {}
        public virtual bool OnLoadScenario(RuntimeControl.Types.ScenarioSpecification loadScenario, bool playback) => true;
        public virtual void OnStart() {}
        public virtual void OnPlay() {}
        public virtual void OnPause() {}
        public virtual void OnEnd() {}
        public virtual void OnStop() {}
        public virtual void OnEndStop() {}
        public virtual void OnResetEndStop() {}
        public virtual void OnTimeScale(double timeScale) {}
        public virtual void OnTimeSync(RuntimeControl.Types.TimeSync timeSync) {}
        public virtual void OnSeek(RuntimeControl.Types.Seek seek) {}

        /// Called when a fast-time step grant is received. Override to add custom behavior.
        /// Only called when using the GetStepGrant() pattern (no stepFn provided).
        public virtual void OnStepGrant(StepGrant grant) {}

        /// Block until a fast-time step grant arrives. Returns a StepGrant or null on timeout/stop.
        /// For use in a polling loop. Call CompleteStep(grant) when simulation work is done.
        ///
        /// IMPORTANT: In polling mode (rti.Polling = true), use timeout = 0 so that GetStepGrant
        /// returns immediately when no grant is queued, allowing Poll() to read the incoming StepGrant
        /// from the socket. A blocking timeout would stall Poll() and delay grant delivery.
        /// In multi-threaded mode (the default), a blocking timeout is fine.
        public StepGrant GetStepGrant(int timeout = 1) {
            var timeoutMs = timeout <= 0 ? 0 : timeout;
            try {
                if (grantQueue.TryTake(out var grant, timeoutMs, resetCts.Token))
                    return grant;
                return null;
            } catch (OperationCanceledException) {
                return null;
            }
        }

        /// Send StepComplete to the fast-time controller
        public void CompleteStep(StepGrant grant, bool failed = false, string reason = "") {
            var duration = (int)(DateTime.Now - grant.RealStart).TotalMilliseconds;
            var msg = new FastTimeControl {
                StepComplete = new FastTimeControl.Types.StepComplete {
                    ClientId = rti.ClientId,
                    RunId = grant.RunId,
                    StepNumber = grant.StepNumber,
                    Duration = duration,
                }
            };
            if (failed) {
                msg.StepComplete.Failed = true;
                if (!string.IsNullOrEmpty(reason)) msg.StepComplete.Reason = reason;
            }
            rti.Publish(RTIChannel.FastTimeControl, msg);
        }

        // Runtime control publish methods

        public void Reset() => PublishAndReceive(new RuntimeControl { Reset = new Google.Protobuf.WellKnownTypes.Empty() });
        public void LoadScenario(string scenarioName) => PublishAndReceive(new RuntimeControl { LoadScenario = new RuntimeControl.Types.ScenarioSpecification { Name = scenarioName } });
        public void Start() => PublishAndReceive(new RuntimeControl { Start = new Google.Protobuf.WellKnownTypes.Empty() });
        public void Play() => PublishAndReceive(new RuntimeControl { Play = new Google.Protobuf.WellKnownTypes.Empty() });
        public void Pause() => PublishAndReceive(new RuntimeControl { Pause = new Google.Protobuf.WellKnownTypes.Empty() });
        public void End() => PublishAndReceive(new RuntimeControl { End = new Google.Protobuf.WellKnownTypes.Empty() });
        public void Stop() => PublishAndReceive(new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
        public void SetTimeScale(double timeScale) => PublishAndReceive(new RuntimeControl { SetTimeScale = new RuntimeControl.Types.SetTimeScale { TimeScale = timeScale } });
        public void Seek(double time) => PublishAndReceive(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = time } });

        public void Subscribe() {
            if (!subscribed) {
                // Always IMMEDIATE so stop/end/reset pierce BUFFERED mode during fast-time steps
                rti.Subscribe<RuntimeControl>(RTIChannel.RuntimeControl, OnRuntimeControlMessage, dispatchMode: DispatchMode.Immediate);
                rti.Subscribe<RuntimeControl>(rti.OwnChannelPrefix + RTIChannel.RuntimeControl, OnRuntimeControlMessage, dispatchMode: DispatchMode.Immediate);
                if (fastTimeEnabled) {
                    rti.Subscribe<FastTimeControl>(RTIChannel.FastTimeControl, OnFastTimeControlMessage, dispatchMode: DispatchMode.Immediate);
                    rti.Subscribe(RTIChannel.ClientDisconnect, OnClientDisconnectMessage, false, dispatchMode: DispatchMode.Immediate);
                }
                subscribed = true;
            }
        }

        /// Block until all clients with the given application name are in one of the specified states.
        /// Throws TimeoutException if no matching clients have the desired state before the timeout.
        public void WaitForApplicationState(string application, RuntimeState state, double timeout = 30)
            => WaitForApplicationState(application, new[] { state }, timeout);

        public void WaitForApplicationState(string application, IEnumerable<RuntimeState> states, double timeout = 30) {
            if (!subscribed) throw new InvalidOperationException("Cannot wait for application state without being subscribed");
            var stateSet = new HashSet<RuntimeState>(states);
            var clients = rti.KnownClients.Where(c => c.Application == application).ToList();
            if (!clients.Any())
                rti.Publish(RTIChannel.Clients, new Clients { RequestClients = new Google.Protobuf.WellKnownTypes.Empty() });
            var deadline = DateTime.Now.AddSeconds(timeout);
            while (true) {
                clients = rti.KnownClients.Where(c => c.Application == application).ToList();
                if (clients.Any() && clients.All(c => stateSet.Contains(c.State))) return;
                if (DateTime.Now > deadline) throw new TimeoutException($"Timeout waiting for {application} state {string.Join(", ", stateSet)}");
                Thread.Sleep(100);
            }
        }

        /// Block until the client with the given ID is in one of the specified states.
        public void WaitForClientState(string clientId, RuntimeState state, double timeout = 30)
            => WaitForClientState(clientId, new[] { state }, timeout);

        public void WaitForClientState(string clientId, IEnumerable<RuntimeState> states, double timeout = 30) {
            if (!subscribed) throw new InvalidOperationException("Cannot wait for client state without being subscribed");
            var stateSet = new HashSet<RuntimeState>(states);
            if (!rti.KnownClients.Any(c => c.Id == clientId))
                rti.Publish(RTIChannel.Clients, new Clients { RequestClients = new Google.Protobuf.WellKnownTypes.Empty() });
            var deadline = DateTime.Now.AddSeconds(timeout);
            while (true) {
                var client = rti.KnownClients.FirstOrDefault(c => c.Id == clientId);
                if (client != null && stateSet.Contains(client.State)) return;
                if (DateTime.Now > deadline) throw new TimeoutException($"Timeout waiting for client {clientId} state {string.Join(", ", stateSet)}");
                Thread.Sleep(100);
            }
        }

        private void OnRuntimeControlMessage(string channel, RuntimeControl message) => Receive(message);
        private void OnFastTimeControlMessage(string channel, FastTimeControl message) => ReceiveFastTime(message);
        private void OnClientDisconnectMessage(string channel, object message) {
            var clientId = message?.ToString();
            if (clientId != null && clientId == fastTimeControllerClientId && IsFastTime &&
                rti.State != RuntimeState.Running && rti.State != RuntimeState.Paused) {
                ResetFastTime();
            }
        }

        private void PublishAndReceive(RuntimeControl message) {
            rti.Publish(RTIChannel.RuntimeControl, message);
            if (!rti.IsConnected || !subscribed) Receive(message);
        }

        private void ReceiveFastTime(FastTimeControl message) {
            switch (message.ControlCase) {
                case FastTimeControl.ControlOneofCase.ConfigureRun:
                    fastTimeRunId = message.ConfigureRun.RunId;
                    fastTimeControllerClientId = message.ConfigureRun.ControllerClientId;
                    // DefaultDispatchMode stays Immediate until the first step grant arrives
                    rti.Publish(RTIChannel.FastTimeControl, new FastTimeControl {
                        AcknowledgeRun = new FastTimeControl.Types.AcknowledgeRun {
                            ClientId = rti.ClientId,
                            RunId = message.ConfigureRun.RunId,
                        }
                    });
                    rti.FastTimeMode = true;
                    break;
                case FastTimeControl.ControlOneofCase.Configuration:
                    // A configuration with real-time (or unknown) mode means this run is not
                    // fast-time stepped — leave fast-time mode and clear the run id.
                    if (message.Configuration.Mode <= FastTimeControl.Types.ExecutionMode.RealTime) {
                        ResetFastTime();
                    }
                    break;
                case FastTimeControl.ControlOneofCase.AbandonRun:
                    // The controller abandoned the run we're configured for — leave fast-time mode.
                    if (message.AbandonRun.RunId == fastTimeRunId) {
                        ResetFastTime();
                    }
                    break;
                case FastTimeControl.ControlOneofCase.StepGrant:
                    if (message.StepGrant.RunId == fastTimeRunId) {
                        var grant = new StepGrant(message.StepGrant, fastTimeRunId);
                        rti.DefaultDispatchMode = DispatchMode.Buffered; // switch to Buffered on first step
                        rti.FlushBuffers(); // dispatch messages buffered since last step
                        if (stepFn != null) {
                            try {
                                stepFn(grant);
                                CompleteStep(grant);
                            } catch (Exception e) {
                                CompleteStep(grant, failed: true, reason: e.Message);
                            }
                        } else {
                            OnStepGrant(grant);
                            grantQueue.Add(grant);
                        }
                    }
                    break;
            }
        }

        private void ResetFastTime() {
            if (fastTimeRunId != null) {
                fastTimeRunId = null;
                fastTimeControllerClientId = null;
                // Cancel any thread blocking in GetStepGrant() and drain the queue
                resetCts.Cancel();
                resetCts = new CancellationTokenSource();
                while (grantQueue.TryTake(out _)) {}
                rti.DefaultDispatchMode = DispatchMode.Immediate;
                rti.FlushBuffers();
                rti.FastTimeMode = false;
            }
        }

        private void Receive(RuntimeControl message) {
            switch (message.ControlCase) {
                case RuntimeControl.ControlOneofCase.Reset:
                    OnResetEndStop();
                    OnReset();
                    rti.State = RuntimeState.Initial;
                    if (fastTimeEnabled) ResetFastTime();
                    break;
                case RuntimeControl.ControlOneofCase.LoadScenario:
                    Scenario = null;
                    var playback = rti.State == RuntimeState.Playback;
                    rti.State = RuntimeState.Loading;
                    var success = OnLoadScenario(message.LoadScenario, playback);
                    if (!success) {
                        rti.State = RuntimeState.Unknown;
                        return;
                    }
                    Scenario = message.LoadScenario;
                    rti.Publish(RTIChannel.RuntimeControl, new RuntimeControl {
                        CurrentScenario = new RuntimeControl.Types.ScenarioSpecification { Name = Scenario.Name }
                    });
                    rti.State = playback ? RuntimeState.Playback : RuntimeState.Ready;
                    break;
                case RuntimeControl.ControlOneofCase.RequestCurrentScenario:
                    if (Scenario != null) {
                        rti.Publish(RTIChannel.RuntimeControl, new RuntimeControl {
                            CurrentScenario = new RuntimeControl.Types.ScenarioSpecification { Name = Scenario.Name }
                        });
                    }
                    break;
                case RuntimeControl.ControlOneofCase.Start:
                    OnStart();
                    rti.State = RuntimeState.Running;
                    break;
                case RuntimeControl.ControlOneofCase.Play:
                    OnPlay();
                    rti.State = RuntimeState.Playback;
                    if (fastTimeEnabled) ResetFastTime();
                    break;
                case RuntimeControl.ControlOneofCase.Pause:
                    OnPause();
                    if (rti.State == RuntimeState.Playback || rti.State == RuntimeState.PlaybackPaused)
                        rti.State = RuntimeState.PlaybackPaused;
                    else if (rti.State != RuntimeState.End && rti.State != RuntimeState.PlaybackEnd
                             && rti.State != RuntimeState.Stopped && rti.State != RuntimeState.PlaybackStopped)
                        rti.State = RuntimeState.Paused;
                    break;
                case RuntimeControl.ControlOneofCase.End:
                    OnResetEndStop();
                    OnEndStop();
                    OnEnd();
                    rti.State = rti.State == RuntimeState.Playback ? RuntimeState.PlaybackEnd : RuntimeState.End;
                    if (fastTimeEnabled) ResetFastTime();
                    break;
                case RuntimeControl.ControlOneofCase.Stop:
                    OnResetEndStop();
                    OnEndStop();
                    OnStop();
                    if (rti.State == RuntimeState.Playback || rti.State == RuntimeState.PlaybackPaused
                        || rti.State == RuntimeState.PlaybackStopped || rti.State == RuntimeState.PlaybackEnd)
                        rti.State = RuntimeState.PlaybackStopped;
                    else
                        rti.State = RuntimeState.Stopped;
                    if (fastTimeEnabled) ResetFastTime();
                    break;
                case RuntimeControl.ControlOneofCase.SetTimeScale:
                    TimeScale = message.SetTimeScale.TimeScale;
                    OnTimeScale(message.SetTimeScale.TimeScale);
                    break;
                case RuntimeControl.ControlOneofCase.TimeSync:
                    TimeScale = message.TimeSync.TimeScale;
                    OnTimeSync(message.TimeSync);
                    break;
                case RuntimeControl.ControlOneofCase.CurrentScenario:
                    Scenario = new RuntimeControl.Types.ScenarioSpecification { Name = message.CurrentScenario.Name };
                    break;
                case RuntimeControl.ControlOneofCase.Seek:
                    var prevState = rti.State;
                    OnSeek(message.Seek);
                    if (prevState == rti.State && rti.State != RuntimeState.Playback && rti.State != RuntimeState.Running && rti.State != RuntimeState.Paused) {
                        rti.State = RuntimeState.PlaybackPaused;
                    }
                    break;
            }
        }
    }
}
