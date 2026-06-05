
# Utility class to simplify sending and responding to "start", "stop" messages etc...

import time
import threading
from queue import Queue, Empty
from typing import List, Union
from . import RTIClient, proto as Proto, channel as Channel, capability as Capability
from .rticlient import DispatchMode

_FAST_TIME_STOP = object()


class StepGrant:
    """Represents a fast-time step grant from the controller."""

    def __init__(self, proto_grant, run_id: str):
        self.step_number = proto_grant.step_number
        self.start_time = proto_grant.start_time
        self.end_time = proto_grant.end_time
        self.time_step = proto_grant.end_time - proto_grant.start_time
        self._run_id = run_id
        self._real_start = time.time()


class RTIRuntimeControl:

    def __init__(self, rti: RTIClient, subscribe=True, fast_time=False, step_fn=None):
        self.rti = rti
        rti.capabilities.add(Capability.runtime_control)
        rti.capabilities.add(Capability.scenario)
        rti.capabilities.add(Capability.time_scale)

        self.subscribed = False
        self.scenario = None
        self.time_scale = None
        self.rti.state = Proto.INITIAL

        # Fast-time worker support
        self._step_fn = step_fn
        self._fast_time_enabled = fast_time or step_fn is not None
        self._fast_time_run_id = None
        self._fast_time_controller_client_id = None
        self._grant_queue = Queue()

        if self._fast_time_enabled:
            rti.capabilities.add(Capability.fast_time_worker)

        if subscribe: self.subscribe()

    def on_reset(self):
        pass

    def on_load_scenario(self, load_scenario: Proto.RuntimeControl.ScenarioSpecification, playback: bool):
        return True

    def on_start(self):
        pass

    def on_play(self):
        pass

    def on_pause(self):
        pass

    def on_end(self):
        pass

    def on_stop(self):
        pass

    def on_end_stop(self):
        pass

    def on_reset_end_stop(self):
        pass

    def on_time_scale(self, time_scale: float):
        pass

    def on_time_sync(self, time_sync: Proto.RuntimeControl.TimeSync):
        pass

    def on_seek(self, seek: Proto.RuntimeControl.Seek):
        pass

    def on_step_grant(self, grant: StepGrant):
        """Called when a fast-time step grant is received. Override to add custom behavior.
        Only called when using the get_step_grant() pattern (no step_fn provided)."""
        pass

    @property
    def is_fast_time(self) -> bool:
        """True if currently in a fast-time run."""
        return self._fast_time_run_id is not None

    def get_step_grant(self, timeout: float = 0.01) -> StepGrant:
        """Block until a fast-time step grant arrives. Returns StepGrant or None on timeout/stop.
        For use in the main_loop pattern. Call complete_step(grant) when simulation work is done."""
        try:
            result = self._grant_queue.get(timeout=timeout)
            if result is _FAST_TIME_STOP:
                return None
            return result
        except Empty:
            return None

    def complete_step(self, grant: StepGrant, failed: bool = False, reason: str = ""):
        """Send StepComplete to the fast-time controller."""
        duration = int((time.time() - grant._real_start) * 1000)
        msg = Proto.FastTimeControl()
        msg.step_complete.client_id = self.rti.client_id
        msg.step_complete.run_id = grant._run_id
        msg.step_complete.step_number = grant.step_number
        msg.step_complete.duration = duration
        if failed:
            msg.step_complete.failed = True
            if reason:
                msg.step_complete.reason = reason
        self.rti.publish(Channel.fast_time_control, msg)

    def reset(self):
        message = Proto.RuntimeControl()
        message.reset.SetInParent()
        self._publish_and_receive(message)

    def load_scenario(self, scenario_name):
        message = Proto.RuntimeControl()
        message.load_scenario.name = scenario_name
        self._publish_and_receive(message)

    def start(self):
        message = Proto.RuntimeControl()
        message.start.SetInParent()
        self._publish_and_receive(message)

    def play(self):
        message = Proto.RuntimeControl()
        message.play.SetInParent()
        self._publish_and_receive(message)

    def pause(self):
        message = Proto.RuntimeControl()
        message.pause.SetInParent()
        self._publish_and_receive(message)

    def end(self):
        message = Proto.RuntimeControl()
        message.end.SetInParent()
        self._publish_and_receive(message)

    def stop(self):
        message = Proto.RuntimeControl()
        message.stop.SetInParent()
        self._publish_and_receive(message)

    def set_time_scale(self, time_scale: float):
        message = Proto.RuntimeControl()
        message.set_time_scale.time_scale = time_scale
        self._publish_and_receive(message)

    def seek(self, time: float):
        message = Proto.RuntimeControl()
        message.seek.time = time
        self._publish_and_receive(message)

    def wait_for_application_state(self, application: str, states: Union[int, List[int]], timeout: float = 30):
        if not self.subscribed: raise Exception("Cannot wait for application state without being subscribed")
        if not type(states) is list:
            states = [states]
        clients = self.rti.get_clients_by_application(application)
        if len(clients) == 0:
            self.rti.request_clients()
        start_time = time.time()
        while True:
            clients = self.rti.get_clients_by_application(application)
            allok = True
            if len(clients) == 0: allok = False
            for client in clients:
                if client.state not in states: allok = False
            if allok: return
            elif time.time() - start_time > timeout: raise TimeoutError(f"Timeout waiting for {application} state {', '.join(map(str, states))}")
            time.sleep(0.1)

    def wait_for_client_state(self, client_id: str, states: Union[int, List[int]], timeout: float = 30):
        if not self.subscribed: raise Exception("Cannot wait for client state without being subscribed")
        if not type(states) is list:
            states = [states]
        if client_id not in self.rti.known_clients:
            self.rti.request_clients()
        start_time = time.time()
        while True:
            client = self.rti.known_clients.get(client_id)
            if client and client.state in states: return
            elif time.time() - start_time > timeout: raise TimeoutError(f"Timeout waiting for client {client_id} state {', '.join(map(str, states))}")
            time.sleep(0.1)

    def subscribe(self):
        if not self.subscribed:
            def on_runtime_control(channel, message):
                self._receive(message)
            # Always IMMEDIATE so stop/end/reset pierce BUFFERED mode during fast-time steps
            self.rti.subscribe(Channel.runtime_control, Proto.RuntimeControl, on_runtime_control, dispatch=DispatchMode.IMMEDIATE)
            self.rti.subscribe(self.rti.own_channel_prefix + Channel.runtime_control, Proto.RuntimeControl, on_runtime_control, dispatch=DispatchMode.IMMEDIATE)
            if self._fast_time_enabled:
                def on_fast_time_control(channel, message):
                    self._receive_fast_time(message)
                self.rti.subscribe(Channel.fast_time_control, Proto.FastTimeControl, on_fast_time_control, dispatch=DispatchMode.IMMEDIATE)
                def on_client_disconnect(channel, client_id):
                    self._on_controller_disconnect(client_id)
                self.rti.subscribe_text(Channel.client_disconnect, on_client_disconnect, dispatch=DispatchMode.IMMEDIATE)
            self.subscribed = True

    def _publish_and_receive(self, message: Proto.RuntimeControl):
        self.rti.publish(Channel.runtime_control, message)
        if not self.rti.connected or not self.subscribed: self._receive(message)

    def _on_controller_disconnect(self, client_id: str):
        if (self._fast_time_controller_client_id == client_id and self.is_fast_time and
                self.rti.state != Proto.RUNNING and self.rti.state != Proto.PAUSED):
            self._reset_fast_time()

    def _receive_fast_time(self, message: Proto.FastTimeControl):
        if message.HasField("configure_run"):
            self._fast_time_run_id = message.configure_run.run_id
            self._fast_time_controller_client_id = message.configure_run.controller_client_id
            # default_dispatch_mode stays IMMEDIATE until the first step grant arrives
            ack = Proto.FastTimeControl()
            ack.acknowledge_run.client_id = self.rti.client_id
            ack.acknowledge_run.run_id = message.configure_run.run_id
            self.rti.publish(Channel.fast_time_control, ack)
            self.rti.fast_time_mode = True
        elif message.HasField("configuration"):
            # A configuration with real-time (or unknown) mode means this run is not
            # fast-time stepped — leave fast-time mode and clear the run id.
            if message.configuration.mode <= Proto.FastTimeControl.REAL_TIME:
                self._reset_fast_time()
        elif message.HasField("abandon_run"):
            # The controller abandoned the run we're configured for — leave fast-time mode.
            if message.abandon_run.run_id == self._fast_time_run_id:
                self._reset_fast_time()
        elif message.HasField("step_grant") and message.step_grant.run_id == self._fast_time_run_id:
            grant = StepGrant(message.step_grant, self._fast_time_run_id)
            self.rti.default_dispatch_mode = DispatchMode.BUFFERED  # switch to BUFFERED on first step
            self.rti.flush_buffers()  # dispatch messages buffered since last step
            if self._step_fn:
                try:
                    self._step_fn(grant)
                    self.complete_step(grant)
                except Exception as e:
                    self.complete_step(grant, failed=True, reason=str(e))
            else:
                self.on_step_grant(grant)
                self._grant_queue.put(grant)

    def _reset_fast_time(self):
        if self._fast_time_run_id is not None:
            self._fast_time_run_id = None
            self._fast_time_controller_client_id = None
            # Drain queue and wake up any thread blocking in get_step_grant()
            try:
                while True:
                    self._grant_queue.get_nowait()
            except Empty:
                pass
            self._grant_queue.put(_FAST_TIME_STOP)
            self.rti.default_dispatch_mode = DispatchMode.IMMEDIATE
            self.rti.flush_buffers()
            self.rti.fast_time_mode = False

    def _receive(self, message: Proto.RuntimeControl):
        if message.HasField("reset"):
            self.on_reset_end_stop()
            self.on_reset()
            self.rti.state = Proto.INITIAL
            if self._fast_time_enabled: self._reset_fast_time()
        elif message.HasField("load_scenario"):
            self.scenario = None
            playback = self.rti.state == Proto.PLAYBACK
            self.rti.state = Proto.LOADING
            success = self.on_load_scenario(message.load_scenario, playback)
            if type(success) is bool and not success:
                self.rti.state = Proto.UNKNOWN
                return
            elif type(success) is int:
                self.scenario = message.load_scenario
                self.rti.state = success
                return
            self.scenario = message.load_scenario
            message = Proto.RuntimeControl()
            message.current_scenario.name = self.scenario.name
            message.current_scenario.parameter_values.update(self.scenario.parameter_values)
            self.rti.publish(Channel.runtime_control, message)
            self.rti.state = Proto.READY if not playback else Proto.PLAYBACK
        elif message.HasField("request_current_scenario") and self.scenario:
            message = Proto.RuntimeControl()
            message.current_scenario.name = self.scenario.name
            message.current_scenario.parameter_values.update(self.scenario.parameter_values)
            self.rti.publish(Channel.runtime_control, message)
        elif message.HasField("start"):
            self.on_start()
            self.rti.state = Proto.RUNNING
        elif message.HasField("play"):
            self.on_play()
            self.rti.state = Proto.PLAYBACK
            if self._fast_time_enabled: self._reset_fast_time()
        elif message.HasField("pause"):
            self.on_pause()
            if self.rti.state == Proto.PLAYBACK or self.rti.state == Proto.PLAYBACK_PAUSED:
                self.rti.state = Proto.PLAYBACK_PAUSED
            elif self.rti.state != Proto.END and self.rti.state != Proto.PLAYBACK_END and self.rti.state != Proto.STOPPED and self.rti.state != Proto.PLAYBACK_STOPPED:
                self.rti.state = Proto.PAUSED
        elif message.HasField("end"):
            self.on_reset_end_stop()
            self.on_end_stop()
            self.on_end()
            self.rti.state = Proto.PLAYBACK_END if self.rti.state == Proto.PLAYBACK else Proto.END
            if self._fast_time_enabled: self._reset_fast_time()
        elif message.HasField("stop"):
            self.on_reset_end_stop()
            self.on_end_stop()
            self.on_stop()
            if self.rti.state == Proto.PLAYBACK or self.rti.state == Proto.PLAYBACK_PAUSED or self.rti.state == Proto.PLAYBACK_STOPPED or self.rti.state == Proto.PLAYBACK_END:
                self.rti.state = Proto.PLAYBACK_STOPPED
            else:
                self.rti.state = Proto.STOPPED
            if self._fast_time_enabled: self._reset_fast_time()
        elif message.HasField("set_time_scale"):
            self.time_scale = message.set_time_scale.time_scale
            self.on_time_scale(message.set_time_scale.time_scale)
        elif message.HasField("time_sync"):
            self.time_scale = message.time_sync.time_scale
            self.on_time_sync(message.time_sync)
        elif message.HasField("current_scenario"):
            self.scenario = message.current_scenario
        elif message.HasField("seek"):
            prev_state = self.rti.state
            self.on_seek(message.seek)
            if (prev_state == self.rti.state and self.rti.state != Proto.PLAYBACK and self.rti.state != Proto.RUNNING and self.rti.state != Proto.PAUSED):
                self.rti.state = Proto.PLAYBACK_PAUSED
