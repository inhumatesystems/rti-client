using System;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Inhumate.RTI {
    public class ProtocolRobustnessTest {

        [Test]
        public void MalformedProtocolMessage_RaisesProtocolError_AndReceiverContinues() {
            var rti = new RTIClient(connect: false);
            var onMessage = typeof(RTIClient).GetMethod("OnMessage", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(onMessage);

            var protocolErrorSeen = false;
            var customEventSeen = false;
            rti.OnError += (channel, _error) => {
                if (channel == "protocol") protocolErrorSeen = true;
            };
            rti.On("custom", (_channel, data) => {
                if (data?.ToString() == "ok") customEventSeen = true;
            });

            onMessage.Invoke(rti, new object[] { "{\"event\":\"#publish\",\"data\":\"not-an-object\"}" });
            onMessage.Invoke(rti, new object[] { "{\"event\":\"custom\",\"data\":\"ok\"}" });

            Assert.IsTrue(protocolErrorSeen);
            Assert.IsTrue(customEventSeen);
        }

        [Test]
        public void MaxOutboundQueueDepth_BoundsQueuedSends() {
            var socketType = typeof(RTIClient).Assembly.GetType("Inhumate.RTI.RTIWebSocket");
            Assert.IsNotNull(socketType);
            var socket = socketType.GetConstructor(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
                null, new[] { typeof(string) }, null).Invoke(new object[] { "ws://127.0.0.1:1" });
            try {
                socketType.GetProperty("MaxOutboundQueueDepth").SetValue(socket, 1);
                var send = socketType.GetMethod("Send");

                var first = (Task<bool>)send.Invoke(socket, new object[] { "one" });
                var second = (Task<bool>)send.Invoke(socket, new object[] { "two" });

                Assert.IsTrue(first.Result);
                Assert.IsFalse(second.Result);
            } finally {
                socketType.GetField("sendThreadDone", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(socket, true);
                ((IDisposable)socket).Dispose();
            }
        }
    }
}
