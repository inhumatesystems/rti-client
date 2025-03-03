# Inhumate RTI python client

# Inspired by: 
#   The official python socket cluster - unmaintained and using ancient websocket client with threading problems
#   https://github.com/sacOO7/socketcluster-client-python
#
#   A slightly improved version but still ancient and unmaintained:
#   https://github.com/ramazanpolat/socketcc


import json
from threading import Timer, Thread
from typing import Callable, Any
from enum import Enum, auto
import websocket
import select
import time


class EventEnum(Enum):
    PUBLISH = auto()
    REMOVE_AUTH_TOKEN = auto()
    SET_AUTH_TOKEN = auto()
    EVENT_CID = auto()
    AUTHENTICATED = auto()
    GOT_ACK = auto()


class MainLoopDispatcher:
    def __init__(self, web_socket_app, main_loop, idle_time):
        self.idle_time = idle_time
        self.main_loop = main_loop
        self.web_socket_app = web_socket_app
        self.idle = 0
        self.called = 0
        self.done = False
        self.done_exception = None

    def read(self, sock, read_callback):
        while not self.done:
            try:
                if sock.fileno() >= 0:
                    read_sockets, _, _ = select.select([sock], [], [], self._timeout())
                    if read_sockets: read_callback()
                else:
                    break
                self.idle = time.time() - self.called
                if self.idle >= self.idle_time:
                    self._call_main_loop()
                elif self.idle > 0.01 and self.idle_time > 0.005:
                    time.sleep(0.01)
            except (KeyboardInterrupt, SystemExit) as e:
                self.done = True
                self.done_exception = e

    def delay(self, delay_time):
        end_time = time.time() + delay_time
        while not self.done and time.time() < end_time:
            self.idle = time.time() - self.called
            if self.idle >= self.idle_time:
                self._call_main_loop()
            time.sleep(0.01)


    def signal(self, a, b):
        # print(f"signal {a} {b}")
        # b()
        pass

    def abort(self):
        print(f"abort")
        self.done = True

    def _timeout(self):
        if self.idle_time <= 0:
            return 0

        t = (self.called + self.idle_time) - time.time()
        if t <= 0:
            return 0

        return t

    def _call_main_loop(self):
        self.called = time.time()
        self.idle = 0
        self.main_loop()

class RTISocketClusterClient:
    def __init__(self, url, main_loop, idle_time):
        self.url = url
        self.main_loop = main_loop
        self.idle_time = idle_time
        self.map = {}
        self.map_ack = {}
        self.id = ""
        self.count = 0
        self.auth_token = None
        self.acks = {}
        self.channels = []
        self.enable_reconnect = True
        self.reconnect_delay = 3
        self.ws = None
        self.on_connected = self.on_disconnected = self.on_connect_error = self.on_set_auth = self.on_auth = None
        self.ever_connected = False

    @staticmethod
    def parse2(rid, event) -> EventEnum:
        if event != "":
            if event == "#publish":
                return EventEnum.PUBLISH
            elif event == "#removeAuthToken":
                return EventEnum.REMOVE_AUTH_TOKEN
            elif event == "#setAuthToken":
                return EventEnum.SET_AUTH_TOKEN
            else:
                return EventEnum.EVENT_CID
        elif rid == 1:
            return EventEnum.AUTHENTICATED
        else:
            return EventEnum.GOT_ACK

    def on(self, key, func):
        self.map[key] = func

    def off(self, key):
        if key in self.map: del self.map[key]

    def on_channel(self, key, func):
        self.map[key] = func

    def on_ack(self, key, func):
        self.map_ack[key] = func

    def execute(self, key, obj):
        if key in self.map:
            func = self.map[key]
            if func is not None:
                func(key, obj)

    def has_event_ack(self, key):
        return key in self.map_ack

    def execute_ack(self, key, obj, ack):
        if key in self.map_ack:
            func = self.map_ack[key]
            if func is not None:
                func(key, obj, ack)

    def transmit(self, event, obj, ack=None):
        emit_obj = {"event": event, "data": obj}
        if ack:
            emit_obj['cid'] = self.get_and_increment()
        self.ws.send(json.dumps(emit_obj, sort_keys=True))
        if ack:
            self.acks[self.count] = [event, ack]
        # logging.info("Emit data is " + json.dumps(emit_obj, sort_keys=True))

    def sub(self, channel):
        self.ws.send(
            "{\"event\":\"#subscribe\",\"data\":{\"channel\":\"" + channel + "\"},\"cid\":" + str(
                self.get_and_increment()) + "}")

    def subscribe(self, channel, ack=None):
        obj = {"channel": channel}
        sub_obj = {"event": "#subscribe", "data": obj, "cid": self.get_and_increment()}
        self.ws.send(json.dumps(sub_obj, sort_keys=True))
        if channel not in self.channels: self.channels.append(channel)
        if ack:
            self.acks[self.count] = [channel, ack]

    def unsubscribe(self, channel, ack=None):
        sub_obj = {"event": "#unsubscribe", "data": channel, "cid": self.get_and_increment()}
        self.ws.send(json.dumps(sub_obj, sort_keys=True))
        if channel in self.channels: self.channels.remove(channel)
        if ack:
            self.acks[self.count] = [channel, ack]

    def publish(self, channel, data, ack=None):
        if not self.ws or not self.ever_connected: 
            raise Exception("Cannot publish before connected")
        obj = {"channel": channel, "data": data}
        pub_obj = {"event": "#publish", "data": obj, "cid": self.get_and_increment()}
        self.ws.send(json.dumps(pub_obj, sort_keys=True))
        if ack:
            self.acks[self.count] = [channel, ack]

    def subscribe_channels(self):
        for channel in self.channels:
            self.sub(channel)

    def ack(self, cid):
        ws = self.ws

        def message_ack(error, data):
            ack_object = {"error": error, "data": data, "rid": cid}
            ws.send(json.dumps(ack_object, sort_keys=True))

        return message_ack

    class BlankDict(dict):
        def __missing__(self, key):
            return ''

    def on_message(self, ws, message):
        if message == "#1":
            self.ws.send("#2")
        elif message == "":
            self.ws.send("")
        else:
            main_obj = json.loads(message, object_hook=self.BlankDict)
            data_obj = main_obj["data"]
            rid = main_obj["rid"]
            cid = main_obj["cid"]
            event = main_obj["event"]

            result = self.parse2(rid, event)
            if result == EventEnum.AUTHENTICATED:
                if self.on_auth is not None:
                    self.id = data_obj["id"]
                    self.on_auth(self, data_obj["isAuthenticated"])
                self.subscribe_channels()
            elif result == EventEnum.PUBLISH:
                self.execute(data_obj["channel"], data_obj["data"])
            elif result == EventEnum.REMOVE_AUTH_TOKEN:
                self.auth_token = None
            elif result == EventEnum.SET_AUTH_TOKEN:
                if self.on_set_auth is not None:
                    self.on_set_auth(self, data_obj["token"])
            elif result == EventEnum.EVENT_CID:
                if self.has_event_ack(event):
                    self.execute_ack(event, data_obj, self.ack(cid))
                else:
                    self.execute(event, data_obj)
            else:
                if rid in self.acks:
                    tup = self.acks[rid]
                    if tup is not None:
                        ack = tup[1]
                        ack(tup[0], main_obj["error"], main_obj["data"])

    def on_open(self, ws):
        self.reset_count()
        self.ever_connected = True
        
        if self.on_connected is not None:
            self.on_connected(self)

        obj = {"authToken": self.auth_token}
        handshake_obj = {"event": "#handshake", "data": obj, "cid": self.get_and_increment()}
        self.ws.send(json.dumps(handshake_obj, sort_keys=True))

    def on_close(self, ws, status_code, message):
        if self.on_disconnected is not None:
            self.on_disconnected(self)
        if self.enable_reconnect:
            Timer(self.reconnect_delay, self.connect).start()

    def on_error(self, ws, error):
        if self.on_connect_error is not None:
            self.on_connect_error(self, error)
            # self.reconnect()

    def get_and_increment(self):
        self.count += 1
        return self.count

    def reset_count(self):
        self.count = 0

    def set_auth_token(self, token):
        self.auth_token = str(token)

    def connect_thread(self, sslopt=None, http_proxy_host=None, http_proxy_port=None, enable_trace=False):
        t = Thread(target=self.connect, args=(sslopt, http_proxy_host, http_proxy_port, enable_trace))
        t.daemon = True
        t.start()

    def connect(self, sslopt=None, http_proxy_host=None, http_proxy_port=None, enable_trace=False):
        websocket.enableTrace(enable_trace)
        if self.ws and self.ever_connected and self.main_loop:
            # reconnect will be handled by dispatcher
            return
        try:
            self.ws = websocket.WebSocketApp(self.url, on_message=self.on_message, on_error=self.on_error, on_close=self.on_close)
            self.ws.on_open = self.on_open
            if not self.ever_connected and self.main_loop:
                dispatcher = MainLoopDispatcher(self.ws, self.main_loop, self.idle_time)
                while not dispatcher.done:
                    try:
                        self.ws.run_forever(sslopt=sslopt, http_proxy_host=http_proxy_host, http_proxy_port=http_proxy_port, dispatcher=dispatcher)
                    except websocket.WebSocketException as e:
                        if "already opened" in str(e):
                            self.ws.close()
                            pass
                        else:
                            raise
                    if dispatcher.done and dispatcher.done_exception:
                        raise dispatcher.done_exception
                    if not self.enable_reconnect and not dispatcher.done:
                        dispatcher.done = True
                    else:
                        dispatcher.delay(self.reconnect_delay)
            else:
                self.ws.run_forever(sslopt=sslopt, http_proxy_host=http_proxy_host, http_proxy_port=http_proxy_port)
        except (KeyboardInterrupt, SystemExit):
            raise

    def set_basic_listener(self, connected_cb, disconnected_cb, connect_error_cb):
        self.on_connected = connected_cb
        self.on_disconnected = disconnected_cb
        self.on_connect_error = connect_error_cb

    def set_delay(self, reconnect_delay):
        self.reconnect_delay = reconnect_delay

    def set_reconnection(self, enable):
        self.enable_reconnect = enable

    def set_auth_listener(self, set_auth_cb, on_auth_cb):
        self.on_set_auth = set_auth_cb
        self.on_auth = on_auth_cb

    def disconnect(self):
        self.enable_reconnect = False
        self.ws.close()

    emit_ack = transmit
    subscribe_ack = subscribe
    publish_ack = publish
    unsubscribe_ack = unsubscribe