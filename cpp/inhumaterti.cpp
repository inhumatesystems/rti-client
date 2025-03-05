#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#pragma comment(lib, "ws2_32")
#include <WinSock2.h>
#else
#include <unistd.h>
#endif

#define ASIO_STANDALONE
#define _WEBSOCKETPP_CPP11_RANDOM_DEVICE_
#define _WEBSOCKETPP_CPP11_TYPE_TRAITS_
#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>
typedef websocketpp::client<websocketpp::config::asio_client> client;
typedef websocketpp::client<websocketpp::config::asio_tls_client> client_tls;
typedef websocketpp::lib::shared_ptr<websocketpp::lib::asio::ssl::context> context_ptr;
typedef websocketpp::connection_hdl connection_hdl_t;
typedef client::message_ptr message_ptr_t;
#define INHUMATE_RTI_INTERNAL_CLIENT_TYPES

#include "inhumaterti.hpp"
#include "json.hpp"

#include <algorithm> //for std::generate_n
#include <chrono>
#include <cstdint>
#include <functional> //for std::function
#include <iostream>
#include <random>
#include <thread>
#include <vector>
#include <limits>

using websocketpp::lib::bind;
using websocketpp::lib::placeholders::_1;
using websocketpp::lib::placeholders::_2;

using namespace inhumate::rti::proto;

namespace inhumate
{
namespace rti
{

// Forward declarations
std::string random_string(size_t length);
uint64_t timeSinceEpochMs();

RTIClient::RTIClient(const std::string &inApplication,
         const bool autoConnect,
         const std::string &inUrl,
         const std::string &inFederation,
         const std::string &inSecret,
         const std::string &inUser,
         const std::string &inPassword,
         const std::string &inClientId)
{
    _url = inUrl;
    if (_url.empty()) {
        char *envUrl = std::getenv("RTI_URL");
        if (envUrl) _url = envUrl;
    }
    if (_url.empty()) _url = RTI_DEFAULT_URL;
    if (_url.find("ws://") != 0 && _url.find("wss://") != 0) {
        if (_url.find("localhost") == 0 || _url.find("127.") == 0) _url = "ws://" + _url;
        else _url = "wss://" + _url;
    }

    _application = inApplication;

    _federation = inFederation;
    if (_federation.empty()) {
        char *envFederation = std::getenv("RTI_FEDERATION");
        if (envFederation) _federation = envFederation;
    }
    // slashes quietly not allowed in federation id
    if (!_federation.empty()) {
        std::replace(_federation.begin(), _federation.end(), '/', '_');
    }

    if (clientId.empty()) clientId = inClientId;
    if (clientId.empty()) clientId = random_string(36);

    char *envSecret = std::getenv("RTI_SECRET");
    if (envSecret) secret = envSecret;
    if (secret.empty()) secret = inSecret;

    _user = inUser;
    _password = inPassword;

    char *envHost = std::getenv("RTI_HOST");
    if (envHost) _host = envHost;
    if (_host.empty()) {
        envHost = std::getenv("COMPUTERNAME");
        if (envHost) _host = envHost;
    }
    if (_host.empty()) {
        envHost = std::getenv("HOSTNAME");
        if (envHost) _host = envHost;
    }
    if (_host.empty()) {
        char host[256];
        host[0] = host[255] = '\0';
        gethostname(host,255);
        _host = host;
        if (_host.find(".") >= 0) _host = _host.substr(0, _host.find("."));
    }

    char *envStation = std::getenv("RTI_STATION");
    if (envStation) _station = envStation;

    // TODO a better way to support both secure and non-secure sockets?
    // https://github.com/zaphoyd/websocketpp/issues/706
    // https://github.com/barsnick/websocketpp/pull/1/files
    websocketpp::lib::error_code ec;
    if (_url.rfind("wss://", 0) == 0) {
        wsclient.reset();
        wsclient_tls = std::unique_ptr<client_tls>(new client_tls());
        wsclient_tls->set_access_channels(websocketpp::log::alevel::none);
        wsclient_tls->set_error_channels(websocketpp::log::alevel::none);
        wsclient_tls->init_asio(ec);
        wsclient_tls->set_open_handler(bind(&RTIClient::OnOpen, this, ::_1));
        wsclient_tls->set_message_handler(bind(&RTIClient::OnMessage, this, ::_1, ::_2));
        wsclient_tls->set_tls_init_handler([](websocketpp::connection_hdl) {
            context_ptr ctx = websocketpp::lib::make_shared<asio::ssl::context>(asio::ssl::context::sslv23);
            try {
                ctx->set_options(asio::ssl::context::default_workarounds | asio::ssl::context::no_sslv2 |
                                 asio::ssl::context::no_sslv3 | asio::ssl::context::single_dh_use);
                ctx->set_verify_mode(asio::ssl::verify_none);
                // TODO proper certificate verification
                // ctx->set_verify_mode(boost::asio::ssl::verify_peer);
                // ctx->set_verify_callback(bind(&verify_certificate, hostname, ::_1, ::_2));
                // ctx->load_verify_file("ca-chain.cert.pem");
            } catch (std::exception &e) {
                std::cout << e.what() << std::endl;
            }
            return ctx;
        });
    } else {
        wsclient_tls.reset();
        wsclient = std::unique_ptr<client>(new client());
        wsclient->set_access_channels(websocketpp::log::alevel::none);
        wsclient->set_error_channels(websocketpp::log::alevel::none);
        wsclient->init_asio(ec);
        wsclient->set_open_handler(bind(&RTIClient::OnOpen, this, ::_1));
        wsclient->set_message_handler(bind(&RTIClient::OnMessage, this, ::_1, ::_2));
    }
    if (ec) {
        for (auto callback : errorcallbacks)
            if (callback) (*callback)("connect", ec.message());
    }

    shouldBeConnected = false;
    connectCalled = false;
    firstConnected = false;

    Subscribe<Clients>(CLIENTS_CHANNEL, bind(&RTIClient::OnClients, this, ::_1, ::_2));
    Subscribe<Channels>(CHANNELS_CHANNEL, bind(&RTIClient::OnChannels, this, ::_1, ::_2));
    Subscribe<Measures>(MEASURES_CHANNEL, bind(&RTIClient::OnMeasures, this, ::_1, ::_2));

    if (autoConnect) Connect();
}

RTIClient::~RTIClient()
{
    wsclient.reset();
    wsclient_tls.reset();
}

void RTIClient::Connect()
{
    connectTime = timeSinceEpochMs();
    lastPingTime = timeSinceEpochMs();
    cid = 0;
    lastReconnectTime = 0;
    connectCalled = true;
    connectionPhase = ConnectionPhase::CONNECTING;

    websocketpp::lib::error_code ec;
    if (wsclient_tls) {
        client_tls::connection_ptr con = wsclient_tls->get_connection(_url, ec);
        if (!ec) {
            wsclient_tls->connect(con);
            connection_hdl = con->get_handle();
        }
    } else {
        websocketpp::lib::error_code ec;
        client::connection_ptr con = wsclient->get_connection(_url, ec);
        if (!ec) {
            wsclient->connect(con);
            connection_hdl = con->get_handle();
        }
    }
    if (ec) {
        connection_hdl.reset();
        for (auto callback : errorcallbacks)
            if (callback) (*callback)("connection", ec.message());
    }
}

void RTIClient::Disconnect()
{
    if (wsclient_tls) {
        wsclient_tls->close(connection_hdl, websocketpp::close::status::normal, "");
        wsclient_tls->poll();
    } else {
        wsclient->close(connection_hdl, websocketpp::close::status::normal, "");
        wsclient->poll();
    }
    connection_hdl.reset();
    lastPingTime = 0;
    lastReconnectTime = 0;
    connectCalled = false;
    shouldBeConnected = false;
    firstConnected = false;
    connectionPhase = ConnectionPhase::DISCONNECTED;
    for (auto callback : disconnectcallbacks)
        if (callback) (*callback)();
}

connectcallback_p RTIClient::OnConnected(connectcallback_t callback)
{
    connectcallback_p ptr(new connectcallback_t(std::move(callback)));
    connectcallbacks.push_back(ptr);
    return ptr;
}

void RTIClient::OffConnected(connectcallback_p callback)
{
    connectcallbacks.erase(std::remove(connectcallbacks.begin(), connectcallbacks.end(), callback), connectcallbacks.end());
    callback.reset();
}

connectcallback_p RTIClient::OnFirstConnect(connectcallback_t callback)
{
    connectcallback_p ptr(new connectcallback_t(std::move(callback)));
    firstconnectcallbacks.push_back(ptr);
    return ptr;
}

void RTIClient::OffFirstConnect(connectcallback_p callback)
{
    firstconnectcallbacks.erase(std::remove(firstconnectcallbacks.begin(), firstconnectcallbacks.end(), callback), firstconnectcallbacks.end());
    callback.reset();
}

disconnectcallback_p RTIClient::OnDisconnected(disconnectcallback_t callback)
{
    connectcallback_p ptr(new disconnectcallback_t(std::move(callback)));
    disconnectcallbacks.push_back(ptr);
    return ptr;
}

void RTIClient::OffDisconnected(disconnectcallback_p callback)
{
    disconnectcallbacks.erase(std::remove(disconnectcallbacks.begin(), disconnectcallbacks.end(), callback), disconnectcallbacks.end());
    callback.reset();
}

errorcallback_p RTIClient::OnError(errorcallback_t callback)
{
    errorcallback_p ptr(new errorcallback_t(std::move(callback)));
    errorcallbacks.push_back(ptr);
    return ptr;
}

void RTIClient::OffError(errorcallback_p callback)
{
    errorcallbacks.erase(std::remove(errorcallbacks.begin(), errorcallbacks.end(), callback), errorcallbacks.end());
    callback.reset();
}

void RTIClient::Publish(const std::string &channelName, const std::string &message, const bool registerChannel)
{
    if (registerChannel) RegisterChannelUsage(channelName, true);
    nlohmann::json json;
    json["event"] = "#publish";
    json["data"] = { 
        { "channel", !_federation.empty() && channelName[0] != '@' ? "//" + _federation + "/" + channelName : channelName }, 
        { "data", message } 
    };
    Send(json.dump());
}

void RTIClient::Publish(const std::string &channelName, const google::protobuf::Message &message, const bool registerChannel)
{
#if GOOGLE_PROTOBUF_VERSION < 3011000
    auto size = message.ByteSize();
#else
    auto size = message.ByteSizeLong();
#endif
    unsigned char *buf = (unsigned char*) malloc(size+1);
    if (buf) {
        if (message.SerializeToArray(buf, size)) {
            auto content = base64_encode(buf, size);
            Publish(channelName, content);
        } else {
            for (auto callback : errorcallbacks)
                if (callback) (*callback)(channelName, "failed to serialize");
        }
        free(buf);
    } else {
        for (auto callback : errorcallbacks)
            if (callback) (*callback)(channelName, "failed to allocate memory for serialization");
    }
}

messagecallback_p RTIClient::Subscribe(const std::string &channelName, messagecallback_t callback, const bool registerChannel)
{
    if (connected()) Subscribe(channelName);
    messagecallback_p ptr(new messagecallback_t(std::move(callback)));
    subscriptions[channelName].push_back(ptr);
    if (registerChannel) RegisterChannelUsage(channelName, false);
    return ptr;
}

void RTIClient::Unsubscribe(const std::string &channelName)
{
    subscriptions[channelName].clear();
    auto use = find_used_channel(channelName);
    if (use != usedChannels.end()) usedChannels.erase(use);
    if (connected()) {
        nlohmann::json json;
        json["event"] = "#unsubscribe";
        json["data"] = channelName;
        Send(json.dump());
    }
}

void RTIClient::Unsubscribe(messagecallback_p callback)
{
    if (!callback) return;
    for (subscriptionmap_t::iterator mapit = subscriptions.begin(); mapit != subscriptions.end(); mapit++) {
        auto& channel = mapit->first;
        auto& callbacks = mapit->second;
        auto callit = std::find(callbacks.begin(), callbacks.end(), callback);
        if (callit != callbacks.end()) {
            if (callbacks.size() <= 1) {
                Unsubscribe(channel);
            } else {
                callbacks.erase(callit);
            }
            callback.reset();
            break;
        }
    }
}

std::size_t RTIClient::Poll()
{
    if (!connectCalled) return 0;

    std::size_t ret;
    if (wsclient_tls)
        ret = wsclient_tls->poll_one();
    else
        ret = wsclient->poll_one();

    if (connectionPhase >= ConnectionPhase::CONNECTING && !shouldBeConnected && timeSinceEpochMs() - connectTime > 5000) {
        shouldBeConnected = true;
    }

    if (shouldBeConnected) {
        bool closed = false;
        if (connection_hdl.expired())
            closed = true;
        else if (wsclient_tls)
            closed = wsclient_tls->get_con_from_hdl(connection_hdl)->get_state() !=
                     websocketpp::session::state::open;
        else
            closed = wsclient->get_con_from_hdl(connection_hdl)->get_state() !=
                     websocketpp::session::state::open;
        if (closed) {
            if (connectionPhase >= ConnectionPhase::CONNECTING) {
                connectionPhase = ConnectionPhase::DISCONNECTED;
                if (wsclient_tls)
                    wsclient_tls->reset();
                else if (wsclient)
                    wsclient->reset();
                for (auto callback : disconnectcallbacks)
                    if (callback) (*callback)();
                lastReconnectTime = timeSinceEpochMs();
            }
            if (timeSinceEpochMs() - lastReconnectTime > 2000) {
                lastReconnectTime = timeSinceEpochMs();
                Connect();
            }
        } else {
            auto now = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::milliseconds>(now - lastCollectCheck).count() > 100) {
                lastCollectCheck = now;
                CollectMeasurements();
            }
            if (lastPingTime > 0 && connectionPhase >= ConnectionPhase::CONNECTING && timeSinceEpochMs() - lastPingTime > 20000) {
                for (auto callback : errorcallbacks)
                    if (callback) (*callback)("connection", "Ping timeout");
                Disconnect();
                Connect();
            } else if (lastReconnectTime > 0 && connectionPhase < ConnectionPhase::CONNECTED && timeSinceEpochMs() - lastReconnectTime > 5000) {
                for (auto callback : errorcallbacks)
                    if (callback) (*callback)("connection", "Reconnect timeout");
                Disconnect();
                Connect();

            }
        }
    }
    return ret;
}

void RTIClient::PollForever()
{
    while (true) {
        Poll();
#ifndef INHUMATE_UE5_BUILD
        // windows ue5 build: error LNK2019: unresolved external symbol _Thrd_sleep_for
        // shouldn't be used in ue5 anyway
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
#endif
    }
}

void RTIClient::set_state(const RuntimeState newState)
{
    if (newState != _state) {
        _state = newState;
        if (connected()) PublishClient();
    }
}

void RTIClient::PublishClient()
{
    Clients message;
    Client *client = new Client();
    client->set_id(clientId);
    client->set_application(_application);
    client->set_state(_state);
    client->set_application_version(applicationVersion);
    client->set_engine_version(engineVersion);
    client->set_integration_version(integrationVersion);
    client->set_client_library_version(RTI_CLIENT_VERSION);
    client->set_host(_host);
    client->set_station(_station);
    client->set_user(_user);
    client->set_participant(_participant);
    client->set_role(_role);
    client->set_full_name(_fullName);
    for (auto capability : _capabilities) client->add_capabilities(capability);
    message.set_allocated_client(client);
    Publish(CLIENTS_CHANNEL, message);
}

void RTIClient::PublishMeasures()
{
    for (auto kv : usedMeasures) {
        Measures message;
        message.set_allocated_measure(new proto::Measure(kv.second));
        Publish(MEASURES_CHANNEL, message);
    }
}

void RTIClient::PublishError(const std::string &message)
{
    PublishError(message, _state);
}

void RTIClient::PublishError(const std::string &content, const proto::RuntimeState state)
{
    RuntimeControl message;
    RuntimeControl_Error *error = new RuntimeControl_Error();
    error->set_client_id(clientId);
    error->set_state(state);
    error->set_message(content);
    message.set_allocated_error(error);
    if (connected()) Publish(CONTROL_CHANNEL, message);
}

void RTIClient::PublishHeartbeat()
{
    Clients message;
    ClientHeartbeat *hbt = new ClientHeartbeat();
    hbt->set_client_id(clientId);
    message.set_allocated_heartbeat(hbt);
    if (connected()) Publish(CLIENTS_CHANNEL, message);
}

void RTIClient::PublishProgress(const unsigned int progress)
{
    Clients message;
    ClientProgress *prg = new ClientProgress();
    prg->set_client_id(clientId);
    prg->set_progress(progress);
    message.set_allocated_progress(prg);
    if (connected()) Publish(CLIENTS_CHANNEL, message);
}

void RTIClient::PublishValue(const std::string &value, const bool highlight, const bool error)
{
    Clients message;
    ClientValue *val = new ClientValue();
    val->set_client_id(clientId);
    val->set_value(value);
    val->set_highlight(highlight);
    val->set_error(error);
    message.set_allocated_value(val);
    if (connected()) Publish(CLIENTS_CHANNEL, message);
}

std::vector<Client> RTIClient::known_clients()
{
    std::vector<Client> clients;
    for (auto kv : knownClients) clients.push_back(kv.second);
    return clients;
}

std::vector<Measure> RTIClient::known_measures()
{
    std::vector<proto::Measure> measures;
    for (auto kv : knownMeasures) measures.push_back(kv.second);
    return measures;
}

void RTIClient::RegisterChannel(const proto::Channel& channel) {
    if (channel.name() == "") return;
    if (channel.name()[0] == '@') return;

    auto existing = find_channel(channel.name());
    if (existing != knownChannels.end()) knownChannels.erase(existing);
    knownChannels.push_back(channel);

    auto use = find_used_channel(channel.name());
    if (use == usedChannels.end()) {
        ChannelUse newUse;
        newUse.set_allocated_channel(new Channel(channel));
        usedChannels.push_back(newUse);
    } else {
        use->set_allocated_channel(new Channel(channel));
    }

    if (connected()) {
        Channels message;
        message.set_allocated_channel(new Channel(channel));
        Publish(CHANNELS_CHANNEL, message);
    }
}

void RTIClient::RegisterMeasure(const proto::Measure& measure) {
    proto::Measure usedMeasure(measure);
    usedMeasure.set_application(_application);
    usedMeasures[usedMeasure.id()] = usedMeasure;
    if (knownMeasures.find(measure.id()) == knownMeasures.end()) {
        knownMeasures[usedMeasure.id()] = usedMeasure;
        if (connected()) {
            Measures message;
            message.set_allocated_measure(new proto::Measure(usedMeasure));
            Publish(MEASURES_CHANNEL, message);
        }
    }
}

void RTIClient::Measure(const std::string &measureId, const float value) {
    if (usedMeasures.find(measureId) != usedMeasures.end()) return Measure(usedMeasures[measureId], value);
    if (knownMeasures.find(measureId) != knownMeasures.end()) return Measure(knownMeasures[measureId], value);
    proto::Measure measure;
    measure.set_id(measureId);
    measure.set_application(_application);
    Measure(measure, value);
}

void RTIClient::Measure(const proto::Measure &measure, const float value) {
    if (usedMeasures.find(measure.id()) == usedMeasures.end()) RegisterMeasure(measure);
    if (measure.interval() > 1e-5f) {
        if (collectQueue.find(measure.id()) == collectQueue.end()) {
            collectQueue[measure.id()] = std::unique_ptr<std::queue<float>>(new std::queue<float>());
        }
        collectQueue[measure.id()]->push(value);
    } else {
        Measurement measurement;
        measurement.set_measure_id(measure.id());
        measurement.set_client_id(clientId);
        measurement.set_value(value);
        auto channel = !measure.channel().empty() ? measure.channel() : MEASUREMENT_CHANNEL;
        Publish(channel, measurement);
    }
}

void RTIClient::Transmit(const std::string &eventName, const std::string &data) {
    nlohmann::json message;
    message["event"] = eventName;
    message["data"] = data;
    Send(message.dump());
}

void RTIClient::Invoke(const std::string &method, const std::string &data, const stringcallback_t callback) {
    auto cid = ++this->cid;
    stringcallback_p ptr(new stringcallback_t(std::move(callback)));
    rpcCallbacks[cid] = ptr;
    nlohmann::json json;
    json["event"] = method;
    json["data"] = data;
    json["cid"] = cid;
    Send(json.dump());
}

void RTIClient::Invoke(const std::string &method, const std::string &data, const stringcallback_t callback, const stringcallback_t errorCallback) {
    auto cid = ++this->cid;
    stringcallback_p ptr(new stringcallback_t(std::move(callback)));
    rpcCallbacks[cid] = ptr;
    stringcallback_p errorPtr(new stringcallback_t(std::move(errorCallback)));
    rpcErrorCallbacks[cid] = errorPtr;
    nlohmann::json json;
    json["event"] = method;
    json["data"] = data;
    json["cid"] = cid;
    Send(json.dump());
}

void RTIClient::OnOpen(websocketpp::connection_hdl hdl)
{
    nlohmann::json json;
    json["event"] = "#handshake";
    json["cid"] = ++cid;
    Send(json.dump());
    shouldBeConnected = true;
}

void RTIClient::OnMessage(websocketpp::connection_hdl hdl, client::message_ptr msg)
{
    std::string message = msg->get_payload();

    if (message == "") {
        Send("");
        lastPingTime = timeSinceEpochMs();
    } else if (message == "#1") {
        Send("#2");
        lastPingTime = timeSinceEpochMs();
    } else if (message.rfind("{", 0) == 0) {
        auto json_in = nlohmann::json::parse(message);
        if (json_in.contains("rid") && json_in["rid"] == 1) {
            SendAuthToken();
            connectionPhase = ConnectionPhase::AUTHENTICATING;
        } else if (json_in.contains("event") && json_in["event"] == "#setAuthToken") {
            lastPingTime = timeSinceEpochMs();
            if (connectionPhase != ConnectionPhase::CONNECTED) {
                auto first = !firstConnected;
                firstConnected = true;
                connectionPhase = ConnectionPhase::CONNECTED;
                if (first) {
                    for (auto callback : firstconnectcallbacks)
                    if (callback) (*callback)();
                }
                for (auto callback : connectcallbacks)
                    if (callback) (*callback)();
                PublishClient();
                PublishMeasures();
            }
            for (auto kv : subscriptions) if (kv.second.size() > 0) Subscribe(kv.first);
        } else if (json_in.contains("event") && json_in["event"] == "#removeAuthToken") {
            SendAuthToken();
        } else if (json_in.contains("event") && json_in["event"] == "#publish") {
            auto channel = json_in["data"]["channel"].get<std::string>();
            if (!_federation.empty() && channel.rfind("//" + _federation + "/", 0) == 0) channel = channel.substr(_federation.length()+1);
            auto data = json_in["data"]["data"].get<std::string>();
            if (subscriptions.find(channel) != subscriptions.end()) {
                auto &callbacks = subscriptions[channel];
                for (auto callback : callbacks) {
                    try {
                        if (callback) (*callback)(channel, data);
                    } catch (std::exception &e) {
                        for (auto errorcb : errorcallbacks)
                            if (errorcb) (*errorcb)(channel, e.what());
                    } catch (...) {
                        for (auto errorcb : errorcallbacks)
                            if (errorcb) (*errorcb)(channel, "caught something");
                    }
                }
            }
        } else if (json_in.contains("event")) {
            auto event = json_in["event"].get<std::string>();
            auto data = json_in["data"];
            if (event == "fail") {
                shouldBeConnected = false;
                for (auto errorcb : errorcallbacks)
                    if (errorcb) (*errorcb)("fail", data);
            } else if (event == "broker-version" && data.is_string()) {
                brokerVersion = data.dump();
            } else if (event == "ping") {
                Transmit("pong", data.dump());
            }
        } else if (json_in.contains("rid")) {
            auto rid = json_in["rid"].get<int>();
            if (json_in.contains("error")) {
                if (rpcErrorCallbacks.find(rid) != rpcErrorCallbacks.end()) {
                    auto callback = rpcErrorCallbacks[rid];
                    if (callback) (*callback)(json_in["error"].is_string() ? json_in["error"].get<std::string>() : json_in["error"].dump());
                } else {
                    for (auto errorcb : errorcallbacks)
                        if (errorcb) (*errorcb)("rpc", json_in["error"].is_string() ? json_in["error"].get<std::string>() : json_in["error"].dump());
                }
            } else {
                if (rpcCallbacks.find(rid) != rpcCallbacks.end()) {
                    auto callback = rpcCallbacks[rid];
                    if (callback) (*callback)(json_in["data"].is_string() ? json_in["data"].get<std::string>() : json_in["data"].dump());
                }
            }
            if (rpcCallbacks.find(rid) != rpcCallbacks.end()) rpcCallbacks.erase(rid);
            if (rpcErrorCallbacks.find(rid) != rpcErrorCallbacks.end()) rpcErrorCallbacks.erase(rid);
        }
    }
}

void RTIClient::OnClients(const std::string &channelName, const Clients &message)
{
    if (message.which_case() == Clients::WhichCase::kRequestClients) {
        PublishClient();
    } else if (message.which_case() == Clients::WhichCase::kClient) {
        knownClients[message.client().id()] = message.client();
    } else if (message.which_case() == Clients::WhichCase::kRegisterParticipant) {
        auto& reg = message.register_participant();
        if ((reg.client_id().empty() || reg.client_id() == clientId)
            && (reg.host().empty() || reg.host() == _host) && (reg.station().empty() || reg.station() == _station)
            && (reg.participant() != _participant || reg.role() != _role || reg.full_name() != _fullName)) {
                _participant = reg.participant();
                _role = reg.role();
                _fullName = reg.full_name();
                PublishClient();
            }
    }
}

void RTIClient::OnChannels(const std::string &channelName, const Channels &message)
{
    if (message.which_case() == Channels::WhichCase::kRequestChannelUsage) {
        Channels message;
        auto usage = new ChannelUsage();
        usage->set_client_id(clientId);
        for (auto used = usedChannels.begin(); used != usedChannels.end(); used++) {
            auto use = usage->add_usage();
            use->CopyFrom(*used);
        }
        message.set_allocated_channel_usage(usage);
        Publish(CHANNELS_CHANNEL, message);
    } else if (message.which_case() == Channels::WhichCase::kChannelUsage) {
        for (auto use : message.channel_usage().usage()) {
            DiscoverChannel(use.channel());
        }
    } else if (message.which_case() == Channels::WhichCase::kChannel) {
        DiscoverChannel(message.channel());
    }
}

void RTIClient::OnMeasures(const std::string &channelName, const Measures &message)
{
    if (message.which_case() == Measures::WhichCase::kRequestMeasures) {
        PublishMeasures();
    } else if (message.which_case() == Measures::WhichCase::kMeasure) {
        knownMeasures[message.measure().id()] = message.measure();
    }
}

void RTIClient::RegisterChannelUsage(const std::string &channelName, const bool usePublish, const std::string &typeName)
{
    if (channelName == "") return;
    if (channelName[0] == '@') return;
    Channel channel;
    channel.set_name(channelName);
    channel.set_data_type(typeName);
    auto known = find_channel(channelName);
    auto use = find_used_channel(channelName);
    if (use == usedChannels.end()) {
        ChannelUse newUse;
        newUse.set_allocated_channel(new Channel(known != knownChannels.end() ? *known : channel));
        if (usePublish) newUse.set_publish(true); else newUse.set_subscribe(true);
        usedChannels.push_back(newUse);
    } else {
        if (usePublish) use->set_publish(true); else use->set_subscribe(true);
    }
    if (known == knownChannels.end()) RegisterChannel(channel);
}

void RTIClient::DiscoverChannel(const proto::Channel &channel) {
    if (channel.name() == "") return;
    if (channel.name()[0] == '@') return;
    auto known = find_channel(channel.name());
    if (known == knownChannels.end()) {
        knownChannels.push_back(channel);
    } else {
        if (!channel.data_type().empty() && known->data_type().empty()) known->set_data_type(channel.data_type());
        if (channel.ephemeral()) known->set_ephemeral(true);
        if (channel.state()) known->set_state(true);
        if (channel.first_field_id()) known->set_first_field_id(true);
    }
}

void RTIClient::Subscribe(const std::string &channelName)
{
    nlohmann::json json;
    json["event"] = "#subscribe";
    json["data"] = { { "channel", !_federation.empty() ? "//" + _federation + "/" + channelName : channelName } };
    json["cid"] = ++cid;
    Send(json.dump());
}

void RTIClient::SendAuthToken()
{
    nlohmann::json authToken;
    authToken["clientId"] = clientId;
    authToken["clientLibraryVersion"] = RTI_CLIENT_VERSION;
    authToken["application"] = _application;
    if (!_federation.empty()) authToken["federation"] = _federation;
    if (!secret.empty()) authToken["secret"] = secret;
    if (!_user.empty()) authToken["user"] = _user;
    if (!_password.empty()) authToken["password"] = _password;
    nlohmann::json json;
    json["event"] = "auth";
    json["data"] = authToken;
    Send(json.dump());
}

void RTIClient::Send(const std::string &content)
{
    if (wsclient_tls)
        wsclient_tls->send(connection_hdl, content, websocketpp::frame::opcode::text);
    else
        wsclient->send(connection_hdl, content, websocketpp::frame::opcode::text);
}

void RTIClient::CollectMeasurements() {
    auto it = collectQueue.begin();
    while (it != collectQueue.end()) {
        auto& measure_id = it->first;
        auto& queue = it->second;
        it++;
        auto now = std::chrono::steady_clock::now();
        if (lastCollect.find(measure_id) == lastCollect.end()) {
            lastCollect[measure_id] = now;
        } else {
            auto& measure = knownMeasures[measure_id];
            auto timePassed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastCollect[measure_id]).count() * measurementIntervalTimeScale;
            if (timePassed / 1000.f > measure.interval()) {
                Measurement measurement;
                measurement.set_measure_id(measure.id());
                measurement.set_client_id(clientId);
                auto channel = !measure.channel().empty() ? measure.channel() : MEASUREMENT_CHANNEL;
                if (queue->size() == 1) {
                    measurement.set_value(queue->front());
                    queue->pop();
                    Publish(channel, measurement);
                } else if (queue->size() > 1) {
                    auto window = new proto::Measurement_Window();
                    window->set_max(std::numeric_limits<float>::min());
                    window->set_min(std::numeric_limits<float>::max());
                    while (!queue->empty()) {
                        auto value = queue->front();
                        queue->pop();
                        window->set_count(window->count() + 1);
                        window->set_mean(window->mean() + value);
                        if (value > window->max()) window->set_max(value);
                        if (value < window->min()) window->set_min(value);
                    }
                    if (window->count() > 0) window->set_mean(window->mean() / window->count());
                    window->set_duration(timePassed / 1000.f);
                    measurement.set_allocated_window(window);
                    Publish(channel, measurement);
                }
                lastCollect[measure_id] = now;
            }
        }
    }
}

// Instead of a proper UUID...
std::string random_string(size_t length)
{
    auto randchar = []() -> char {
        const char charset[] = "0123456789"
                               "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                               "abcdefghijklmnopqrstuvwxyz";
        const size_t max_index = (sizeof(charset) - 1);
        return charset[rand() % max_index];
    };
    std::string str(length, 0);
    std::generate_n(str.begin(), length, randchar);
    return str;
}

uint64_t timeSinceEpochMs()
{
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

} // namespace rti
} // namespace inhumate
