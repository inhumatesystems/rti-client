from .rtisocketclusterclient import RTISocketClusterClient
from emitter import Emitter

from uuid import uuid4
from threading import Thread, Lock
from . import proto as Proto, constants as Constants, channel as Channel, __version__
import os
from google.protobuf import message as _message
import base64
import traceback
import time
import socket as sock
import json
import re
import sys
from inspect import signature
from typing import List, Optional, Type, Union, Callable


class RTIClient(Emitter):

    @property
    def state(self):
        return self._state

    @state.setter
    def state(self, state):
        if state != self._state:
            self._state = state
            if self.connected and not self.incognito:
                self._publish_client()

    @property
    def own_channel_prefix(self):
        return f"@{self.client_id}:"

    @property
    def auth_token(self):
        return self.socket.auth_token

    def __init__(self, application: str = "Python",
                 application_version: Optional[str] = None, engine_version: Optional[str] = None,
                 integration_version: Optional[str] = None, client_id: Optional[str] = None,
                 federation: Optional[str] = None, host: Optional[str] = None, station: Optional[str] = None,
                 secret: Optional[str] = None, user: Optional[str] = None, participant: Optional[str] = None,
                 role: Optional[str] = None, full_name: Optional[str] = None, capabilities: Optional[List[str]] = [],
                 password: Optional[str] = None, incognito: bool = False, connect: bool = True,
                 wait: bool = False, main_loop: Callable = None, main_loop_idle_time: float = 0.01):
        super().__init__()
        self.measurement_interval_time_scale = 1

        self.subscriptions = {}
        self.known_channels = {}
        self.used_channels = {}
        self.known_clients = {}
        self.used_measures = {}
        self.known_measures = {}

        self._state = Proto.UNKNOWN
        self.first_connected = False
        self.connected = False
        self.broker_version = None
        self._connection_error = None

        self.create_rti_thread = main_loop is None

        url = None
        if not url:
            url = os.environ.get('RTI_URL')
        if not url:
            url = Constants.default_url
        if not url.startswith("ws://") and not url.startswith("wss://"): 
            if url.startswith("localhost") or url.startswith("127."):
                url = f"ws://{url}"
            else:
                url = f"wss://{url}"
        self.url = url

        self.application = application
        self.application_version = application_version
        if engine_version is None:
            self.engine_version = "Python " + sys.version.replace("\n", "")
        else:
            self.engine_version = engine_version
        self.integration_version = integration_version
        self.client_id = client_id
        if not self.client_id:
            self.client_id = str(uuid4())
        self.federation = federation
        if not self.federation:
            self.federation = os.environ.get('RTI_FEDERATION')
        if self.federation:
            # slashes quietly not allowed in federation id
            self.federation = self.federation.replace("/", "_")

        auth_secret = None
        if not auth_secret:
            auth_secret = os.environ.get('RTI_SECRET')
        if not auth_secret:
            auth_secret = secret
        self.user = user

        self._host = host
        if not self._host:
            self._host = os.environ.get('RTI_HOST')
        if not self._host:
            self._host = sock.gethostname()
            if self._host and "." in self._host: self._host = self._host.split(".")[0]
        self._station = station
        if not self._station:
            self._station = os.environ.get('RTI_STATION')
        self.participant = participant
        self.role = role
        self.full_name = full_name
        self.capabilities = capabilities

        self.incognito = incognito

        auth_token = {
            'application': self.application,
            'clientId': self.client_id,
            'clientLibraryVersion': __version__
        }
        if auth_secret:
            auth_token['secret'] = auth_secret
        if user:
            auth_token['user'] = user
        if password:
            auth_token['password'] = password
        if self.federation:
            auth_token['federation'] = self.federation
        self._auth_token_data = auth_token

        socket = RTISocketClusterClient(url, main_loop, main_loop_idle_time)

        def on_clients(message: Proto.Clients):
            if message.HasField("request_clients") and not self.incognito:
                self._publish_client()
            elif message.HasField("client"):
                self.known_clients[message.client.id] = message.client
            elif message.HasField("register_participant"):
                reg = message.register_participant
                if (reg.client_id == self.client_id or not reg.client_id) and (reg.host == self._host or not reg.host) and (reg.station == self._station or not reg.station) and (reg.participant != self.participant or reg.role != self.role):
                    self.participant = reg.participant
                    self.role = reg.role
                    self.full_name = reg.full_name
                    self._publish_client()

        def on_channels(message: Proto.Channels):
            if message.HasField("request_channel_usage"):
                message = Proto.Channels()
                message.channel_usage.client_id = self.client_id
                message.channel_usage.usage.extend(self.used_channels.values())
                if not self.incognito:
                    self.publish(Channel.channels, message)
            elif message.HasField("channel_usage"):
                for use in message.channel_usage.usage:
                    self._discover_channel(use.channel)
            elif message.HasField("channel"):
                self._discover_channel(message.channel)

        def on_measures(message: Proto.Measures):
            if message.HasField("request_measures") and not self.incognito:
                self._publish_measures()
            elif message.HasField("measure"):
                self.known_measures[message.measure.id] = message.measure

        socket.set_basic_listener(self.__on_connect, self.__on_disconnect, self.__on_connection_error)
        socket.set_auth_listener(self.__on_set_auth, self.__on_auth)
        socket.on("fail", self.__on_fail)
        socket.on("broker-version", self.__on_broker_version)
        socket.on("ping", self.__on_ping)
        self.socket = socket
        self.thread = None
        self.collect_measurements_thread = None
        self.collect_lock = Lock()
        self.collect_queue = {}
        self.last_collect = {}

        self.subscribe(Channel.clients, Proto.Clients, on_clients)
        self.subscribe(Channel.channels, Proto.Channels, on_channels)
        self.subscribe(Channel.measures, Proto.Measures, on_measures)

        if connect:
            self.connect()
            if wait:
                self.wait_until_connected()

        # socketcluster python client provides no event emit for #removeAuthToken when token expires...
        # so let's spawn a thread and check for it
        def check_auth():
            while True:
                time.sleep(1)
                if self.connected and self.socket.auth_token is None:
                    self.socket.transmit("auth", self._auth_token_data)
        self.check_auth_thread = Thread(target=check_auth)
        self.check_auth_thread.daemon = True
        self.check_auth_thread.start()

    def __on_connect(self, socket):
        # self.connected and emit "connect" event is done in __on_set_auth (after client handshake)
        self._connection_error = None

    def __on_disconnect(self, socket):
        if self.connected:
            self.connected = False
            self.emit("disconnect")

    def __on_connection_error(self, socket, error):
        self.emit("error", "connection", error, None)
        self._connection_error = error

    def __on_set_auth(self, socket, token):
        socket.set_auth_token(token)
        for channel_name in self.subscriptions:
            socket.subscribe(channel_name)
        if not self.connected:
            first = not self.first_connected
            self.first_connected = True
            self.connected = True
            if not self.incognito:
                self._publish_client()
                self._publish_measures()
            if first: self.emit("firstconnect")
            self.emit("connect")

    def __on_auth(self, socket, is_authenticated):
        socket.transmit("auth", self._auth_token_data)

    def __on_fail(self, socket, error):
        self.emit("error", "fail", error, None)
        self._connection_error = error

    def __on_broker_version(self, channel: str, content: str):
        self.broker_version = content

    def __on_ping(self, channel: str, content: str):
        self.socket.transmit("pong", content)

    def get_clients_by_application(self, application: str):
        return list(filter(lambda c: c.application.lower() == application.lower(), self.known_clients.values()))

    def connect(self):
        self._connection_error = None
        if self.create_rti_thread:
            self.thread = Thread(target=self.socket.connect)
            self.thread.daemon = True
            self.thread.start()
        else:
            self.socket.connect()

    def disconnect(self):
        self.socket.disconnect()
        self.first_connected = False
        if self.connected:
            self.connected = False
            self.emit("disconnect")

    def wait_until_connected(self):
        count = 0
        while count < 500 and not self.connected and not self._connection_error:
            count += 1
            time.sleep(0.01)
        if not self.connected:
            if self._connection_error:
                raise Exception(f"Connection failed: {self._connection_error}")
            else:
                raise Exception("Connection timeout")

    def verify_token(self, token: str, handler: Callable[[dict], None]):
        self.invoke("verifytoken", token, handler)
        
    def transmit(self, event: str, data = None):
        self.socket.transmit(event, data)

    def invoke(self, method: str, data, handler, error_handler = None):
        def invoke_handler(method, error, data):
            if error:
                if error_handler:
                    error_handler(error)
                else:
                    self.emit("error", f"rpc:{method}", error, None)
            elif handler:
                handler(data)
        self.socket.transmit(method, data, invoke_handler)

    def subscribe(self, channel_name: str, message_class: Type[_message.Message], handler: Callable, register: bool = True):
        def handle_message(content):
            message = self.parse(message_class, content)
            if len(signature(handler).parameters) < 2:
                handler(message)
            else:
                handler(channel_name, message)
        return self.subscribe_text(channel_name, handle_message, register, str(message_class))

    @classmethod
    def parse(cls, message_class, content):
        message = message_class()
        message.ParseFromString(base64.b64decode(content))
        return message

    def subscribe_json(self, channel_name: str, handler: Union[Callable[[str, dict], None], Callable[[dict], None]], register=True):
        def handle_message(content):
            if len(signature(handler).parameters) < 2:
                handler(json.loads(content))
            else:
                handler(channel_name, json.loads(content))
        return self.subscribe_text(channel_name, handle_message, register, "json")

    def subscribe_text(self, channel_name: str, handler: Union[Callable[[str, str], None], Callable[[str], None]], register: bool = True, data_type: str = "text"):
        socket_channel_name = channel_name
        if self.federation:
            socket_channel_name = "//" + self.federation + "/" + channel_name
        if (socket_channel_name not in self.subscriptions):
            if self.connected:
                self.socket.subscribe(socket_channel_name)
            self.subscriptions[socket_channel_name] = []
            if register:
                self._register_channel_usage(channel_name, False, data_type)

            def handle_message(in_channel_name, content):
                for listener in self.subscriptions[socket_channel_name]:
                    try:
                        if len(signature(listener).parameters) < 2:
                            listener(content)
                        else:
                            listener(channel_name, content)
                    except Exception as e:
                        self.emit("error", channel_name, e,
                                  traceback.format_exc())
            self.socket.on_channel(socket_channel_name, handle_message)

        self.subscriptions[socket_channel_name].append(handler)
        return handler

    def unsubscribe(self, channel_name_or_handler: Union[str, Callable[[str], None]]) -> None:
        if channel_name_or_handler is str:
            if self.federation:
                channel_name_or_handler = "//" + self.federation + "/" + channel_name_or_handler
            self.socket.unsubscribe(channel_name_or_handler)
            if channel_name_or_handler in self.subscriptions:
                del self.subscriptions[channel_name_or_handler]
        else:
            for channel_name in self.subscriptions:
                if channel_name_or_handler in self.subscriptions[channel_name]:
                    self.subscriptions[channel_name].remove(
                        channel_name_or_handler)
                    if len(self.subscriptions[channel_name]) <= 0:
                        self.socket.unsubscribe(channel_name)
                        del self.subscriptions[channel_name]
                        break

    def publish(self, channel_name: str, message: _message.Message) -> None:
        self._register_channel_usage(
            channel_name, True, data_type=str(type(message)))
        content = base64.b64encode(
            message.SerializeToString()).decode("utf8")
        if self.federation and not channel_name.startswith("@"):
            channel_name = "//" + self.federation + "/" + channel_name
        self.socket.publish(channel_name, content)

    def publish_text(self, channel_name: str, content: str) -> None:
        self._register_channel_usage(channel_name, True, data_type="text")
        if self.federation and not channel_name.startswith("@"):
            channel_name = "//" + self.federation + "/" + channel_name
        self.socket.publish(channel_name, content)

    def publish_json(self, channel_name: str, message: object) -> None:
        self._register_channel_usage(channel_name, True, data_type="json")
        if self.federation and not channel_name.startswith("@"):
            channel_name = "//" + self.federation + "/" + channel_name
        self.socket.publish(channel_name, json.dumps(message))

    def publish_error(self, error_message: str, runtime_state: Proto.RuntimeState = None) -> None:
        message = Proto.RuntimeControl()
        message.error.client_id = self.client_id
        message.error.message = str(error_message)
        if runtime_state is not None:
            message.error.state = runtime_state
        self.publish(Channel.control, message)

    def publish_heartbeat(self) -> None:
        message = Proto.Clients()
        message.heartbeat.client_id = self.client_id
        self.publish(Channel.clients, message)

    def publish_progress(self, progress: int) -> None:
        message = Proto.Clients()
        message.progress.client_id = self.client_id
        message.progress.progress = int(progress)
        self.publish(Channel.clients, message)

    def publish_value(self, value: Union[int, float, str], highlight: bool = False, error: bool = False) -> None:
        message = Proto.Clients()
        message.value.client_id = self.client_id
        message.value.value = str(value)
        message.value.highlight = highlight
        message.value.error = error
        self.publish(Channel.clients, message)

    def request_clients(self):
        message = Proto.Clients()
        message.request_clients.SetInParent()
        self.publish(Channel.clients, message)

    def _publish_client(self):
        message = Proto.Clients()
        message.client.id = self.client_id
        message.client.application = self.application
        message.client.state = self._state
        message.client.client_library_version = __version__
        if self.application_version:
            message.client.application_version = self.application_version
        if self.engine_version:
            message.client.engine_version = self.engine_version
        if self.integration_version:
            message.client.integration_version = self.integration_version
        if self._host:
            message.client.host = self._host
        if self._station:
            message.client.station = self._station
        if self.user:
            message.client.user = self.user
        if self.participant:
            message.client.participant = self.participant
        if self.role:
            message.client.role = self.role
        if self.full_name:
            message.client.full_name = self.full_name
        for capability in self.capabilities:
            message.client.capabilities.append(capability)
        self.publish(Channel.clients, message)

    def _publish_measures(self):
        for measure in self.used_measures.values():
            message = Proto.Measures()
            message.measure.CopyFrom(measure)
            self.publish(Channel.measures, message)

    def _discover_channel(self, channel):
        if channel.name not in self.known_channels:
            self.known_channels[channel.name] = channel
        else:
            known = self.known_channels[channel.name]
            if channel.data_type and not known.data_type:
                known.data_type = channel.data_type
            if channel.ephemeral:
                known.ephemeral = True
            if channel.state:
                known.state = True
            if channel.first_field_id:
                known.first_field_id = True

    def _register_channel_usage(self, channel_name, use_publish, data_type=None):
        if channel_name.startswith("@"):
            return
        channel = self.known_channels.get(channel_name)
        if channel is None:
            channel = Proto.Channel()
            channel.name = channel_name
            data_type = re.sub("<class.*_pb2\\.", "", data_type)
            data_type = re.sub("'>", "", data_type)
            channel.data_type = data_type
        use = None
        if channel.name not in self.used_channels:
            use = Proto.ChannelUse()
            use.channel.CopyFrom(channel)
            self.used_channels[channel.name] = use
        else:
            use = self.used_channels[channel.name]
        if use_publish:
            use.publish = True
        else:
            use.subscribe = True
        if channel.name not in self.known_channels:
            self.register_channel(channel)

    def request_channels(self):
        message = Proto.Channels()
        message.request_channel_usage.SetInParent()
        self.publish(Channel.channels, message)

    def register_channel(self, channel: Proto.Channel) -> None:
        if channel.name.startswith("@"):
            return
        self.known_channels[channel.name] = channel

        if channel.name not in self.used_channels:
            self.used_channels[channel.name] = Proto.ChannelUse()
        use = self.used_channels[channel.name]
        use.channel.CopyFrom(channel)

        if self.connected and not self.incognito:
            message = Proto.Channels()
            message.channel.CopyFrom(channel)
            self.publish(Channel.channels, message)

    def unregister_channel(self, channel_name: str) -> None:
        if channel_name in self.known_channels:
            del(self.known_channels[channel_name])
        if channel_name in self.used_channels:
            del(self.used_channels[channel_name])

    def request_measures(self):
        message = Proto.Measures()
        message.request_measures.SetInParent()
        self.publish(Channel.measures, message)

    def register_measure(self, measure: Proto.Measure) -> None:
        measure.application = self.application
        self.used_measures[measure.id] = measure
        if measure.id not in self.known_measures:
            self.known_measures[measure.id] = measure
            if self.connected and not self.incognito:
                message = Proto.Measures()
                message.measure.CopyFrom(measure)
                self.publish(Channel.measures, message)

    def measure(self, measure_id: Union[str, Proto.Measure], value: float) -> None:
        measure = None
        if type(measure_id) is str:
            measure = self.used_measures.get(measure_id)
            if not measure:
                measure = self.known_measures.get(measure_id)
            if not measure:
                measure = Proto.Measure()
                measure.id = measure_id
                measure.application = self.application
        else:
            measure = measure_id

        if measure.id not in self.used_measures:
            self.register_measure(measure)
        if measure.interval > 1e-5:
            if not self.collect_measurements_thread:
                self.collect_measurements_thread = Thread(
                    target=self._collect_measurements_thread_func)
                self.collect_measurements_thread.daemon = True
                self.collect_measurements_thread.start()
            with self.collect_lock:
                if measure.id not in self.collect_queue:
                    self.collect_queue[measure.id] = []
                self.collect_queue[measure.id].append(value)
        else:
            measurement = Proto.Measurement()
            measurement.measure_id = measure.id
            measurement.client_id = self.client_id
            measurement.value = value
            channel = measure.channel if measure.channel else Channel.measurement
            if self.connected:
                self.publish(channel, measurement)

    def _collect_measurements_thread_func(self):
        while self.connected:
            time.sleep(0.1)
            with self.collect_lock:
                for measure_id, values in self.collect_queue.items():
                    if measure_id not in self.last_collect:
                        self.last_collect[measure_id] = time.time()
                    else:
                        measure = self.known_measures[measure_id]
                        if (time.time() - self.last_collect[measure_id]) * self.measurement_interval_time_scale > measure.interval:
                            channel = measure.channel if measure.channel else Channel.measurement
                            measurement = Proto.Measurement()
                            measurement.measure_id = measure.id
                            measurement.client_id = self.client_id
                            if len(values) == 1:
                                measurement.value = values.pop()
                                self.publish(channel, measurement)
                            elif len(values) > 1:
                                window = Proto.Measurement.Window()
                                window.max = -float("inf")
                                window.min = float("inf")
                                while len(values) > 0:
                                    value = values.pop()
                                    window.count += 1
                                    window.mean += value
                                    if value > window.max:
                                        window.max = value
                                    if value < window.min:
                                        window.min = value
                                if window.count > 0:
                                    window.mean /= window.count
                                window.duration = (
                                    time.time() - self.last_collect[measure_id]) * self.measurement_interval_time_scale
                                measurement.window.CopyFrom(window)
                                self.publish(channel, measurement)
                            self.last_collect[measure_id] = time.time()

    def execute_command(self, name: str, client_id: str = None, entity_id: str = None, transaction_id: str = None, wait: bool = False, timeout: float = 5, **kwargs):
        message = Proto.Commands()
        if wait and not transaction_id:
            transaction_id = str(uuid4())
        if transaction_id:
            message.execute.transaction_id = transaction_id
        message.execute.name = name
        for key, value in kwargs.items():
            message.execute.arguments[key] = str(value)
        subscription = None
        channel = Channel.commands
        if entity_id:
            channel += f"/{entity_id}"
        if client_id:
            channel = f"@{client_id}:{channel}"
        if wait:
            response = None

            def on_command(msg: Proto.Channels):
                nonlocal response
                if msg.HasField("response") and msg.response.transaction_id == transaction_id:
                    response = msg.response
            subscription = self.subscribe(channel, Proto.Commands, on_command)
            self.publish(channel, message)
            start_time = time.time()
            while not response and time.time() - start_time < timeout:
                time.sleep(0.01)
            self.unsubscribe(subscription)
            return response
        else:
            self.publish(channel, message)


