import os
import sys

sys.path.insert(0, os.path.dirname(__file__) + "/..")

from inhumate_rti.rtisocketclusterclient import RTISocketClusterClient


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.closed = False
        self.close_status = None
        self.close_reason = None

    def send(self, message):
        self.sent.append(message)

    def close(self, status=None, reason=None):
        self.closed = True
        self.close_status = status
        self.close_reason = reason


def test_malformed_json_reports_protocol_error_and_receiver_continues():
    client = RTISocketClusterClient("ws://example", None, 0.01)
    ws = FakeWebSocket()
    client.ws = ws
    errors = []
    received = []
    client.set_basic_listener(None, None, lambda _socket, error: errors.append(error))
    client.on_channel("test", lambda _channel, data: received.append(data))

    client.on_message(ws, "{not json}")
    client.on_message(ws, '{"event":"#publish","data":{"channel":"test","data":"ok"}}')

    assert errors
    assert received == ["ok"]


def test_oversized_message_reports_error_and_closes_socket():
    client = RTISocketClusterClient("ws://example", None, 0.01, max_message_size_bytes=8)
    ws = FakeWebSocket()
    client.ws = ws
    errors = []
    client.set_basic_listener(None, None, lambda _socket, error: errors.append(error))

    client.on_message(ws, '{"event":"too-large"}')

    assert errors
    assert ws.closed
    assert ws.close_status == 1009
