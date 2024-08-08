using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Inhumate.RTI.Client {
    internal class RTIWebSocket : IDisposable {

        public bool Polling { get; set; }

        public WebSocketState State => socket.State;
        public int QueueCount => outQueue.Count;
        public int PollCount => pollQueue.Count;

        public event ConnectedListener OnConnected;
        public event DisconnectedListener OnDisconnected;
        public event ErrorListener OnError;
        public event MessageListener OnMessage;
        public event BinaryMessageListener OnBinaryMessage;

        private readonly BlockingCollection<KeyValuePair<DateTime, QueuedMessage>> outQueue =
            new BlockingCollection<KeyValuePair<DateTime, QueuedMessage>>();
        private readonly ConcurrentQueue<QueuedMessage> pollQueue = new ConcurrentQueue<QueuedMessage>();

        private const int outQueueLimit = 10000;
        private readonly TimeSpan sendTimeout = TimeSpan.FromSeconds(10);

        private readonly ClientWebSocket socket;
        private readonly CancellationTokenSource tokenSource = new CancellationTokenSource();

        private readonly string url;

        private bool disconnecting;
        private bool sendThreadDone;


        public RTIWebSocket(string url) {
            this.url = url;
            socket = new ClientWebSocket();
            StartConnectionThread();
        }

        public async Task<bool> Connect() {
            try {
                disconnecting = false;
                await socket.ConnectAsync(new Uri(url), tokenSource.Token).ConfigureAwait(false);
                StartReceiveThread();
                StartSendThread();

                await Task.Run(async () => {
                    var st = DateTime.UtcNow;

                    while (socket.State != WebSocketState.Open && (DateTime.UtcNow - st).TotalSeconds < 16) {
                        await Task.Delay(1).ConfigureAwait(false);
                    }
                });

                return socket.State == WebSocketState.Open;
            } catch (Exception ex) {
                OnError?.Invoke(this, ex);
                throw;
            }
        }

        public async Task<bool> Send(string data) {
            try {
                if (State != WebSocketState.Open && QueueCount >= outQueueLimit || disconnecting) {
                    return false;
                }

                await Task.Run(() => {
                    var message = new QueuedMessage { Data = Encoding.UTF8.GetBytes(data) };
                    outQueue.Add(new KeyValuePair<DateTime, QueuedMessage>(DateTime.UtcNow, message));
                }).ConfigureAwait(false);

                return true;
            } catch (Exception ex) {
                OnError?.Invoke(this, ex);
                throw;
            }
        }

        public async Task<bool> SendRaw(byte[] data) {
            try {
                if (State != WebSocketState.Open && QueueCount >= outQueueLimit || disconnecting) {
                    return false;
                }

                await Task.Run(() => {
                    outQueue.Add(new KeyValuePair<DateTime, QueuedMessage>(DateTime.UtcNow, new QueuedMessage { Data = data, IsBinary = true }));
                }).ConfigureAwait(false);

                return true;
            } catch (Exception ex) {
                OnError?.Invoke(this, ex);
                throw;
            }
        }

        public int Poll(int max = int.MaxValue) {
            int count = 0;
            while (pollQueue.TryDequeue(out QueuedMessage message)) {
                count++;
                if (message.IsBinary) {
                    OnBinaryMessage?.Invoke(this, message.Data);
                } else {
                    OnMessage?.Invoke(this, Encoding.UTF8.GetString(message.Data));
                }
                if (max > 0 && count >= max) break;
            }
            return count;
        }

        private void StartConnectionThread() {
            Task.Run(async () => {
                try {
                    var lastState = State;
                    while (socket != null && !_disposedValue) {
                        if (lastState == State) {
                            await Task.Delay(200).ConfigureAwait(false);
                            continue;
                        }
                        if (lastState == WebSocketState.Aborted &&
                            (State == WebSocketState.Connecting || State == WebSocketState.Open)) {
                            break;
                        }
                        if (lastState == State) {
                            await Task.Delay(200).ConfigureAwait(false);
                            continue;
                        }

                        if (State == WebSocketState.Open) {
                            OnConnected?.Invoke(this);
                        }

                        if (State == WebSocketState.Closed || State == WebSocketState.Aborted) {
                            OnDisconnected?.Invoke(this, socket.CloseStatus ?? WebSocketCloseStatus.Empty);
                            if (socket.CloseStatus != null && socket.CloseStatus != WebSocketCloseStatus.NormalClosure) {
                                OnError?.Invoke(this, new Exception(socket.CloseStatus + " " + socket.CloseStatusDescription));
                            }
                        }

                        lastState = State;
                    }
                } catch (Exception ex) {
                    OnError?.Invoke(this, ex);
                }
            });
        }

        private void StartReceiveThread() {
            Task.Run(async () => {
                try {
                    while (socket.State == WebSocketState.Open && !_disposedValue) {
                        var message = "";
                        var binary = new List<byte>();

                        var done = false;

                        while (!done) {
                            done = true;
                            var buffer = new byte[1024];
                            WebSocketReceiveResult res;
                            try {
                                res = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), tokenSource.Token);
                            } catch (Exception) {
                                socket.Abort();
                                throw;
                            }
                            if (res == null) {
                                done = false;
                                continue;
                            }
                            if (res.MessageType == WebSocketMessageType.Close) {
                                try {
                                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "SERVER REQUESTED CLOSE", tokenSource.Token);
                                } catch (WebSocketException) { }
                                disconnecting = true;
                                return Task.CompletedTask;
                            }
                            if (res.MessageType == WebSocketMessageType.Text) {
                                if (!res.EndOfMessage) {
                                    message += Encoding.UTF8.GetString(buffer).TrimEnd('\0');
                                    done = false;
                                    continue;
                                }
                                message += Encoding.UTF8.GetString(buffer).TrimEnd('\0');
                                if (message.Trim().ToLower() == "ping") {
                                    _ = Send("pong");
                                } else {
                                    if (Polling) {
                                        pollQueue.Enqueue(new QueuedMessage { Data = Encoding.UTF8.GetBytes(message) });
                                    } else {
                                        Task.Run(() => OnMessage?.Invoke(this, message)).Wait(50);
                                    }
                                }
                            } else {
                                var exactDataBuffer = new byte[res.Count];
                                Array.Copy(buffer, 0, exactDataBuffer, 0, res.Count);
                                if (!res.EndOfMessage) {
                                    binary.AddRange(exactDataBuffer);
                                    done = false;
                                    continue;
                                }
                                binary.AddRange(exactDataBuffer);
                                var binaryData = binary.ToArray();
                                if (Polling) {
                                    pollQueue.Enqueue(new QueuedMessage { Data = binaryData, IsBinary = true });
                                } else {
                                    Task.Run(() => OnBinaryMessage?.Invoke(this, binaryData)).Wait(50);
                                }
                            }

                        }
                    }
                } catch (Exception ex) {
                    OnError?.Invoke(this, ex);
                }

                return Task.CompletedTask;
            });
        }

        private void StartSendThread() {
            Task.Run(async () => {
                sendThreadDone = false;
                try {
                    while (!_disposedValue) {
                        if (socket.State == WebSocketState.Open) {
                            var msg = outQueue.Take(tokenSource.Token);
                            if (msg.Key.Add(sendTimeout) < DateTime.UtcNow) {
                                continue;
                            }

                            var buffer = msg.Value.Data;
                            try {
                                var msgType = msg.Value.IsBinary ? WebSocketMessageType.Binary : WebSocketMessageType.Text;
                                await socket.SendAsync(new ArraySegment<byte>(buffer), msgType, true,
                                    tokenSource.Token).ConfigureAwait(false);
                            } catch (Exception ex) {
                                OnError?.Invoke(this, ex);
                                socket.Abort();
                                break;
                            }
                        }
                    }
                } catch (Exception ex) {
                    OnError?.Invoke(this, ex);
                }

                sendThreadDone = true;
                return Task.CompletedTask;
            });
        }

        public void Disconnect() {
            try {
                disconnecting = true;
                socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "NORMAL SHUTDOWN", tokenSource.Token).Wait(2000);
            } catch (Exception) { }
        }

        private bool _disposedValue;

        protected virtual void Dispose(bool disposing, bool wait) {
            if (!_disposedValue) {
                if (disposing) {
                    var i = 0;
                    while (outQueue.Count > 0 && !sendThreadDone) {
                        i++;
                        Task.Delay(1000).Wait();
                        if (i > 25) {
                            break;
                        }
                    }
                    Disconnect();
                    try {
                        tokenSource.Cancel();
                        Thread.Sleep(500);
                        tokenSource.Dispose();
                    } catch (ObjectDisposedException) { }
                    socket.Dispose();
                }

                _disposedValue = true;
            }
        }

        public void Dispose() {
            Dispose(true);
        }

        public void Dispose(bool wait) {
            Dispose(true, wait);
        }

        internal class QueuedMessage {
            public byte[] Data { get; set; }
            public bool IsBinary;
        }

        internal delegate void ConnectedListener(object sender);
        internal delegate void DisconnectedListener(object sender, WebSocketCloseStatus reason);
        internal delegate void ErrorListener(object sender, Exception ex);
        internal delegate void MessageListener(object sender, string message);
        internal delegate void BinaryMessageListener(object sender, byte[] data);

    }

}
