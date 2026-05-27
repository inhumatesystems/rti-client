using NUnit.Framework;
using System;
using System.Threading;
using System.Diagnostics;
using Inhumate.RTI.Proto;

namespace Inhumate.RTI {
    [NonParallelizable]
    public class RuntimeControlTest {

        protected static RTIClient rti;
        protected static RTIClient controller;
        protected static RTIRuntimeControl runtime;

        private static int TestTimeoutMs =>
            int.TryParse(Environment.GetEnvironmentVariable("RTI_TEST_TIMEOUT_MS"), out var timeoutMs)
                ? timeoutMs
                : Environment.GetEnvironmentVariable("GITLAB_CI") == "true" ? 60000 : 30000;

        [OneTimeSetUp]
        public static void Setup() {
            rti = FreshClient("C# RuntimeControlTest");

            // Separate client that acts as the controller publishing control messages
            controller = FreshClient("C# RuntimeControlTest Controller");

            runtime = new RTIRuntimeControl(rti);
            Thread.Sleep(100);
        }

        [OneTimeTearDown]
        public static void Teardown() {
            rti?.Disconnect();
            controller?.Disconnect();
            Thread.Sleep(100);
        }

        [SetUp]
        public void ResetState() {
            Thread.Sleep(50); // let any previous test's messages drain
            rti.State = RuntimeState.Initial;
        }

        private static void Publish(RuntimeControl message) =>
            controller.Publish(RTIChannel.RuntimeControl, message);

        private static RTIClient FreshClient(string name = "C# RuntimeControlTest Fresh") {
            Exception lastException = null;
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < TestTimeoutMs) {
                var c = new RTIClient(connect: false) { Application = name };
                c.OnError += (ch, ex) => Console.Error.WriteLine($"Error: {ch}: {ex}");
                try {
                    c.Connect();
                    c.WaitUntilConnected(Math.Max(1000, (int)Math.Min(5000, TestTimeoutMs - sw.ElapsedMilliseconds)));
                    return c;
                } catch (Exception ex) {
                    lastException = ex;
                    try { c.Disconnect(); } catch (Exception) { }
                    Thread.Sleep(250);
                }
            }
            throw new RTIConnectionFailure($"Could not connect {name} within {TestTimeoutMs} ms: {lastException?.Message}");
        }

        private void ConfigureRun(string runId, double timeStep = 1.0) =>
            controller.Publish(RTIChannel.FastTimeControl, new FastTimeControl {
                Configure = new FastTimeControl.Types.Configure {
                    ControllerClientId = controller.ClientId,
                    RunId = runId,
                    TimeStep = timeStep
                }
            });

        private void SendGrant(string runId, long stepNumber = 0, double startTime = 0.0, double timeStep = 1.0) =>
            controller.Publish(RTIChannel.FastTimeControl, new FastTimeControl {
                StepGrant = new FastTimeControl.Types.StepGrant {
                    RunId = runId,
                    StepNumber = stepNumber,
                    StartTime = startTime,
                    EndTime = startTime + timeStep
                }
            });

        private static bool WaitFor(Func<bool> condition, int? timeoutMs = null) {
            var timeout = timeoutMs ?? TestTimeoutMs;
            var sw = Stopwatch.StartNew();
            while (!condition() && sw.ElapsedMilliseconds < timeout) Thread.Sleep(10);
            return condition();
        }

        // --- Capabilities ---

        [Test]
        public void Capabilities_Added() {
            Assert.IsTrue(rti.Capabilities.Contains(RTICapability.RuntimeControl));
            Assert.IsTrue(rti.Capabilities.Contains(RTICapability.Scenario));
            Assert.IsTrue(rti.Capabilities.Contains(RTICapability.TimeScale));
        }

        [Test]
        public void FastTime_Capability_Added() {
            var c = FreshClient("C# RC FastTime Cap Test");
            try {
                new RTIRuntimeControl(c, fastTime: true);
                Assert.IsTrue(c.Capabilities.Contains(RTICapability.FastTimeWorker));
            } finally {
                c.Disconnect();
            }
        }

        // --- State transitions ---

        [Test]
        public void Initial_State_Is_Initial() {
            Assert.AreEqual(RuntimeState.Initial, rti.State);
        }

        [Test]
        public void Start_SetsState_Running() {
            Publish(new RuntimeControl { Start = new Google.Protobuf.WellKnownTypes.Empty() });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Running));
            Assert.AreEqual(RuntimeState.Running, rti.State);
        }

        [Test]
        public void Pause_SetsState_Paused() {
            rti.State = RuntimeState.Running;
            Publish(new RuntimeControl { Pause = new Google.Protobuf.WellKnownTypes.Empty() });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Paused));
            Assert.AreEqual(RuntimeState.Paused, rti.State);
        }

        [Test]
        public void Stop_SetsState_Stopped() {
            rti.State = RuntimeState.Running;
            Publish(new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Stopped));
            Assert.AreEqual(RuntimeState.Stopped, rti.State);
        }

        [Test]
        public void End_SetsState_End() {
            rti.State = RuntimeState.Running;
            Publish(new RuntimeControl { End = new Google.Protobuf.WellKnownTypes.Empty() });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.End));
            Assert.AreEqual(RuntimeState.End, rti.State);
        }

        [Test]
        public void Reset_SetsState_Initial() {
            rti.State = RuntimeState.Running;
            Publish(new RuntimeControl { Reset = new Google.Protobuf.WellKnownTypes.Empty() });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Initial));
            Assert.AreEqual(RuntimeState.Initial, rti.State);
        }

        [Test]
        public void LoadScenario_SetsState_Ready() {
            Publish(new RuntimeControl { LoadScenario = new RuntimeControl.Types.ScenarioSpecification { Name = "TestScene" } });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Ready));
            Assert.AreEqual(RuntimeState.Ready, rti.State);
        }

        [Test]
        public void LoadScenario_StoresScenario() {
            Publish(new RuntimeControl { LoadScenario = new RuntimeControl.Types.ScenarioSpecification { Name = "UniqueScene99" } });
            // Wait for State==Ready (set after Scenario, and involves PublishClient memory barrier)
            // before reading Scenario to avoid ARM memory-ordering issues.
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Ready));
            Assert.AreEqual("UniqueScene99", runtime.Scenario?.Name);
        }

        [Test]
        public void SetTimeScale_UpdatesProperty() {
            Publish(new RuntimeControl { SetTimeScale = new RuntimeControl.Types.SetTimeScale { TimeScale = 2.5 } });
            Assert.IsTrue(WaitFor(() => runtime.TimeScale == 2.5));
            Assert.AreEqual(2.5, runtime.TimeScale.Value, 0.001);
        }

        [Test]
        public void TimeSync_UpdatesTimeScale() {
            Publish(new RuntimeControl { TimeSync = new RuntimeControl.Types.TimeSync { TimeScale = 4.0 } });
            Assert.IsTrue(WaitFor(() => runtime.TimeScale == 4.0));
            Assert.AreEqual(4.0, runtime.TimeScale.Value, 0.001);
        }

        [Test]
        public void Seek_FromInitial_SetsPlaybackPaused() {
            rti.State = RuntimeState.Initial;
            Publish(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 12.5 } });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.PlaybackPaused));
            Assert.AreEqual(RuntimeState.PlaybackPaused, rti.State);
        }

        [Test]
        public void Seek_DuringPlayback_LeavesStateUntouched() {
            rti.State = RuntimeState.Playback;
            Publish(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 1.0 } });
            Thread.Sleep(100);
            Assert.AreEqual(RuntimeState.Playback, rti.State);
        }

        [Test]
        public void Seek_DuringRunning_LeavesStateUntouched() {
            rti.State = RuntimeState.Running;
            Publish(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 1.0 } });
            Thread.Sleep(100);
            Assert.AreEqual(RuntimeState.Running, rti.State);
        }

        [Test]
        public void Seek_DuringPaused_LeavesStateUntouched() {
            rti.State = RuntimeState.Paused;
            Publish(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 1.0 } });
            Thread.Sleep(100);
            Assert.AreEqual(RuntimeState.Paused, rti.State);
        }

        [Test]
        public void Seek_DuringPlaybackStopped_SetsPlaybackPaused() {
            rti.State = RuntimeState.PlaybackStopped;
            Publish(new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 1.0 } });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.PlaybackPaused));
            Assert.AreEqual(RuntimeState.PlaybackPaused, rti.State);
        }

        [Test]
        public void OnSeek_Called() {
            double receivedTime = -1;
            var c = FreshClient("C# RC OnSeek Test");
            try {
                new TestRuntime(c, onSeek: s => { receivedTime = s.Time; });
                Thread.Sleep(250);
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Seek = new RuntimeControl.Types.Seek { Time = 7.25 } });
                Assert.IsTrue(WaitFor(() => receivedTime > 0));
                Assert.AreEqual(7.25, receivedTime, 0.001);
            } finally {
                c.Disconnect();
            }
        }

        // --- Override hooks (fresh client per test for isolation) ---

        [Test]
        public void OnReset_Called() {
            bool called = false;
            var c = FreshClient("C# RC OnReset Test");
            try {
                new TestRuntime(c, onReset: () => { called = true; });
                Thread.Sleep(250);
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Reset = new Google.Protobuf.WellKnownTypes.Empty() });
                Assert.IsTrue(WaitFor(() => called));
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void OnStart_Called() {
            bool called = false;
            var c = FreshClient("C# RC OnStart Test");
            try {
                new TestRuntime(c, onStart: () => { called = true; });
                Thread.Sleep(250);
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Start = new Google.Protobuf.WellKnownTypes.Empty() });
                Assert.IsTrue(WaitFor(() => called));
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void OnStop_Called() {
            bool called = false;
            var c = FreshClient("C# RC OnStop Test");
            try {
                new TestRuntime(c, onStop: () => { called = true; });
                Thread.Sleep(250);
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
                Assert.IsTrue(WaitFor(() => called));
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void OnLoadScenario_ReturnsFalse_SetsUnknown() {
            var c = FreshClient("C# RC LoadFalse Test");
            try {
                new TestRuntime(c, loadScenarioResult: false);
                Thread.Sleep(250);
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { LoadScenario = new RuntimeControl.Types.ScenarioSpecification { Name = "Nope" } });
                Assert.IsTrue(WaitFor(() => c.State == RuntimeState.Unknown));
                Assert.AreEqual(RuntimeState.Unknown, c.State);
            } finally {
                c.Disconnect();
            }
        }

        // --- Fast-time (fresh client per test) ---

        [Test]
        public void FastTime_Configure_SendsAcknowledge() {
            var c = FreshClient("C# RC FT Ack Test");
            FastTimeControl.Types.Acknowledge acked = null;
            var sub = controller.Subscribe<FastTimeControl>(RTIChannel.FastTimeControl, (ch, msg) => {
                if (msg.ControlCase == FastTimeControl.ControlOneofCase.Acknowledge && msg.Acknowledge.RunId == "run-ack" && msg.Acknowledge.ClientId == c.ClientId)
                    acked = msg.Acknowledge;
            });
            try {
                new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(250);
                ConfigureRun("run-ack");
                Assert.IsTrue(WaitFor(() => acked != null));
                Assert.AreEqual("run-ack", acked.RunId);
            } finally {
                controller.Unsubscribe(sub);
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_IsFastTime_AfterConfigure() {
            var c = FreshClient("C# RC FT Isft Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Assert.IsFalse(rt.IsFastTime);
                Thread.Sleep(100);
                ConfigureRun("run-isft");
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                Assert.IsTrue(rt.IsFastTime);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_DispatchMode_Immediate_AfterConfigure_Buffered_AfterStep() {
            var c = FreshClient("C# RC FT Dispatch Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Assert.AreEqual(DispatchMode.Immediate, c.DefaultDispatchMode);
                Thread.Sleep(100);
                ConfigureRun("run-dispatch");
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                // Still Immediate after configure — only switches on first step grant
                Assert.AreEqual(DispatchMode.Immediate, c.DefaultDispatchMode);
                SendGrant("run-dispatch", timeStep: 1.0);
                Assert.IsTrue(WaitFor(() => c.DefaultDispatchMode == DispatchMode.Buffered));
                Assert.AreEqual(DispatchMode.Buffered, c.DefaultDispatchMode);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_Play_ResetsFastTime() {
            var c = FreshClient("C# RC FT Play Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ConfigureRun("run-play");
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Play = new Google.Protobuf.WellKnownTypes.Empty() });
                Assert.IsTrue(WaitFor(() => !rt.IsFastTime));
                Assert.IsFalse(rt.IsFastTime);
                Assert.AreEqual(DispatchMode.Immediate, c.DefaultDispatchMode);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_StepFn_CalledAndCompletes() {
            var c = FreshClient("C# RC FT StepFn Test");
            StepGrant receivedGrant = null;
            FastTimeControl.Types.StepComplete completion = null;
            var sub = controller.Subscribe<FastTimeControl>(RTIChannel.FastTimeControl, (ch, msg) => {
                if (msg.ControlCase == FastTimeControl.ControlOneofCase.StepComplete && msg.StepComplete.RunId == "run-step-fn")
                    completion = msg.StepComplete;
            });
            try {
                var rt = new RTIRuntimeControl(c, stepFn: g => { receivedGrant = g; });
                Thread.Sleep(250);
                ConfigureRun("run-step-fn", timeStep: 0.5);
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                SendGrant("run-step-fn", timeStep: 0.5);
                Assert.IsTrue(WaitFor(() => receivedGrant != null && completion != null));
                Assert.AreEqual(0.5, receivedGrant.TimeStep, 0.001);
                Assert.IsFalse(completion.Failed);
                Assert.AreEqual(0, completion.StepNumber);
            } finally {
                controller.Unsubscribe(sub);
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_GetStepGrant_ReturnsGrant() {
            var c = FreshClient("C# RC FT Wait Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ConfigureRun("run-wait", timeStep: 1.0);
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                SendGrant("run-wait", timeStep: 1.0);
                var grant = rt.GetStepGrant(timeout: TestTimeoutMs);
                Assert.IsNotNull(grant);
                Assert.AreEqual(1.0, grant.TimeStep, 0.001);
                Assert.AreEqual(0, grant.StepNumber);
                rt.CompleteStep(grant);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_Stop_ClearsIsFastTime() {
            var c = FreshClient("C# RC FT Stop Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ConfigureRun("run-stop");
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
                Assert.IsTrue(WaitFor(() => !rt.IsFastTime));
                Assert.IsFalse(rt.IsFastTime);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_GetStepGrant_ReturnsNull_OnStop() {
            var c = FreshClient("C# RC FT Null Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ConfigureRun("run-null");
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                // Stop while waiting — GetStepGrant must unblock and return null
                new Thread(() => {
                    Thread.Sleep(100);
                    controller.Publish(RTIChannel.RuntimeControl, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
                }) { IsBackground = true }.Start();
                var grant = rt.GetStepGrant(timeout: 2000);
                Assert.IsNull(grant);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_ControllerDisconnect_ResetsFastTime() {
            var ctrl = FreshClient("C# RC FT Ctrl Disc Test Ctrl");
            var c = FreshClient("C# RC FT Ctrl Disc Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ctrl.Publish(RTIChannel.FastTimeControl, new FastTimeControl {
                    Configure = new FastTimeControl.Types.Configure {
                        ControllerClientId = ctrl.ClientId,
                        RunId = "run-ctrl-disc",
                        TimeStep = 1.0
                    }
                });
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                // Disconnect controller while in non-running/paused state (Initial)
                ctrl.Disconnect();
                Assert.IsTrue(WaitFor(() => !rt.IsFastTime, timeoutMs: 3000));
                Assert.IsFalse(rt.IsFastTime);
                Assert.AreEqual(DispatchMode.Immediate, c.DefaultDispatchMode);
            } finally {
                c.Disconnect();
            }
        }

        [Test]
        public void FastTime_ControllerDisconnect_DoesNotReset_WhenRunning() {
            var ctrl = FreshClient("C# RC FT Ctrl Running Test Ctrl");
            var c = FreshClient("C# RC FT Ctrl Running Test");
            try {
                var rt = new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(100);
                ctrl.Publish(RTIChannel.FastTimeControl, new FastTimeControl {
                    Configure = new FastTimeControl.Types.Configure {
                        ControllerClientId = ctrl.ClientId,
                        RunId = "run-ctrl-running",
                        TimeStep = 1.0
                    }
                });
                Assert.IsTrue(WaitFor(() => rt.IsFastTime));
                c.State = RuntimeState.Running;
                ctrl.Disconnect();
                Thread.Sleep(300);
                // Fast time should still be active when disconnect happens during Running
                Assert.IsTrue(rt.IsFastTime);
            } finally {
                c.Disconnect();
            }
        }

        // Helper subclass for override hook tests
        private class TestRuntime : RTIRuntimeControl {
            private readonly Action onResetAction;
            private readonly Action onStartAction;
            private readonly Action onStopAction;
            private readonly Action<RuntimeControl.Types.Seek> onSeekAction;
            private readonly bool? loadScenarioResult;

            public TestRuntime(RTIClient rti,
                Action onReset = null, Action onStart = null, Action onStop = null,
                Action<RuntimeControl.Types.Seek> onSeek = null,
                bool? loadScenarioResult = null)
                : base(rti) {
                this.onResetAction = onReset;
                this.onStartAction = onStart;
                this.onStopAction = onStop;
                this.onSeekAction = onSeek;
                this.loadScenarioResult = loadScenarioResult;
            }

            public override void OnReset() => onResetAction?.Invoke();
            public override void OnStart() => onStartAction?.Invoke();
            public override void OnStop() => onStopAction?.Invoke();
            public override void OnSeek(RuntimeControl.Types.Seek seek) => onSeekAction?.Invoke(seek);
            public override bool OnLoadScenario(RuntimeControl.Types.ScenarioSpecification ls, bool playback)
                => loadScenarioResult ?? true;
        }
    }
}
