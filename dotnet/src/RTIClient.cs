using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Inhumate.RTI.Proto;
using Google.Protobuf;
using Utf8Json;
using System.Net.WebSockets;
using System.Threading.Tasks;
using System.Collections.Concurrent;

namespace Inhumate.RTI {

    public class RTIClient {

        public string Url { get; private set; }
        public string Application { get; set; } = "C#";
        public string ApplicationVersion { get; set; } = "";
        public string EngineVersion { get; set; } = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription;
        public string IntegrationVersion { get; set; } = "";
        public string ClientId { get; set; } = null;
        public string Federation { get; set; } = null;
        public string Secret { get; set; } = null;
        public bool Incognito { get; set; } = false;
        public bool IsConnected { get; private set; }
        public DateTime LastPing { get; private set; }
        public int PingTimeout { get; set; } = 20000;
        public string BrokerVersion { get; private set; }
        public string Host { get; set; } = "";
        public string Station { get; set; } = "";
        public string Participant { get; set; } = "";
        public string Role { get; set; } = "";
        public string FullName { get; set; } = "";
        public string User { get; private set; } = "";
        private string password;
        public string AuthToken { get; private set; }
        public string ClientUrl { get; set; }
        public List<string> Capabilities { get; set; } = new List<string>();

        private int cid;

        private bool polling;
        public bool Polling {
            get { return polling; }
            set { polling = value; if (socket != null) socket.Polling = polling; }
        }
        public int PollCount => socket != null ? socket.PollCount : 0;

        public float MeasurementIntervalTimeScale { get; set; } = 1f;

        public event Action OnConnected;
        public event Action OnFirstConnect;
        public event Action OnDisconnected;
        public event ErrorListener OnError;

        private RTIWebSocket socket;

        private RuntimeState state;
        public RuntimeState State {
            get { return state; }
            set {
                if (value != state) {
                    state = value;
                    if (IsConnected && !Incognito) PublishClient();
                }
            }
        }

        private ConcurrentDictionary<string, List<UntypedListener>> subscriptions = new ConcurrentDictionary<string, List<UntypedListener>>();
        private ConcurrentDictionary<string, List<UntypedListener>> listeners = new ConcurrentDictionary<string, List<UntypedListener>>();
        private ConcurrentDictionary<int, RPCListener> rpcListeners = new ConcurrentDictionary<int, RPCListener>();
        private ConcurrentDictionary<int, RPCListener> rpcErrorListeners = new ConcurrentDictionary<int, RPCListener>();

        private ConcurrentDictionary<string, ChannelUse> usedChannels = new ConcurrentDictionary<string, ChannelUse>();
        public ICollection<ChannelUse> UsedChannels { get { return new List<ChannelUse>(usedChannels.Values); } }
        private ConcurrentDictionary<string, Channel> knownChannels = new ConcurrentDictionary<string, Channel>();
        public ICollection<Channel> KnownChannels { get { return new List<Channel>(knownChannels.Values); } }
        private ConcurrentDictionary<string, Proto.Client> knownClients = new ConcurrentDictionary<string, Proto.Client>();
        public ICollection<Proto.Client> KnownClients { get { return new List<Proto.Client>(knownClients.Values); } }
        private ConcurrentDictionary<string, Measure> usedMeasures = new ConcurrentDictionary<string, Measure>();
        public ICollection<Measure> UsedMeasures { get { return new List<Measure>(knownMeasures.Values); } }
        private ConcurrentDictionary<string, Measure> knownMeasures = new ConcurrentDictionary<string, Measure>();
        public ICollection<Measure> KnownMeasures { get { return new List<Measure>(knownMeasures.Values); } }

        public string OwnChannelPrefix => $"@{ClientId}:";

        private bool firstConnected;
        private bool shouldBeConnected;
        private bool reconnecting;
        private string connectionError;

        private Task collectMeasurementsTask;
        private ConcurrentDictionary<Measure, Queue<float>> collectQueue = new ConcurrentDictionary<Measure, Queue<float>>();
        private ConcurrentDictionary<Measure, DateTime> lastCollect = new ConcurrentDictionary<Measure, DateTime>();
        private Task pingTimeoutTask;

        public RTIClient(string url = null, bool connect = true, bool polling = false, string user = null, string password = null) {
            if (string.IsNullOrEmpty(url)) url = Environment.GetEnvironmentVariable("RTI_URL");
            if (string.IsNullOrEmpty(url)) url = RTIConstants.DefaultUrl;
            if (!url.StartsWith("ws://") && !url.StartsWith("wss://")) {
                if (url.StartsWith("localhost") || url.StartsWith("127.")) url = $"ws://{url}";
                else url = $"wss://{url}";
            }
            Url = url;
            if (string.IsNullOrEmpty(ClientId)) ClientId = Guid.NewGuid().ToString();
            if (string.IsNullOrEmpty(Federation)) Federation = Environment.GetEnvironmentVariable("RTI_FEDERATION");
            if (!string.IsNullOrEmpty(Federation)) Federation = Federation.Replace('/', '_'); // slashes quietly not allowed in federation id
            if (string.IsNullOrEmpty(Host)) Host = Environment.GetEnvironmentVariable("RTI_HOST");
            if (string.IsNullOrEmpty(Host)) Host = Environment.MachineName;
            if (string.IsNullOrEmpty(Station)) Station = Environment.GetEnvironmentVariable("RTI_STATION");
            Subscribe<Clients>(RTIChannel.Clients, OnClients);
            Subscribe<Channels>(RTIChannel.Channels, OnChannels);
            Subscribe<Measures>(RTIChannel.Measures, OnMeasures);
            Subscribe(RTIChannel.ClientDisconnect, OnClientDisconnect, false);
            On("broker-version", (channel, content) => { BrokerVersion = content?.ToString(); });
            On("fail", (channel, content) => {
                shouldBeConnected = false;
                connectionError = content != null ? content.ToString() : "unknown";
                OnError?.Invoke("fail", new RTIConnectionFailure(content?.ToString()));
            });
            On("ping", (channel, content) => {
                Transmit("pong", $"{content}");
            });
            Polling = polling;
            User = user;
            this.password = password;
            if (connect) Connect();
        }

        public Proto.Client GetClient(string id) {
            if (knownClients.ContainsKey(id)) return knownClients[id];
            return null;
        }

        public void ClearClients() {
            knownClients.Clear();
        }

        public Proto.Channel GetChannel(string id) {
            if (knownChannels.ContainsKey(id)) return knownChannels[id];
            return null;
        }

        public void ClearChannels() {
            knownChannels.Clear();
        }

        public Proto.Measure GetMeasure(string id) {
            if (knownMeasures.ContainsKey(id)) return knownMeasures[id];
            return null;
        }

        public void ClearMeasures() {
            knownMeasures.Clear();
        }

        public void Connect(bool reconnectInitial = true) {
            connectionError = null;
            cid = 0;
            socket = new RTIWebSocket(Url) {
                Polling = Polling
            };
            socket.OnConnected += (object sender) => {
                shouldBeConnected = true;
                Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                    {"event", "#handshake"},
                    {"cid", ++cid}
                }));
            };
            socket.OnMessage += (object sender, string message) => {
                OnMessage(message);
            };
            socket.OnError += (object sender, Exception exception) => {
                if (!(exception is OperationCanceledException)) OnError?.Invoke("connection", exception);
            };
            socket.OnDisconnected += (object sender, WebSocketCloseStatus reason) => {
                IsConnected = false;
                OnDisconnected?.Invoke();
                if (shouldBeConnected && !reconnecting) StartReconnectThread();
            };
            var connect = socket.Connect();
            if (reconnectInitial) {
                if (!reconnecting) StartReconnectThread();
            } else {
                connect.Wait();
            }
        }

        private void OnMessage(string message) {
            //Console.WriteLine($"RECV {message}");
            if (message == "") {
                Send("");
                LastPing = DateTime.Now;
                if (pingTimeoutTask == null) StartPingTimeoutThread();
            } else if (message == "#1") {
                Send("#2");
                LastPing = DateTime.Now;
                if (pingTimeoutTask == null) StartPingTimeoutThread();
            } else if (message.StartsWith("{") && message.EndsWith("}")) {
                var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(message);
                if (dict.ContainsKey("rid") && dict["rid"].ToString() == "1") {
                    SendAuthToken();
                } else if (dict.ContainsKey("event") && dict["event"].ToString() == "#setAuthToken") {
                    AuthToken = ((Dictionary<string, object>)dict["data"])["token"].ToString();
                    foreach (var channelName in subscriptions.Keys) Subscribe(channelName);
                    if (!IsConnected || reconnecting) {
                        var first = !firstConnected;
                        reconnecting = false;
                        IsConnected = firstConnected = true;
                        if (!Incognito) {
                            PublishClient();
                            PublishMeasures();
                        }
                        if (first) OnFirstConnect?.Invoke();
                        OnConnected?.Invoke();
                    }
                } else if (dict.ContainsKey("event") && dict["event"].ToString() == "#removeAuthToken") {
                    AuthToken = null;
                    SendAuthToken();
                } else if (dict.ContainsKey("event") && dict["event"].ToString() == "#publish" && dict.ContainsKey("data")) {
                    var eventData = (Dictionary<string, object>)dict["data"];
                    var channel = eventData.ContainsKey("channel") ? eventData["channel"].ToString() : null;
                    if (!string.IsNullOrWhiteSpace(Federation)) channel = channel.Replace("//" + Federation + "/", "");
                    var data = eventData.ContainsKey("data") ? eventData["data"] : null;
                    if (subscriptions.ContainsKey(channel)) {
                        // Make a temp list to allow unsubscribing/subscribing from listeners
                        var tempListeners = new List<UntypedListener>(subscriptions[channel]);
                        foreach (var listener in tempListeners) {
                            try {
                                listener.Invoke(channel, data);
                            } catch (Exception e) {
                                OnError?.Invoke(channel, e);
                            }
                        }
                    } else {
                        // Unsubscribe when we have no listeners
                        Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                            { "event", "#unsubscribe" },
                            { "data", channel }
                        }));
                    }
                } else if (dict.ContainsKey("event") && !dict["event"].ToString().StartsWith("#")) {
                    var eventName = dict["event"].ToString();
                    var data = dict.ContainsKey("data") ? dict["data"] : null;
                    if (listeners.ContainsKey(eventName)) {
                        var tempListeners = new List<UntypedListener>(listeners[eventName]);
                        foreach (var listener in tempListeners) {
                            try {
                                listener.Invoke(eventName, data);
                            } catch (Exception e) {
                                OnError?.Invoke(eventName, e);
                            }
                        }
                    }
                } else if (dict.ContainsKey("rid") && int.TryParse($"{dict["rid"]}", out int rid)) {
                    var data = dict.ContainsKey("data") ? dict["data"] : null;
                    var error = dict.ContainsKey("error") ? dict["error"] : null;
                    if (error != null) {
                        if (rpcErrorListeners.ContainsKey(rid)) rpcErrorListeners[rid].Invoke(error);
                        else OnError?.Invoke("rpc", new Exception(error.ToString()));
                    } else {
                        if (rpcListeners.ContainsKey(rid)) rpcListeners[rid].Invoke(data);
                    }
                    if (rpcErrorListeners.ContainsKey(rid)) rpcErrorListeners.TryRemove(rid, out _);
                    if (rpcListeners.ContainsKey(rid)) rpcListeners.TryRemove(rid, out _);
                }
            }
        }

        private Task<bool> SendAuthToken() {
            var authToken = new Dictionary<string, object> {
                { "application", Application },
                { "clientId", ClientId },
                { "clientLibraryVersion", RTIConstants.Version },
            };
            if (!string.IsNullOrWhiteSpace(Federation)) authToken["federation"] = Federation;
            string secret = System.Environment.GetEnvironmentVariable("RTI_SECRET");
            if (string.IsNullOrEmpty(secret)) secret = this.Secret;
            if (!string.IsNullOrEmpty(secret)) authToken["secret"] = secret;
            if (User != null) authToken["user"] = User;
            if (Participant != null) authToken["participant"] = Participant;
            if (FullName != null) authToken["fullName"] = FullName;
            if (Role != null) authToken["role"] = Role;
            if (password != null) authToken["password"] = password;
            var json = new Dictionary<string, object> {
                { "event", "auth" },
                { "data", authToken }
            };
            return Send(JsonSerializer.ToJsonString(json));
        }

        private Task<bool> Send(string message) {
            //Console.WriteLine($"SEND {message}");
            return socket.Send(message);
        }

        private void StartReconnectThread() {
            reconnecting = true;
            new Thread(() => {
                Thread.Sleep(5000);
                while (socket == null || !IsConnected) {
                    if (socket != null) {
                        try {
                            socket.Disconnect();
                            socket.Dispose();
                        } catch (Exception) { }
                    } else {
                        Thread.Sleep(500);
                    }
                    Thread.Sleep(500);
                    Connect();
                    Thread.Sleep(1000);
                }
            }).Start();
        }

        public void WaitUntilConnected() {
            bool connected = false;
            Action listener = () => {
                connected = true;
            };
            OnConnected += listener;
            int count = 0;
            while (count++ < 500 && !connected && connectionError == null) { 
                if (polling) Poll(1); 
                Thread.Sleep(10);
            }
            OnConnected -= listener;
            if (!connected) throw new RTIConnectionFailure(connectionError?.ToString());
        }

        public UntypedListener Subscribe(string channelName, UntypedListener callback, bool register = true) {
            if (register) RegisterChannelUsage(channelName, false, "text");
            return DoSubscribe(channelName, callback);
        }

        public UntypedListener SubscribeJson<T>(string channelName, TypedListener<T> callback, bool register = true) {
            if (register) RegisterChannelUsage(channelName, false, "json");
            return DoSubscribe(channelName, (name, data) => {
                try {
                    var message = JsonSerializer.Deserialize<T>(data.ToString(), Utf8Json.Resolvers.StandardResolver.AllowPrivateCamelCase);
                    callback(name, message);
                } catch (Exception e) {
                    OnError?.Invoke(name, e);
                }
            });
        }

        public UntypedListener Subscribe<T>(string channelName, TypedListener<T> callback, bool register = true) where T : IMessage<T>, new() {
            if (register) RegisterChannelUsage(channelName, false, typeof(T).Name);
            return DoSubscribe(channelName, (name, data) => {
                try {
                    callback(name, Parse<T>(data.ToString()));
                } catch (Exception e) {
                    OnError?.Invoke(name, e);
                }
            });
        }

        public static T Parse<T>(string content) where T : IMessage<T>, new() {
            var parser = new MessageParser<T>(() => new T());
            return parser.ParseFrom(Convert.FromBase64String(content));
        }

        public UntypedListener Subscribe<T>(string channelName, TypedIdListener<T> callback, bool register = true) where T : IMessage<T>, new() {
            if (register) RegisterChannelUsage(channelName, false, typeof(T).Name);
            var parser = new MessageParser<T>(() => new T());
            return DoSubscribe(channelName, (name, data) => {
                try {
                    var binary = Convert.FromBase64String(data.ToString());
                    var idMessage = IdMessage.Parser.ParseFrom(binary);
                    var message = parser.ParseFrom(binary);
                    callback(name, idMessage.Id, message);
                } catch (Exception e) {
                    OnError?.Invoke(name, e);
                }
            });
        }

        private UntypedListener DoSubscribe(string channelName, UntypedListener callback) {
            if (IsConnected) Subscribe(channelName);
            if (!subscriptions.ContainsKey(channelName)) subscriptions[channelName] = new List<UntypedListener>();
            subscriptions[channelName].Add(callback);
            return callback;
        }

        private void Subscribe(string channelName) {
            if (!string.IsNullOrWhiteSpace(Federation)) channelName = $"//{Federation}/{channelName}";
            Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                { "event", "#subscribe" },
                { "data", new Dictionary<string, object> {
                    { "channel", channelName }
                }},
                { "cid", ++cid}
            }));
        }

        public void Unsubscribe(string channelName) {
            if (!string.IsNullOrWhiteSpace(Federation)) channelName = $"//{Federation}/{channelName}";
            subscriptions.TryRemove(channelName, out _);
            if (IsConnected) Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                { "event", "#unsubscribe" },
                { "data", channelName }
            }));
        }

        public void Unsubscribe(UntypedListener listener) {
            var channels = new List<string>();
            foreach (var pair in subscriptions) {
                var listeners = pair.Value;
                if (listeners.Contains(listener)) {
                    if (listeners.Count <= 1) {
                        channels.Add(pair.Key);
                    } else {
                        listeners.Remove(listener);
                    }
                }
            }
            foreach (var channel in channels) Unsubscribe(channel);
        }

        public void Publish(string channelName, string data, bool register = true) {
            DoPublish(channelName, data);
            if (register) RegisterChannelUsage(channelName, true, "text");
        }

        public void Publish(string channelName, IMessage message, bool register = true) {
            var stream = new MemoryStream();
            message.WriteTo(stream);
            DoPublish(channelName, System.Convert.ToBase64String(stream.ToArray()));
            if (register) RegisterChannelUsage(channelName, true, message.GetType().Name);
        }

        public void PublishJson(string channelName, object message, bool register = true) {
            DoPublish(channelName, JsonSerializer.ToJsonString(message, Utf8Json.Resolvers.StandardResolver.AllowPrivateCamelCase));
            if (register) RegisterChannelUsage(channelName, true, "json");
        }

        protected void DoPublish(string channelName, string data) {
            if (string.IsNullOrEmpty(channelName)) throw new ArgumentException("Channel name cannot be empty");
            if (!firstConnected || socket == null) throw new InvalidOperationException("Cannot publish before connected");
            if (!string.IsNullOrWhiteSpace(Federation) && !channelName.StartsWith("@")) channelName = $"//{Federation}/{channelName}";
            Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                { "event", "#publish" },
                { "data", new Dictionary<string, object> {
                    { "channel", channelName },
                    { "data", data }
                }}
            }));
        }

        public void On(string eventName, UntypedListener listener) {
            if (!listeners.ContainsKey(eventName)) listeners[eventName] = new List<UntypedListener>();
            listeners[eventName].Add(listener);
        }

        public void Off(string eventName) {
            listeners.TryRemove(eventName, out _);
        }

        public void Transmit(string eventName, string data = null) {
            Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                { "event", eventName },
                { "data", data }
            }));
        }

        public void Invoke(string procedureName, object data, RPCListener listener, RPCListener errorListener = null) {
            int cid = ++this.cid;
            if (listener != null) rpcListeners[cid] = listener;
            if (errorListener != null) rpcErrorListeners[cid] = errorListener;
            Send(JsonSerializer.ToJsonString(new Dictionary<string, object> {
                    { "event", procedureName },
                    { "data", data },
                    { "cid", cid }
                }));
        }

        public int Poll(int max = int.MaxValue) {
            if (!Polling) throw new InvalidOperationException("Client is not configured for polling. Set RTIClient.Polling = true if you want to poll.");
            if (socket == null) return 0;
            return socket.Poll(max);
        }

        public void Disconnect() {
            shouldBeConnected = false;
            firstConnected = false;
            if (socket != null) {
                socket.Disconnect();
                socket.Dispose();
                socket = null;
            }
        }

        public void VerifyToken(string token, TokenVerificationListener listener) {
            Invoke("verifytoken", token, (data) => {
                var result = JsonSerializer.Deserialize<TokenVerificationResult>(JsonSerializer.Serialize(data), Utf8Json.Resolvers.StandardResolver.AllowPrivateCamelCase);
                listener(result);
            });
        }

        public void OnClients(string channelName, Clients message) {
            if (message.WhichCase == Clients.WhichOneofCase.RequestClients) {
                if (!Incognito) PublishClient();
            } else if (message.WhichCase == Clients.WhichOneofCase.Client) {
                knownClients[message.Client.Id] = message.Client;
            } else if (message.WhichCase == Clients.WhichOneofCase.RegisterParticipant) {
                var reg = message.RegisterParticipant;
                if ((string.IsNullOrEmpty(reg.ClientId) || reg.ClientId == ClientId)
                    && (string.IsNullOrEmpty(reg.Host) || reg.Host == Host)
                    && (string.IsNullOrEmpty(reg.Station) || reg.Station == Station)
                    && (reg.Participant != Participant || reg.Role != Role || reg.FullName != FullName)) {
                    Participant = reg.Participant;
                    Role = reg.Role;
                    FullName = reg.FullName;
                    PublishClient();
                }
            }
        }

        public void OnChannels(string channelName, Channels message) {
            if (message.WhichCase == Channels.WhichOneofCase.RequestChannelUsage) {
                message = new Channels {
                    ChannelUsage = new ChannelUsage {
                        ClientId = ClientId
                    }
                };
                foreach (var use in usedChannels.Values) {
                    message.ChannelUsage.Usage.Add(use);
                }
                if (!Incognito) Publish(RTIChannel.Channels, message);
            } else if (message.WhichCase == Channels.WhichOneofCase.ChannelUsage) {
                foreach (var usage in message.ChannelUsage.Usage) {
                    DiscoverChannel(usage.Channel);
                }
            } else if (message.WhichCase == Channels.WhichOneofCase.Channel) {
                DiscoverChannel(message.Channel);
            }
        }

        public void OnMeasures(string channelName, Measures message) {
            if (message.WhichCase == Measures.WhichOneofCase.RequestMeasures) {
                if (!Incognito) PublishMeasures();
            } else if (message.WhichCase == Measures.WhichOneofCase.Measure) {
                knownMeasures[message.Measure.Id] = message.Measure;
            }
        }

        public void OnClientDisconnect(string channelName, object message) {
            if (message != null && knownClients.ContainsKey(message.ToString())) {
                knownClients.TryRemove(message.ToString(), out _);
            }
        }

        public void PublishClient() {
            var myClient = new Proto.Client {
                Id = ClientId,
                Application = Application,
                State = State,
                ApplicationVersion = ApplicationVersion,
                ClientLibraryVersion = RTIConstants.Version,
                EngineVersion = EngineVersion,
                IntegrationVersion = IntegrationVersion,
                Host = Host ?? "",
                Station = Station ?? "",
                User = User ?? "",
                Participant = Participant ?? "",
                Role = Role ?? "",
                FullName = FullName ?? "",
                Url = ClientUrl ?? ""
            };
            if (Capabilities != null) myClient.Capabilities.AddRange(Capabilities);
            Publish(RTIChannel.Clients, new Clients { Client = myClient });
        }

        public void PublishMeasures() {
            foreach (var measure in usedMeasures.Values) {
                Publish(RTIChannel.Measures, new Measures { Measure = measure });
            }
        }

        public void PublishError(string message, RuntimeState? errorState = null) {
            Publish(RTIChannel.Control, new RuntimeControl {
                Error = new RuntimeControl.Types.Error {
                    ClientId = ClientId,
                    State = errorState.HasValue ? errorState.Value : state,
                    Message = message
                }
            });
        }

        public void PublishHeartbeat() {
            Publish(RTIChannel.Clients, new Clients {
                Heartbeat = new ClientHeartbeat {
                    ClientId = ClientId
                }
            });
        }

        public void PublishProgress(int progress) {
            Publish(RTIChannel.Clients, new Clients {
                Progress = new ClientProgress {
                    ClientId = ClientId,
                    Progress = (uint)progress
                }
            });
        }

        public void PublishValue(object value, bool highlight = false, bool error = false) {
            Publish(RTIChannel.Clients, new Clients {
                Value = new ClientValue {
                    ClientId = ClientId,
                    Value = value != null ? value.ToString() : "",
                    Highlight = highlight,
                    Error = error
                }
            });
        }

        private void RegisterChannelUsage(string channelName, bool usePublish, string type = "") {
            if (channelName.StartsWith("@")) return;
            Channel channel;
            if (knownChannels.ContainsKey(channelName)) {
                channel = knownChannels[channelName];
            } else {
                channel = new Channel {
                    Name = channelName,
                    DataType = type
                };
            }
            ChannelUse use = null;
            if (usedChannels.ContainsKey(channel.Name)) {
                use = usedChannels[channel.Name];
            } else {
                use = new ChannelUse { Channel = channel };
                usedChannels[channel.Name] = use;
            }
            if (usePublish) use.Publish = true; else use.Subscribe = true;
            if (!knownChannels.ContainsKey(channel.Name)) RegisterChannel(channel);
        }

        public void RegisterChannel(Channel channel) {
            if (channel.Name.StartsWith("@")) return;
            knownChannels[channel.Name] = channel;
            if (!usedChannels.ContainsKey(channel.Name)) usedChannels[channel.Name] = new ChannelUse();
            ChannelUse use = usedChannels[channel.Name];
            use.Channel = channel;
            if (IsConnected && !Incognito) {
                Publish(RTIChannel.Channels, new Channels { Channel = channel });
            }
        }

        private void DiscoverChannel(Channel channel) {
            if (!knownChannels.ContainsKey(channel.Name)) {
                knownChannels[channel.Name] = channel;
            } else {
                var known = knownChannels[channel.Name];
                if (!string.IsNullOrEmpty(channel.DataType) && string.IsNullOrEmpty(known.DataType)) known.DataType = channel.DataType;
                if (channel.Ephemeral) known.Ephemeral = true;
                if (channel.State) known.State = true;
                if (channel.FirstFieldId) known.FirstFieldId = true;
            }
        }

        public void RegisterMeasure(Measure measure) {
            measure.Application = Application;
            usedMeasures[measure.Id] = measure;
            if (!knownMeasures.ContainsKey(measure.Id)) {
                knownMeasures[measure.Id] = measure;
                if (IsConnected && !Incognito) Publish(RTIChannel.Measures, new Measures { Measure = measure });
            }
        }

        public void Measure(string measureId, float value) {
            usedMeasures.TryGetValue(measureId, out Measure measure);
            if (measure == null) knownMeasures.TryGetValue(measureId, out measure);
            if (measure == null) measure = new Measure { Id = measureId, Application = Application };
            Measure(measure, value);
        }

        public void Measure(Measure measure, float value) {
            if (!usedMeasures.ContainsKey(measure.Id)) RegisterMeasure(measure);
            if (measure.Interval > 1e-5) {
                if (collectMeasurementsTask == null) StartCollectMeasurementsThread();
                lock (collectQueue) {
                    if (!collectQueue.ContainsKey(measure)) collectQueue[measure] = new Queue<float>();
                    collectQueue[measure].Enqueue(value);
                }
            } else {
                var measurement = new Measurement {
                    MeasureId = measure.Id,
                    ClientId = ClientId,
                };
                var channel = RTIChannel.Measurement;
                if (!string.IsNullOrWhiteSpace(measure.Channel)) channel = measure.Channel;
                measurement.Value = value;
                if (IsConnected) Publish(channel, measurement);
            }
        }

        private void StartCollectMeasurementsThread() {
            collectMeasurementsTask = Task.Run(() => {
                while (IsConnected) {
                    Thread.Sleep(100);
                    lock (collectQueue) {
                        foreach (var item in collectQueue) {
                            var measure = item.Key;
                            var queue = item.Value;
                            if (!lastCollect.ContainsKey(measure)) {
                                lastCollect[measure] = DateTime.Now;
                            } else if ((DateTime.Now - lastCollect[measure]).TotalSeconds * MeasurementIntervalTimeScale > measure.Interval) {
                                var measurement = new Measurement {
                                    MeasureId = measure.Id,
                                    ClientId = ClientId,
                                };
                                var channel = RTIChannel.Measurement;
                                if (!string.IsNullOrWhiteSpace(measure.Channel)) channel = measure.Channel;
                                if (queue.Count == 1) {
                                    measurement.Value = queue.Dequeue();
                                    Publish(channel, measurement);
                                } else if (queue.Count > 1) {
                                    var window = new Measurement.Types.Window { Max = float.MinValue, Min = float.MaxValue };
                                    while (queue.Count > 0) {
                                        float value = queue.Dequeue();
                                        window.Count++;
                                        window.Mean += value;
                                        if (value > window.Max) window.Max = value;
                                        if (value < window.Min) window.Min = value;
                                    }
                                    if (window.Count > 0) window.Mean /= window.Count;
                                    window.Duration = (float)(DateTime.Now - lastCollect[measure]).TotalSeconds * MeasurementIntervalTimeScale;
                                    measurement.Window = window;
                                    Publish(channel, measurement);
                                }
                                lastCollect[measure] = DateTime.Now;
                            }
                        }
                    }
                }
                collectMeasurementsTask = null;
            });
        }

        private void StartPingTimeoutThread() {
            pingTimeoutTask = Task.Run(() => {
                while (IsConnected && shouldBeConnected) {
                    Thread.Sleep(1000);
                    if (PingTimeout > 0 && (DateTime.Now - LastPing).TotalMilliseconds > PingTimeout) {
                        OnError?.Invoke("connection", new RTIConnectionFailure("Ping timeout"));
                        try {
                            socket.Disconnect();
                            socket.Dispose();
                        } catch (Exception) { }
                        Thread.Sleep(100);
                        Connect();
                        break;
                    }
                }
                pingTimeoutTask = null;
            });
        }

    }

    public delegate void UntypedListener(string channelName, object data);
    public delegate void TypedListener<T>(string channelName, T message);
    public delegate void TypedIdListener<T>(string channelName, string entityId, T message);
    public delegate void ErrorListener(string name, Exception e);
    public delegate void RPCListener(object data);

    public class RTIConnectionFailure : Exception {
        public RTIConnectionFailure(string message) : base(message) { }
    }

    public delegate void TokenVerificationListener(TokenVerificationResult result);
    public class TokenVerificationResult {
        public string Application;
        public string ClientId;
        public string ClientLibraryVersion;
        public string User;
        public string Participant;
        public string FullName;
        public string Role;

        public ErrorResult Error;

        public class ErrorResult {
            public string Name;
            public string Message;
        }
    }

}
