import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import unittest
import inhumate_rti as RTI
import time

class ClientBehaviorTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        rti = RTI.Client(application="python_test", station="station1")

        def on_error(channel, message, exception):
            print(f"Error: {channel}: {message}", file=sys.stderr)
        rti.on("error", on_error)

        rti.wait_until_connected()
        cls.rti = rti

        rti2 = RTI.Client("python-test-2")
        rti2.on("error", on_error)
        rti2.wait_until_connected()
        cls.rti2 = rti2
        rti2.request_clients()

        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.rti.disconnect()
        cls.rti2.disconnect()

    def test_connect_disconnect_works(self):
        rti = RTI.Client(application="python_test_temp")
        rti.wait_until_connected()
        self.assertTrue(rti.connected)

        rti.disconnect()
        count = 0
        while count < 50 and rti.connected: count += 1 ; time.sleep(0.01)
        self.assertFalse(rti.connected)


    def test_connect_disconnect_events_called(self):
        rti = RTI.Client(application="python_test_temp2")
        rti.wait_until_connected()
        self.assertTrue(rti.connected)
        self.disconnect_called = False
        def on_disconnect(): self.disconnect_called = True
        rti.on("disconnect", on_disconnect)
        rti.disconnect()

        count = 0
        while count < 50 and not self.disconnect_called: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.disconnect_called)

        self.connect_called = False
        self.connect_called2 = False
        def on_connect(): self.connect_called = True
        def on_connect2(): self.connect_called2 = True
        rti.on("connect", on_connect)
        rti.on("connect", on_connect2)
        rti.connect()
        rti.wait_until_connected()
        time.sleep(0.1)
        self.assertTrue(rti.connected)
        self.assertTrue(self.connect_called)
        self.assertTrue(self.connect_called2)


    def test_subscribe_callbackerror_errorevent_called(self):
        self.called = False
        def on_error(channel, message, exception): self.called = True
        self.rti.on("error", on_error)

        def on_message(content): raise Exception("foo")
        self.rti.subscribe_text("test", on_message)
        self.rti.publish_text("test", "foo")
        count = 0
        while count < 100 and not self.called: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.called)


    def test_publish_subscribe(self):
        self.received = False
        def on_runtime_control(message): self.received = True
        self.rti.subscribe("control-test", RTI.proto.RuntimeControl, on_runtime_control)
        message = RTI.proto.RuntimeControl()
        message.pause.SetInParent() # ~= message.pause = Empty()
        self.rti.publish("control-test", message)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)

    
    def test_two_subscribes(self):
        self.received = False
        self.received2 = False
        def on_runtime_control(message): self.received = True
        def on_runtime_control2(message): self.received2 = True
        self.rti.subscribe("control-test", RTI.proto.RuntimeControl, on_runtime_control)
        self.rti.subscribe("control-test", RTI.proto.RuntimeControl, on_runtime_control2)
        message = RTI.proto.RuntimeControl()
        message.pause.SetInParent() # ~= message.pause = Empty()
        self.rti.publish("control-test", message)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)
        self.assertTrue(self.received2)

    
    def test_unsubscribe_single_listener(self):
        self.received = False
        def on_runtime_control(message): self.received = True
        subscription = self.rti.subscribe("control-test", RTI.proto.RuntimeControl, on_runtime_control)
        message = RTI.proto.RuntimeControl()
        message.pause.SetInParent() # ~= message.pause = Empty()
        self.rti.publish("control-test", message)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)

        self.received2 = False
        def on_runtime_control2(message): self.received2 = True
        self.rti.subscribe("control-test", RTI.proto.RuntimeControl, on_runtime_control2)
        self.received = False
        self.rti.unsubscribe(subscription)
        self.rti.publish("control-test", message)
        time.sleep(0.1)
        self.assertFalse(self.received)
        self.assertTrue(self.received2)
    
    def test_publish_client_on_connect(self):
        # another client (rti2) connects. rti should know about it.
        count = 0
        while count < 100 and self.rti2.client_id not in self.rti.known_clients: count += 1 ; time.sleep(0.01)
        self.assertIsNotNone(self.rti.known_clients[self.rti2.client_id])

    
    def test_responds_to_client_request(self):
        # another client (rti2) requests clients. self.rti should respond.
        self.received = False
        def on_clients(message):
            if message.HasField("client") and message.client.id == self.rti.client_id: self.received = True
        self.rti2.subscribe(RTI.channel.clients, RTI.proto.Clients, on_clients)
        message = RTI.proto.Clients()
        message.request_clients.SetInParent()
        self.rti2.publish(RTI.channel.clients, message)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)


    def test_responds_to_channels_request(self):
        # another client (rti2) requests channels. self.rti should respond.
        received = False
        def on_channels(message):
            nonlocal received
            if message.HasField("channel_usage") and message.channel_usage.client_id == self.rti.client_id: received = True
        self.rti2.subscribe(RTI.channel.channels, RTI.proto.Channels, on_channels)
        message = RTI.proto.Channels()
        message.request_channel_usage.SetInParent()
        self.rti2.publish(RTI.channel.channels, message)
        count = 0
        while count < 100 and not received: count += 1 ; time.sleep(0.01)
        self.assertTrue(received)


    def test_set_state_publishes_client(self):
        received = False
        def on_clients(message):
            nonlocal received
            if message.HasField("client") and message.client.id == self.rti.client_id: received = True
        self.rti.subscribe(RTI.channel.clients, RTI.proto.Clients, on_clients)
        
        self.rti.state = RTI.proto.PLAYBACK
        
        count = 0
        while count < 100 and not received: count += 1 ; time.sleep(0.01)
        self.assertTrue(received)


    def test_publish_error(self):
        received = False
        def on_runtime_control(message):
            nonlocal received
            if message.HasField("error") and message.error.client_id == self.rti.client_id: received = True
        self.rti.subscribe(RTI.channel.control, RTI.proto.RuntimeControl, on_runtime_control)
        
        self.rti.publish_error("test")

        count = 0
        while count < 100 and not received: count += 1 ; time.sleep(0.01)
        self.assertTrue(received)


    def test_subscribe_before_connect(self):
        received = False
        rti3 = RTI.Client(application="python test 3", connect=False)
        def on_message(message):
            nonlocal received
            received = True
        rti3.subscribe_text("test", on_message)
        rti3.connect()
        count = 0
        while count < 100 and not rti3.connected: count += 1 ; time.sleep(0.01)
        self.assertTrue(rti3.connected)

        self.rti.publish_text("test", "well hello there")
        count = 0
        while count < 100 and not received: count += 1 ; time.sleep(0.01)
        self.assertTrue(received)

    def test_broker_version_is_set(self):
        time.sleep(0.1)
        self.assertIsNotNone(self.rti.broker_version)

    def test_pubsub_json(self):
        self.received = False
        def on_message(data): 
            if data["foo"] == "bar": self.received = True
        self.rti.subscribe_json("json", on_message)
        self.rti.publish_json("json", { "foo": "bar" })
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)

    def test_multichannel_subscriber(self):
        self.received = {}
        def on_message(channel, message):
            self.received[channel] = message
        self.rti.subscribe_text("channel1", on_message)
        self.rti.subscribe_text("channel2", on_message)
        self.rti.publish_text("channel1", "foo")
        self.rti.publish_text("channel2", "bar")
        count = 0
        while count < 100 and len(self.received.keys()) < 2: count += 1 ; time.sleep(0.01)
        self.assertEqual("foo", self.received["channel1"])
        self.assertEqual("bar", self.received["channel2"])

    def test_responds_to_measures_request(self):
        measure = RTI.proto.Measure()
        measure.id = "test"
        self.rti.register_measure(measure)
        # another client (rti2) requests measures. self.rti should respond.
        self.received = False
        def on_measures(message):
            if message.HasField("measure") and message.measure.id == measure.id: self.received = True
        self.rti2.subscribe(RTI.channel.measures, RTI.proto.Measures, on_measures)
        message = RTI.proto.Measures()
        message.request_measures.SetInParent()
        self.rti2.publish(RTI.channel.measures, message)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)
        self.rti.unregister_measure(measure.id)

    def test_measure_without_interval_publishes_instantly(self):
        self.received = False
        def on_measurement(measurement):
            self.assertAlmostEqual(42.0, measurement.value, 0.01)
            self.received = True
        self.rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, on_measurement)
        self.rti.measure("test", 42)
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)

    def test_measure_with_interval__one_measurement__publishes_value(self):
        measure = RTI.proto.Measure()
        measure.id = "interval"
        measure.interval = 1
        self.received = False

        def on_measurement(measurement):
            self.assertAlmostEqual(42.0, measurement.value, 0.01)
            self.received = True
        subscription = self.rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, on_measurement)
        
        # Measure
        self.rti.measure(measure, 42)

        # Should not be published until interval (1s) passes
        time.sleep(0.5)
        self.assertFalse(self.received)

        # Should be received after ~1s
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)
        self.rti.unsubscribe(subscription)

    def test_measure_with_interval__multiple_measurements__publishes_tumbling_window(self):
        measure = RTI.proto.Measure()
        measure.id = "window"
        measure.interval = 1
        self.received = False

        def on_measurement(measurement):
            self.assertEqual(3, measurement.window.count)
            self.assertAlmostEqual(42.0, measurement.window.mean, 0.01)
            self.assertAlmostEqual(44.0, measurement.window.max, 0.01)
            self.assertAlmostEqual(40.0, measurement.window.min, 0.01)
            self.received = True
        subscription = self.rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, on_measurement)

        # Make a few measurements
        self.rti.measure(measure, 42)
        self.rti.measure(measure, 44)
        self.rti.measure(measure, 40)

        # Should not be published until interval (1s) passes
        time.sleep(0.5)
        self.assertFalse(self.received)

        # Should be received after ~1s
        count = 0
        while count < 100 and not self.received: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received)
        self.rti.unsubscribe(subscription)

    def test_entity_measure_with_interval__multiple_measurements__publishes_tumbling_window(self):
        measure = RTI.proto.Measure()
        measure.id = "window"
        measure.interval = 1
        measure.entity = True
        self.received1 = False
        self.received2 = False

        def on_measurement(measurement):
            if measurement.entity_id == "entity1":
                self.assertEqual(2, measurement.window.count)
                self.assertAlmostEqual(43.0, measurement.window.mean, 0.01)
                self.received1 = True
            elif measurement.entity_id == "entity2":
                self.assertAlmostEqual(40.0, measurement.value, 0.01)
                self.received2 = True
        subscription = self.rti.subscribe(RTI.channel.measurement, RTI.proto.Measurement, on_measurement)

        # Make a few measurements
        self.rti.measure(measure, 42, "entity1")
        self.rti.measure(measure, 44, "entity1")
        self.rti.measure(measure, 40, "entity2")

        # Should not be published until interval (1s) passes
        time.sleep(0.5)
        self.assertFalse(self.received1 or self.received2)

        # Should be received after ~1s
        count = 0
        while count < 100 and not self.received1 and not self.received2: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.received1)
        self.assertTrue(self.received2)
        self.rti.unsubscribe(subscription)

    def test_participant_registration_for_station__sets_participant(self):
        message = RTI.proto.Clients()
        message.register_participant.participant = "mr.foo"
        message.register_participant.station = "station1"

        self.rti2.publish(RTI.channel.clients, message)
        count = 0
        while count < 100 and (not self.rti.participant or not self.rti.client_id in self.rti2.known_clients or not self.rti2.known_clients[self.rti.client_id].participant): count += 1 ; time.sleep(0.01)

        self.assertEqual("mr.foo", self.rti.participant)
        self.assertEqual("mr.foo", self.rti2.known_clients[self.rti.client_id].participant)

    def test_participant_registration_for_client__sets_participant(self):
        message = RTI.proto.Clients()
        message.register_participant.participant = "mr.foo"
        message.register_participant.client_id = self.rti.client_id

        self.rti2.publish(RTI.channel.clients, message)
        count = 0
        while count < 100 and (not self.rti.participant or not self.rti.client_id in self.rti2.known_clients or not self.rti2.known_clients[self.rti.client_id].participant): count += 1 ; time.sleep(0.01)

        self.assertEqual("mr.foo", self.rti.participant)
        self.assertEqual("mr.foo", self.rti2.known_clients[self.rti.client_id].participant)

    def test_verify_token__verifies_own_token(self):
        self.ok = False
        def handler(result):
            self.assertFalse("error" in result)
            self.assertEqual(self.rti.application, result["application"])
            self.ok = True
        self.rti.verify_token(self.rti.auth_token, handler)
        count = 0
        while count < 100 and not self.ok: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.ok)

    def test_verify_token__gets_error(self):
        self.ok = False
        def handler(result):
            self.assertTrue("error" in result)
            self.ok = True
        self.rti.verify_token("this will certainly fail", handler)
        count = 0
        while count < 100 and not self.ok: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.ok)

    def test_heartbeat_progress_value(self):
        self.rti.publish_heartbeat()
        time.sleep(0.01)
        self.rti.publish_value("foo", error=True)
        time.sleep(0.01)
        self.rti.publish_value(42)
        time.sleep(0.01)
        for i in range(10):
            self.rti.publish_progress((i+1)*10)
            time.sleep(0.01)
    
    def test_register_ephemeral_channel(self):
        channel = RTI.proto.Channel()
        channel.name = "ephy"
        channel.ephemeral = True
        channel.state = True
        channel.first_field_id = True
        channel.data_type = "Bitsnpieces"
        self.rti.register_channel(channel)
        time.sleep(0.1)
        channel2 = self.rti2.known_channels[channel.name]
        self.assertTrue(channel2.ephemeral)
        for i in range(100):
            time.sleep(0.1)
            self.rti.publish_text("ephy", "iffy")

    def test_register_state_channel_after_first_use(self):

        self.received = False
        self.state = False
        def on_message(message): 
            self.received = True
            self.state = self.rti2.known_channels["state"].state
        self.rti2.subscribe_text("state", on_message)

        self.rti.publish_text("state", "stuff")
        time.sleep(0.1)

        channel = RTI.proto.Channel()
        channel.name = "state"
        channel.state = True
        channel.data_type = "Bitsnpieces"
        self.rti.register_channel(channel)
        self.rti.publish_text("state", "stuff")
        time.sleep(0.1)
        
        channel2 = self.rti2.known_channels[channel.name]
        self.assertTrue(channel2.state)
        self.assertTrue(self.state)

    def test_client_with_main_loop(self):
        count = 0
        rtiml = None
        def main_loop():
            nonlocal count, rtiml
            count += 1
            if count >= 3: rtiml.disconnect()

        rtiml = RTI.Client("python_test_main_loop", main_loop=main_loop, main_loop_idle_time=0.1, connect=False)
        rtiml.connect()
        self.assertTrue(count == 3)

    def test_brokerrpc_invoke(self):
        self.ok = False
        def handle(result):
            self.ok = True
            self.assertEqual("hello", result)
        self.rti.invoke("echo", "hello", handle)
        count = 0
        while count < 100 and not self.ok: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.ok)

    def test_brokerrpc_specific_error(self):
        self.ok = False
        def handle(result): pass
        def handle_error(error):
            self.ok = True
            self.assertEqual("error hello", error)
        self.rti.invoke("echo", "error hello", handle, handle_error)
        count = 0
        while count < 100 and not self.ok: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.ok)

    def test_brokerrpc_generic_error(self):
        self.ok = False
        def handle(result): pass
        def handle_error(channel, error, exception):
            if channel.startswith("rpc"):
                self.ok = True
                self.assertEqual("error hello", error)
        self.rti.on("error", handle_error)
        self.rti.invoke("echo", "error hello", handle)
        count = 0
        while count < 100 and not self.ok: count += 1 ; time.sleep(0.01)
        self.assertTrue(self.ok)
        
    def test_publish_before_connect(self):
        temprti = RTI.Client("python_test_temp", connect=False)
        try:
            temprti.publish_text("foo", "bar")
        except Exception as e:
            self.assertTrue("connected" in str(e))
        
