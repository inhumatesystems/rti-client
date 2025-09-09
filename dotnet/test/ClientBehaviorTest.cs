using NUnit.Framework;
using System;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
using Inhumate.RTI.Proto;

namespace Inhumate.RTI {
    public class ClientBehaviorTest {

        protected static RTIClient rti;
        protected static RTIClient rti2;

        public class TestException : Exception { }

        [OneTimeSetUp]
        public static void Setup() {
            // CI runs of these tests have a tendency to be quite fragile... this is an attempt to remedy that.
            Connect1();
            Connect2();
            Thread.Sleep(1000);
        }

        private static void Connect1() {
            rti = new RTIClient { Application = "C# IntegrationTest", Host = "Host1", Station = "Station1", Capabilities = { RTICapability.RuntimeControl } };
            rti.OnError += (channelName, exception) => {
                if (!(exception is TestException)) Console.Error.WriteLine($"Error: {channelName}: {exception}");
            };
            rti.WaitUntilConnected();
        }

        private static void Connect2() {
            rti2 = new RTIClient { Application = "C# IntegrationTest 2" };
            rti2.OnError += (channelName, exception) => {
                if (!(exception is TestException)) Console.Error.WriteLine($"Error: {channelName}: {exception}");
            };
            rti2.WaitUntilConnected();
        }

        [OneTimeTearDown]
        public static void Teardown() {
            if (rti != null) rti.Disconnect();
            if (rti2 != null) rti2.Disconnect();
            Thread.Sleep(100);
        }

        [Test]
        public void Connect_Disconnect_Works() {
            var temprti = new RTIClient { Application = "C# IntegrationTest Temp" };
            temprti.WaitUntilConnected();
            Assert.IsTrue(temprti.IsConnected);
            temprti.Disconnect();
            int count = 0;
            while (temprti.IsConnected && count++ < 50) Thread.Sleep(10);
            Assert.IsFalse(temprti.IsConnected);
        }

        [Test]
        public void Connect_Disconnect_Events_Called() {
            var temprti = new RTIClient { Application = "C# IntegrationTest Temp2" };
            temprti.WaitUntilConnected();
            Assert.IsTrue(temprti.IsConnected);
            bool disconnectCalled = false;
            temprti.OnDisconnected += () => { disconnectCalled = true; };
            temprti.Disconnect();
            int count = 0;
            while (!disconnectCalled && count++ < 50) Thread.Sleep(10);
            Assert.IsTrue(disconnectCalled);
            Thread.Sleep(100);

            bool connectCalled = false;
            temprti.OnConnected += () => { connectCalled = true; };
            temprti.Connect();
            temprti.WaitUntilConnected();
            Assert.IsTrue(connectCalled);
        }

        [Test]
        public void Subscribe_CallbackError_ErrorEvent_Called() {
            bool called = false;
            rti.OnError += (channel, error) => { called = true; };
            rti.Subscribe("test1", (channel, message) => {
                throw new TestException();
            });
            Thread.Sleep(100);
            rti.Publish("test1", "foo");
            int count = 0;
            while (!called && count++ < 300) Thread.Sleep(10);
            rti.Unsubscribe("test1");
            Thread.Sleep(100);
            Assert.IsTrue(called);
        }

        [Test]
        public void PublishSubscribe_Works() {
            bool received = false;
            rti.Subscribe<RuntimeControl>("control-test", (channelName, message) => { received = true; });
            Thread.Sleep(100);
            rti.Publish("control-test", new RuntimeControl { Pause = new Google.Protobuf.WellKnownTypes.Empty() });
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            rti.Unsubscribe("control-test");
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void UnsubscribeSingleListener_Works() {
            bool received = false;
            var subscription = rti.Subscribe("test2", (channelName, message) => { received = true; });
            Thread.Sleep(500);
            rti.Publish("test2", "foo");
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            Assert.IsTrue(received);

            bool received2 = false;
            rti.Subscribe("test2", (channelName, message) => { received2 = true; });
            rti.Unsubscribe(subscription);
            received = false;
            Thread.Sleep(500);
            rti.Publish("test2", "foo again");
            while (!received2 && count++ < 300) Thread.Sleep(10);
            rti.Unsubscribe("test2");
            Thread.Sleep(100);
            Assert.IsFalse(received);
            Assert.IsTrue(received2);
        }

        [Test]
        public void PublishesClientOnConnect() {
            // Another RTI (rti2) connects. Other RTI (rti) should know about it.
            bool received = false;
            int count = 0;
            while (!received && count++ < 500) {
                Thread.Sleep(10);
                foreach (var client in rti.KnownClients) {
                    if (client.Id == rti2.ClientId) received = true;
                }
            }
            Assert.IsTrue(received);
        }

        [Test]
        public void RespondsToClientRequest() {
            // Another RTI client (rti2) requests clients. RTI client (rti) should respond.
            bool received = false;
            rti2.Subscribe<Clients>(RTIChannel.Clients, (channelName, message) => {
                if (message.WhichCase == Clients.WhichOneofCase.Client && message.Client.Id == rti.ClientId && message.Client.Capabilities.Contains(RTICapability.RuntimeControl)) received = true;
            });
            rti2.Publish(RTIChannel.Clients, new Clients {
                RequestClients = new Google.Protobuf.WellKnownTypes.Empty()
            });
            int count = 0;
            while (!received && count++ < 500) Thread.Sleep(10);
            Assert.IsTrue(received);
        }

        [Test]
        public void RespondsToChannelsRequest() {
            // Another RTI (rti2) requests channels. RTI (rti) should respond.
            bool received = false;
            var subscription = rti2.Subscribe<Channels>(RTIChannel.Channels, (channelName, message) => {
                if (message.WhichCase == Channels.WhichOneofCase.ChannelUsage && message.ChannelUsage.ClientId == rti.ClientId) received = true;
            });
            rti2.Publish(RTIChannel.Channels, new Channels {
                RequestChannelUsage = new Google.Protobuf.WellKnownTypes.Empty()
            });
            int count = 0;
            while (!received && count++ < 500) Thread.Sleep(10);
            rti.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void ChannelsRequest_KnowsChannels() {
            // Another RTI (rti2) subscribes to a custom channel. RTI (rti) should be able to request and know about it.
            rti2.Subscribe("foobar", (name, data) => { });
            rti.Publish(RTIChannel.Channels, new Channels {
                RequestChannelUsage = new Google.Protobuf.WellKnownTypes.Empty()
            });
            bool received = false;
            int count = 0;
            while (!received && count++ < 500) {
                Thread.Sleep(10);
                foreach (var channel in rti.KnownChannels) {
                    if (channel.Name == "foobar") received = true;
                }
            }
            rti2.Unsubscribe("foobar");
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void SetState_PublishesClient() {
            bool received = false;
            var subscription = rti.Subscribe<Clients>(RTIChannel.Clients, (channel, message) => {
                switch (message.WhichCase) {
                    case Clients.WhichOneofCase.Client:
                        if (message.Client.Id == rti.ClientId) received = true;
                        break;
                }
            });
            try {
                Thread.Sleep(100);
                rti.State = RuntimeState.Playback;
                Thread.Sleep(100);
                rti.State = RuntimeState.Paused;
                int count = 0;
                while (!received && count++ < 300) Thread.Sleep(10);
                Thread.Sleep(100);
                Assert.IsTrue(received);
            } finally {
                rti.Unsubscribe(subscription);
            }
        }

        [Test]
        public void PublishError_Works() {
            bool received = false;
            var subscription = rti.Subscribe<RuntimeControl>(RTIChannel.Control, (channel, message) => {
                switch (message.ControlCase) {
                    case RuntimeControl.ControlOneofCase.Error:
                        if (message.Error.ClientId == rti.ClientId) received = true;
                        break;
                }
            });
            try {
                Thread.Sleep(100);
                rti.PublishError("test");
                int count = 0;
                while (!received && count++ < 300) Thread.Sleep(10);
                Thread.Sleep(100);
                Assert.IsTrue(received);
            } finally {
                rti.Unsubscribe(subscription);
            }
        }

        [Test]
        public void BrokerVersion_Set() {
            Thread.Sleep(100);
            Assert.IsFalse(string.IsNullOrWhiteSpace(rti.BrokerVersion));
        }

        [Test]
        public void PubSubJsonDictionary_Works() {
            bool received = false;
            rti.SubscribeJson("json", (string channelName, Dictionary<string, object> message) => {
                if (message["foo"].ToString() == "bar") received = true;
            });
            Thread.Sleep(100);
            rti.PublishJson("json", new Dictionary<string, object> { { "foo", "bar" } });
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            rti.Unsubscribe("json");
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }


        public class TestDTO {
            public string Foo;
        }
        [Test]
        public void PubSubJsonDTO_Works() {
            bool received = false;
            rti.SubscribeJson("json2", (string channelName, TestDTO message) => {
                if (message.Foo == "bar") received = true;
            });
            Thread.Sleep(100);
            rti.PublishJson("json2", new TestDTO { Foo = "bar" });
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            rti.Unsubscribe("json2");
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void RespondsToMeasuresRequest() {
            var measure = new Measure {
                Id = "test"
            };
            rti.RegisterMeasure(measure);
            // Another RTI client (rti2) requests measures. RTI client (rti) should respond.
            bool received = false;
            var subscription = rti2.Subscribe<Measures>(RTIChannel.Measures, (channelName, message) => {
                if (message.WhichCase == Measures.WhichOneofCase.Measure && message.Measure.Id == measure.Id) received = true;
            });
            rti2.Publish(RTIChannel.Measures, new Measures {
                RequestMeasures = new Google.Protobuf.WellKnownTypes.Empty()
            });
            int count = 0;
            while (!received && count++ < 500) Thread.Sleep(10);
            rti2.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void MeasureWithoutInterval_Measurement_PublishesInstantly() {
            bool received = false;
            var subscription = rti.Subscribe<Measurement>(RTIChannel.Measurement, (channelName, measurement) => {
                if (measurement.MeasureId == "test2") {
                    Assert.AreEqual(measurement.Value, 42, 0.01);
                    received = true;
                }
            });
            Thread.Sleep(100);
            rti.Measure("test2", 42);
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            Thread.Sleep(100);
            rti.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void MeasureWithInterval_OneMeasurement_PublishesValue() {
            var measure = new Measure {
                Id = "interval",
                Interval = 1
            };

            bool received = false;
            var subscription = rti.Subscribe<Measurement>(RTIChannel.Measurement, (channelName, measurement) => {
                if (measurement.MeasureId == measure.Id) {
                    Assert.AreEqual(measurement.Value, 42, 0.01);
                    received = true;
                }
            });
            Thread.Sleep(250);

            // Make a measurement
            rti.Measure(measure, 42);

            // Should not be published until interval (1s) passes
            Thread.Sleep(250);
            Assert.IsFalse(received);

            // Should be received after ~1s
            int count = 0;
            while (!received && count++ < 300) Thread.Sleep(10);
            Thread.Sleep(100);
            rti.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void MeasureWithInterval_MultipleMeasurements_PublishesTumblingWindow() {
            var measure = new Measure {
                Id = "window",
                Interval = 1
            };

            bool received = false;
            var subscription = rti.Subscribe<Measurement>(RTIChannel.Measurement, (channelName, measurement) => {
                if (measurement.MeasureId == measure.Id) {
                    Assert.AreEqual(measurement.Window.Count, 3);
                    Assert.AreEqual(measurement.Window.Mean, 42, 0.01);
                    Assert.AreEqual(measurement.Window.Max, 44, 0.01);
                    Assert.AreEqual(measurement.Window.Min, 40, 0.01);
                    received = true;
                }
            });
            Thread.Sleep(100);

            // Make a couple of measurements
            rti.Measure(measure, 42);
            rti.Measure(measure, 44);
            rti.Measure(measure, 40);

            // Should not be published until interval (1s) passes
            Thread.Sleep(500);
            Assert.IsFalse(received);

            // Should be received after ~1s
            int count = 0;
            while (!received && count++ < 30) Thread.Sleep(100);
            Thread.Sleep(100);
            rti.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void EntityMeasureWithInterval_MultipleMeasurements_PublishesTumblingWindow() {
            var measure = new Measure {
                Id = "window",
                Interval = 1,
                Entity = true
            };

            bool received1 = false, received2 = false;
            var subscription = rti.Subscribe<Measurement>(RTIChannel.Measurement, (channelName, measurement) => {
                if (measurement.MeasureId == measure.Id && measurement.EntityId == "entity1") {
                    Assert.AreEqual(measurement.Window.Count, 2);
                    Assert.AreEqual(measurement.Window.Mean, 43, 0.01);
                    received1 = true;
                } else if (measurement.MeasureId == measure.Id && measurement.EntityId == "entity2") {
                    //Assert.AreEqual(measurement.Window.Count, 1);
                    //Assert.AreEqual(measurement.Window.Mean, 40, 0.01);
                    Assert.AreEqual(measurement.Value, 40, 0.01);
                    received2 = true;
                }
            });
            Thread.Sleep(100);

            // Make a couple of measurements
            rti.Measure(measure, 42, "entity1");
            rti.Measure(measure, 44, "entity1");
            rti.Measure(measure, 40, "entity2");

            // Should not be published until interval (1s) passes
            Thread.Sleep(500);
            Assert.IsFalse(received1);
            Assert.IsFalse(received2);

            // Should be received after ~1s
            int count = 0;
            while (!received1 && !received2 && count++ < 30) Thread.Sleep(100);
            Thread.Sleep(100);
            rti.Unsubscribe(subscription);
            Thread.Sleep(100);
            Assert.IsTrue(received1);
            Assert.IsTrue(received2);
        }

        [Test]
        public void ParticipantRegistrationForStation_SetsParticipant() {
            rti2.Publish(RTIChannel.Clients, new Clients { RequestClients = new Google.Protobuf.WellKnownTypes.Empty() });
            var message = new Clients {
                RegisterParticipant = new ParticipantRegistration {
                    Participant = "MrFoo",
                    Station = "Station1"
                }
            };
            rti2.Publish(RTIChannel.Clients, message);

            int count = 0;
            while ((string.IsNullOrEmpty(rti.Participant) || rti2.GetClient(rti.ClientId) == null || string.IsNullOrEmpty(rti2.GetClient(rti.ClientId).Participant)) && count++ < 30) Thread.Sleep(100);
            Thread.Sleep(100);

            Assert.AreEqual("MrFoo", rti.Participant);
            Assert.AreEqual("MrFoo", rti2.GetClient(rti.ClientId).Participant);
        }

        [Test]
        public void ParticipantRegistrationForClient_SetsParticipant() {
            rti2.Publish(RTIChannel.Clients, new Clients { RequestClients = new Google.Protobuf.WellKnownTypes.Empty() });
            var message = new Clients {
                RegisterParticipant = new ParticipantRegistration {
                    Participant = "MrFoo",
                    ClientId = rti.ClientId
                }
            };
            rti2.Publish(RTIChannel.Clients, message);

            int count = 0;
            while ((string.IsNullOrEmpty(rti.Participant) || rti2.GetClient(rti.ClientId) == null || string.IsNullOrEmpty(rti2.GetClient(rti.ClientId).Participant)) && count++ < 30) Thread.Sleep(100);
            Thread.Sleep(100);

            Assert.AreEqual("MrFoo", rti.Participant);
            Assert.AreEqual("MrFoo", rti2.GetClient(rti.ClientId).Participant);
        }

        [Test]
        public void VerifyToken_VerifiesOwnToken() {
            var ok = false;
            rti.VerifyToken(rti.AuthToken, result => {
                Assert.IsNull(result.Error);
                Assert.AreEqual(rti.Application, result.Application);
                ok = true;
            });
            for (int i = 0; i < 20 && !ok; i++) Thread.Sleep(100);
            Assert.IsTrue(ok);
        }

        [Test]
        public void VerifyToken_GetsError() {
            var ok = false;
            rti.VerifyToken("this ain't right", result => {
                Assert.IsNotNull(result.Error);
                ok = true;
            });
            for (int i = 0; i < 20 && !ok; i++) Thread.Sleep(100);
            Assert.IsTrue(ok);
        }

        [Test]
        public void EphemeralChannelRegisteredAfterFirstUse_UpdatesToEphemeral() {
            var received = false;
            var ephemeral = false;
            rti2.Subscribe("ephie", (channelName, message) => {
                received = true;
                ephemeral = rti2.GetChannel("ephie").Ephemeral;
            });

            rti.Publish("ephie", "foo");
            for (int i = 0; i < 20 && !received; i++) Thread.Sleep(100);

            rti.RegisterChannel(new Channel {
                Name = "ephie",
                Ephemeral = true
            });
            Thread.Sleep(500);
            received = false;
            rti.Publish("ephie", "bar");

            for (int i = 0; i < 20 && !received; i++) Thread.Sleep(100);
            rti2.Unsubscribe("ephie");
            Thread.Sleep(100);
            Assert.IsTrue(received);
            Assert.IsTrue(ephemeral);

        }

        [Test]
        public void Polling_QueuesReceivedMessages() {
            var receiveCount = 0;
            rti2.Polling = true;
            rti2.Subscribe("polling", (channelName, message) => {
                receiveCount++;
            });
            try {
                Thread.Sleep(200);

                rti.Publish("polling", "one");
                rti.Publish("polling", "two");
                rti.Publish("polling", "three");
                Thread.Sleep(100);

                for (int i = 0; i < 50 && receiveCount < 3; i++) {
                    Thread.Sleep(100);
                    rti2.Poll();
                }
                Assert.IsTrue(receiveCount >= 3);
            } finally {
                rti2.Polling = false;
                rti2.Unsubscribe("polling");
                Thread.Sleep(200);
            }
        }

        [Test]
        public void BrokerRPC_Works() {
            bool received = false;
            rti.Invoke("echo", "hello", (response) => {
                Assert.AreEqual("hello", response);
                received = true;
            });
            for (int i = 0; i < 20 && !received; i++) Thread.Sleep(100);
            Assert.IsTrue(received);
        }

        [Test]
        public void BrokerRPC_ErrorSpecificallyCatchable() {
            bool errorCaught = false;
            rti.Invoke("echo", "Error is intentional", (response) => {
                Assert.Fail("Should not be called");
            }, (error) => {
                errorCaught = true;
                Assert.AreEqual("Error is intentional", error);
            });
            for (int i = 0; i < 20 && !errorCaught; i++) Thread.Sleep(100);
            Assert.IsTrue(errorCaught);
        }

        [Test]
        public void BrokerRPC_ErrorCatchable() {
            bool errorCaught = false;
            rti.OnError += (channelName, exception) => {
                if (channelName == "rpc") {
                    errorCaught = true;
                    Assert.AreEqual("Error is intentional", exception.Message);
                }
            };
            rti.Invoke("echo", "Error is intentional", (response) => {
                Assert.Fail("Should not be called");
            });
            for (int i = 0; i < 20 && !errorCaught; i++) Thread.Sleep(100);
            Assert.IsTrue(errorCaught);
        }

        [Test]
        public void PublishBeforeConnected_ThrowsError() {
            var temprti = new RTIClient(connect: false) { Application = "C# IntegrationTest Temp" };
            try {
                temprti.Publish("foo", "bar");
                Assert.Fail("Should not be able to publish before connected");
            } catch (Exception) {
                // pass
            } finally {
                temprti.Disconnect();
            }
        }

        [Test]
        public void Polling_WaitUntilConnected_Works() {
            var temprti = new RTIClient(polling: true) { Application = "C# IntegrationTest Temp" };
            temprti.WaitUntilConnected();
            Assert.IsTrue(temprti.IsConnected);
            temprti.Disconnect();
        }
    }
}
