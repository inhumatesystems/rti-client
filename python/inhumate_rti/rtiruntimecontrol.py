
# Utility class to simplify sending and responding to "start", "stop" messages etc...

import time
from typing import List, Union
from . import RTIClient, proto as Proto, channel as Channel, capability as Capability

class RTIRuntimeControl:

    def __init__(self, rti: RTIClient, subscribe = True):
        self.rti = rti
        if Capability.runtime_control not in rti.capabilities: rti.capabilities.append(Capability.runtime_control)
        if Capability.scenario not in rti.capabilities: rti.capabilities.append(Capability.scenario)
        if Capability.time_scale not in rti.capabilities: rti.capabilities.append(Capability.time_scale)

        self.subscribed = False
        self.scenario = None
        self.publish_scenario = False
        self.async_ready = False
        self.time_scale = None
        self.current_log = None
        self.rti.state = Proto.INITIAL
        if subscribe: self.subscribe()

    def on_reset(self):
        pass

    def on_load_scenario(self, load_scenario: Proto.RuntimeControl.LoadScenario, playback: bool):
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

    def request_current_log(self):
        message = Proto.RuntimeControl()
        message.request_current_log.SetInParent()
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
            self.rti.subscribe(Channel.control, Proto.RuntimeControl, on_runtime_control)
            self.rti.subscribe(self.rti.own_channel_prefix + Channel.control, Proto.RuntimeControl, on_runtime_control)
            self.subscribed = True

    def _publish_and_receive(self, message: Proto.RuntimeControl):
        self.rti.publish(Channel.control, message)
        if not self.rti.connected or not self.subscribed: self._receive(message)

    def _receive(self, message: Proto.RuntimeControl):
        if message.HasField("reset"):
            self.on_reset_end_stop()
            self.on_reset()
            self.rti.state = Proto.INITIAL
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
            self.rti.state = Proto.READY if not playback else Proto.PLAYBACK
        elif message.HasField("request_current_scenario") and self.publish_scenario and self.scenario:
            message = Proto.RuntimeControl()
            message.current_scenario.name = self.scenario.name
            message.current_scenario.parameter_values.update(self.scenario.parameter_values)
            self.rti.publish(Channel.control, message)
        elif message.HasField("start"):
            self.on_start()
            self.rti.state = Proto.RUNNING
        elif message.HasField("play"):
            self.on_play()
            self.rti.state = Proto.PLAYBACK
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
        elif message.HasField("stop"):
            self.on_reset_end_stop()
            self.on_end_stop()
            self.on_stop()
            if self.rti.state == Proto.PLAYBACK or self.rti.state == Proto.PLAYBACK_PAUSED or self.rti.state == Proto.PLAYBACK_STOPPED or self.rti.state == Proto.PLAYBACK_END:
                self.rti.state = Proto.PLAYBACK_STOPPED 
            else:
                self.rti.state = Proto.STOPPED
        elif message.HasField("set_time_scale"):
            self.time_scale = message.set_time_scale.time_scale
            self.on_time_scale(message.set_time_scale.time_scale)
        elif message.HasField("time_sync"):
            self.time_scale = message.time_sync.time_scale
            self.on_time_sync(message.time_sync)
        elif message.HasField("current_log"):
            self.current_log = message.current_log
        elif message.HasField("current_scenario"):
            self.scenario = message.current_scenario
