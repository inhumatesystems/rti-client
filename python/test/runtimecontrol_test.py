import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import unittest
import inhumate_rti as RTI
import time


def wait_for(condition, timeout=2.0):
    count = 0
    max_count = int(timeout * 100)
    while count < max_count and not condition():
        count += 1
        time.sleep(0.01)


class RuntimeControlTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        def on_error(channel, message, exception):
            print(f"Error: {channel}: {message}", file=sys.stderr)

        cls.rti = RTI.Client(application="python_rc_test")
        cls.rti.on("error", on_error)
        cls.rti.wait_until_connected()

        # Separate client that acts as the controller publishing control messages
        cls.controller = RTI.Client(application="python_rc_test_controller")
        cls.controller.on("error", on_error)
        cls.controller.wait_until_connected()

        cls.runtime = RTI.RuntimeControl(cls.rti)
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.rti.disconnect()
        cls.controller.disconnect()

    def setUp(self):
        time.sleep(0.05)  # let any previous test's messages drain
        self.rti.state = RTI.proto.INITIAL

    def _publish(self, msg):
        self.controller.publish(RTI.channel.control, msg)

    def _fresh_client(self, name="python_rc_hook_test"):
        rti = RTI.Client(application=name)
        rti.on("error", lambda c, m, e: print(f"Error: {c}: {m}", file=sys.stderr))
        rti.wait_until_connected()
        return rti

    def _configure_run(self, run_id, time_step=1.0):
        msg = RTI.proto.FastTimeControl()
        msg.configure.controller_client_id = self.controller.client_id
        msg.configure.run_id = run_id
        msg.configure.time_step = time_step
        self.controller.publish(RTI.channel.fast_time_control, msg)

    def _send_grant(self, run_id, step_number=0, start_time=0.0, time_step=1.0):
        msg = RTI.proto.FastTimeControl()
        msg.step_grant.run_id = run_id
        msg.step_grant.step_number = step_number
        msg.step_grant.start_time = start_time
        msg.step_grant.end_time = start_time + time_step
        self.controller.publish(RTI.channel.fast_time_control, msg)

    # --- Capabilities ---

    def test_capabilities_added(self):
        self.assertIn(RTI.capability.runtime_control, self.rti.capabilities)
        self.assertIn(RTI.capability.scenario, self.rti.capabilities)
        self.assertIn(RTI.capability.time_scale, self.rti.capabilities)

    def test_fast_time_capability_added(self):
        rti = self._fresh_client("python_rc_ft_cap_test")
        try:
            runtime = RTI.RuntimeControl(rti, fast_time=True)
            self.assertIn(RTI.capability.fast_time_worker, rti.capabilities)
        finally:
            rti.disconnect()

    # --- State transitions ---

    def test_initial_state_is_initial(self):
        self.assertEqual(RTI.proto.INITIAL, self.rti.state)

    def test_start_sets_state_running(self):
        msg = RTI.proto.RuntimeControl()
        msg.start.SetInParent()
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.RUNNING)
        self.assertEqual(RTI.proto.RUNNING, self.rti.state)

    def test_pause_sets_state_paused(self):
        self.rti.state = RTI.proto.RUNNING
        msg = RTI.proto.RuntimeControl()
        msg.pause.SetInParent()
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.PAUSED)
        self.assertEqual(RTI.proto.PAUSED, self.rti.state)

    def test_stop_sets_state_stopped(self):
        self.rti.state = RTI.proto.RUNNING
        msg = RTI.proto.RuntimeControl()
        msg.stop.SetInParent()
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.STOPPED)
        self.assertEqual(RTI.proto.STOPPED, self.rti.state)

    def test_end_sets_state_end(self):
        self.rti.state = RTI.proto.RUNNING
        msg = RTI.proto.RuntimeControl()
        msg.end.SetInParent()
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.END)
        self.assertEqual(RTI.proto.END, self.rti.state)

    def test_reset_sets_state_initial(self):
        self.rti.state = RTI.proto.RUNNING
        msg = RTI.proto.RuntimeControl()
        msg.reset.SetInParent()
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.INITIAL)
        self.assertEqual(RTI.proto.INITIAL, self.rti.state)

    def test_load_scenario_sets_state_ready(self):
        msg = RTI.proto.RuntimeControl()
        msg.load_scenario.name = "TestScenario"
        self._publish(msg)
        wait_for(lambda: self.rti.state == RTI.proto.READY)
        self.assertEqual(RTI.proto.READY, self.rti.state)

    def test_load_scenario_stores_scenario(self):
        msg = RTI.proto.RuntimeControl()
        msg.load_scenario.name = "UniqueScenario42"
        self._publish(msg)
        wait_for(lambda: self.runtime.scenario is not None and self.runtime.scenario.name == "UniqueScenario42")
        self.assertEqual("UniqueScenario42", self.runtime.scenario.name)

    def test_set_time_scale_updates_property(self):
        msg = RTI.proto.RuntimeControl()
        msg.set_time_scale.time_scale = 2.5
        self._publish(msg)
        wait_for(lambda: self.runtime.time_scale == 2.5)
        self.assertAlmostEqual(2.5, self.runtime.time_scale)

    def test_time_sync_updates_time_scale(self):
        msg = RTI.proto.RuntimeControl()
        msg.time_sync.time_scale = 4.0
        self._publish(msg)
        wait_for(lambda: self.runtime.time_scale == 4.0)
        self.assertAlmostEqual(4.0, self.runtime.time_scale)

    # --- Override hooks (fresh client per test for isolation) ---

    def test_on_reset_called(self):
        rti = self._fresh_client()
        try:
            called = []
            class TestRuntime(RTI.RuntimeControl):
                def on_reset(self): called.append(True)
            TestRuntime(rti)
            msg = RTI.proto.RuntimeControl()
            msg.reset.SetInParent()
            self.controller.publish(RTI.channel.control, msg)
            wait_for(lambda: len(called) > 0)
            self.assertTrue(called)
        finally:
            rti.disconnect()

    def test_on_start_called(self):
        rti = self._fresh_client()
        try:
            called = []
            class TestRuntime(RTI.RuntimeControl):
                def on_start(self): called.append(True)
            TestRuntime(rti)
            msg = RTI.proto.RuntimeControl()
            msg.start.SetInParent()
            self.controller.publish(RTI.channel.control, msg)
            wait_for(lambda: len(called) > 0)
            self.assertTrue(called)
        finally:
            rti.disconnect()

    def test_on_stop_called(self):
        rti = self._fresh_client()
        try:
            called = []
            class TestRuntime(RTI.RuntimeControl):
                def on_stop(self): called.append(True)
            TestRuntime(rti)
            msg = RTI.proto.RuntimeControl()
            msg.stop.SetInParent()
            self.controller.publish(RTI.channel.control, msg)
            wait_for(lambda: len(called) > 0)
            self.assertTrue(called)
        finally:
            rti.disconnect()

    def test_on_load_scenario_false_sets_unknown(self):
        rti = self._fresh_client()
        try:
            class TestRuntime(RTI.RuntimeControl):
                def on_load_scenario(self, load_scenario, playback): return False
            TestRuntime(rti)
            msg = RTI.proto.RuntimeControl()
            msg.load_scenario.name = "Nope"
            self.controller.publish(RTI.channel.control, msg)
            wait_for(lambda: rti.state == RTI.proto.UNKNOWN)
            self.assertEqual(RTI.proto.UNKNOWN, rti.state)
        finally:
            rti.disconnect()

    # --- Fast-time (fresh client per test) ---

    def test_fast_time_configure_sends_acknowledge(self):
        rti = self._fresh_client("python_rc_ft_ack_test")
        acked = []
        sub = self.controller.subscribe(RTI.channel.fast_time_control, RTI.proto.FastTimeControl,
            lambda c, m: acked.append(m.acknowledge) if m.HasField("acknowledge") else None)
        try:
            RTI.RuntimeControl(rti, fast_time=True)
            time.sleep(0.5)
            self._configure_run("run-ack")
            wait_for(lambda: any(a.client_id == rti.client_id for a in acked))
            self.assertTrue(any(a.client_id == rti.client_id for a in acked))
            mine = next(a for a in acked if a.client_id == rti.client_id)
            self.assertEqual("run-ack", mine.run_id)
        finally:
            self.controller.unsubscribe(sub)
            rti.disconnect()

    def test_fast_time_is_fast_time_after_configure(self):
        rti = self._fresh_client("python_rc_ft_isft_test")
        try:
            runtime = RTI.RuntimeControl(rti, fast_time=True)
            self.assertFalse(runtime.is_fast_time)
            time.sleep(0.5)
            self._configure_run("run-isft")
            wait_for(lambda: runtime.is_fast_time)
            self.assertTrue(runtime.is_fast_time)
        finally:
            rti.disconnect()

    def test_fast_time_dispatch_mode_buffered_after_configure(self):
        rti = self._fresh_client("python_rc_ft_disp_test")
        try:
            RTI.RuntimeControl(rti, fast_time=True)
            self.assertEqual(RTI.DispatchMode.IMMEDIATE, rti.default_dispatch_mode)
            time.sleep(0.5)
            self._configure_run("run-dispatch")
            wait_for(lambda: rti.default_dispatch_mode == RTI.DispatchMode.BUFFERED)
            self.assertEqual(RTI.DispatchMode.BUFFERED, rti.default_dispatch_mode)
        finally:
            rti.disconnect()

    def test_fast_time_step_fn_called_and_completes(self):
        rti = self._fresh_client("python_rc_ft_step_test")
        steps = []
        completions = []
        sub = self.controller.subscribe(RTI.channel.fast_time_control, RTI.proto.FastTimeControl,
            lambda c, m: completions.append(m.step_complete) if m.HasField("step_complete") else None)
        try:
            RTI.RuntimeControl(rti, step_fn=lambda g: steps.append(g))
            time.sleep(0.5)
            self._configure_run("run-step-fn", time_step=0.5)
            time.sleep(0.1)
            self._send_grant("run-step-fn", time_step=0.5)
            wait_for(lambda: any(c.client_id == rti.client_id for c in completions) and len(steps) > 0)
            self.assertTrue(len(steps) > 0)
            self.assertAlmostEqual(0.5, steps[0].time_step)
            mine = next(c for c in completions if c.client_id == rti.client_id)
            self.assertFalse(mine.failed)
            self.assertEqual(0, mine.step_number)
        finally:
            self.controller.unsubscribe(sub)
            rti.disconnect()

    def test_fast_time_wait_for_step_grant(self):
        rti = self._fresh_client("python_rc_ft_wait_test")
        try:
            runtime = RTI.RuntimeControl(rti, fast_time=True)
            time.sleep(0.5)
            self._configure_run("run-wait", time_step=1.0)
            time.sleep(0.1)
            self._send_grant("run-wait", time_step=1.0)
            grant = runtime.wait_for_step_grant(timeout=2.0)
            self.assertIsNotNone(grant)
            self.assertAlmostEqual(1.0, grant.time_step)
            self.assertEqual(0, grant.step_number)
            runtime.complete_step(grant)
        finally:
            rti.disconnect()

    def test_fast_time_stop_clears_is_fast_time(self):
        rti = self._fresh_client("python_rc_ft_stop_test")
        try:
            runtime = RTI.RuntimeControl(rti, fast_time=True)
            time.sleep(0.5)
            self._configure_run("run-stop")
            wait_for(lambda: runtime.is_fast_time)
            self.assertTrue(runtime.is_fast_time)
            msg = RTI.proto.RuntimeControl()
            msg.stop.SetInParent()
            self.controller.publish(RTI.channel.control, msg)
            wait_for(lambda: not runtime.is_fast_time)
            self.assertFalse(runtime.is_fast_time)
        finally:
            rti.disconnect()

    def test_fast_time_wait_for_step_grant_returns_none_on_stop(self):
        rti = self._fresh_client("python_rc_ft_none_test")
        try:
            runtime = RTI.RuntimeControl(rti, fast_time=True)
            time.sleep(0.5)
            self._configure_run("run-none")
            wait_for(lambda: runtime.is_fast_time)
            # Stop while waiting — WaitForStepGrant must unblock and return None
            def do_stop():
                time.sleep(0.1)
                msg = RTI.proto.RuntimeControl()
                msg.stop.SetInParent()
                self.controller.publish(RTI.channel.control, msg)
            import threading
            threading.Thread(target=do_stop, daemon=True).start()
            grant = runtime.wait_for_step_grant(timeout=2.0)
            self.assertIsNone(grant)
        finally:
            rti.disconnect()


if __name__ == "__main__":
    unittest.main()
