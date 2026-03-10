using NUnit.Framework;
using System;
using System.Threading;
using Inhumate.RTI.Proto;

namespace Inhumate.RTI {
    public class RuntimeControlTest {

        protected static RTIClient rti;
        protected static RTIClient controller;
        protected static RTIRuntimeControl runtime;

        [OneTimeSetUp]
        public static void Setup() {
            rti = new RTIClient { Application = "C# RuntimeControlTest" };
            rti.OnError += (channelName, exception) => Console.Error.WriteLine($"Error: {channelName}: {exception}");
            rti.WaitUntilConnected();

            // Separate client that acts as the controller publishing control messages
            controller = new RTIClient { Application = "C# RuntimeControlTest Controller" };
            controller.OnError += (channelName, exception) => Console.Error.WriteLine($"Error: {channelName}: {exception}");
            controller.WaitUntilConnected();

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
            controller.Publish(RTIChannel.Control, message);

        private static RTIClient FreshClient(string name = "C# RuntimeControlTest Fresh") {
            var c = new RTIClient { Application = name };
            c.OnError += (ch, ex) => Console.Error.WriteLine($"Error: {ch}: {ex}");
            c.WaitUntilConnected();
            return c;
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

        private static bool WaitFor(Func<bool> condition, int timeoutMs = 2000) {
            int count = 0;
            while (!condition() && count++ < timeoutMs / 10) Thread.Sleep(10);
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
            Publish(new RuntimeControl { LoadScenario = new RuntimeControl.Types.LoadScenario { Name = "TestScene" } });
            Assert.IsTrue(WaitFor(() => rti.State == RuntimeState.Ready));
            Assert.AreEqual(RuntimeState.Ready, rti.State);
        }

        [Test]
        public void LoadScenario_StoresScenario() {
            Publish(new RuntimeControl { LoadScenario = new RuntimeControl.Types.LoadScenario { Name = "UniqueScene99" } });
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

        // --- Override hooks (fresh client per test for isolation) ---

        [Test]
        public void OnReset_Called() {
            bool called = false;
            var c = FreshClient("C# RC OnReset Test");
            try {
                new TestRuntime(c, onReset: () => { called = true; });
                Thread.Sleep(250);
                controller.Publish(RTIChannel.Control, new RuntimeControl { Reset = new Google.Protobuf.WellKnownTypes.Empty() });
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
                controller.Publish(RTIChannel.Control, new RuntimeControl { Start = new Google.Protobuf.WellKnownTypes.Empty() });
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
                controller.Publish(RTIChannel.Control, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
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
                controller.Publish(RTIChannel.Control, new RuntimeControl { LoadScenario = new RuntimeControl.Types.LoadScenario { Name = "Nope" } });
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
                if (msg.ControlCase == FastTimeControl.ControlOneofCase.Acknowledge && msg.Acknowledge.RunId == "run-ack")
                    acked = msg.Acknowledge;
            });
            try {
                new RTIRuntimeControl(c, fastTime: true);
                Thread.Sleep(250);
                ConfigureRun("run-ack");
                Assert.IsTrue(WaitFor(() => acked != null));
                Assert.AreEqual(c.ClientId, acked.ClientId);
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
                controller.Publish(RTIChannel.Control, new RuntimeControl { Play = new Google.Protobuf.WellKnownTypes.Empty() });
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
                new RTIRuntimeControl(c, stepFn: g => { receivedGrant = g; });
                Thread.Sleep(250);
                ConfigureRun("run-step-fn", timeStep: 0.5);
                Thread.Sleep(100);
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
                Thread.Sleep(100);
                SendGrant("run-wait", timeStep: 1.0);
                var grant = rt.GetStepGrant(timeout: 2000);
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
                controller.Publish(RTIChannel.Control, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
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
                    controller.Publish(RTIChannel.Control, new RuntimeControl { Stop = new Google.Protobuf.WellKnownTypes.Empty() });
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
            private readonly bool? loadScenarioResult;

            public TestRuntime(RTIClient rti,
                Action onReset = null, Action onStart = null, Action onStop = null,
                bool? loadScenarioResult = null)
                : base(rti) {
                this.onResetAction = onReset;
                this.onStartAction = onStart;
                this.onStopAction = onStop;
                this.loadScenarioResult = loadScenarioResult;
            }

            public override void OnReset() => onResetAction?.Invoke();
            public override void OnStart() => onStartAction?.Invoke();
            public override void OnStop() => onStopAction?.Invoke();
            public override bool OnLoadScenario(RuntimeControl.Types.LoadScenario ls, bool playback)
                => loadScenarioResult ?? true;
        }
    }
}
