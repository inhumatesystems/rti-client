
// Style guide: https://google.github.io/styleguide/cppguide.html
// Conforming to Google's style guide because of protobuf dependency,
// and it plays fairly well with Unreal Engine ditto.

#ifndef __INHUMATE_RTI_H__
#define __INHUMATE_RTI_H__

#if defined(_MSC_VER)
#pragma warning(disable : 4251)
#pragma warning(disable : 4800)
#pragma warning(disable : 4946)
#endif

#if defined(WIN32) && defined(INHUMATE_RTI_SHARED)
#define PROTOBUF_USE_DLLS 1
#if defined(inhumaterti_shared_EXPORTS)
#define INHUMATE_RTI_EXPORT __declspec(dllexport)
#else
#define INHUMATE_RTI_EXPORT __declspec(dllimport)
#endif
#define INHUMATE_RTI_PROTOS_EXPORT __declspec(dllimport)
#else
#define INHUMATE_RTI_EXPORT
#define INHUMATE_RTI_PROTOS_EXPORT
#endif

#include <chrono>
#include <functional>
#include <queue>
#include <string>
#include <unordered_map>
#include <vector>

#include <google/protobuf/message.h>

// Hide real types (which are private anyway) so that we avoid header dependency hell
#ifndef INHUMATE_RTI_INTERNAL_CLIENT_TYPES
typedef void client;
typedef void client_tls;
typedef std::weak_ptr<void> connection_hdl_t;
typedef std::shared_ptr<void> message_ptr_t;
#endif

#include "Channels.pb.h"
#include "Clients.pb.h"
#include "Commands.pb.h"
#include "Entity.pb.h"
#include "EntityOperation.pb.h"
#include "EntityPosition.pb.h"
#include "Geometry.pb.h"
#include "GeometryOperation.pb.h"
#include "Injectable.pb.h"
#include "InjectableOperation.pb.h"
#include "Injection.pb.h"
#include "InjectionOperation.pb.h"
#include "Measurement.pb.h"
#include "Measures.pb.h"
#include "Parameter.pb.h"
#include "RuntimeControl.pb.h"
#include "Scenarios.pb.h"

namespace inhumate
{
namespace rti
{

constexpr auto RTI_CLIENT_VERSION = "0.0.1-dev-version";
constexpr auto RTI_DEFAULT_URL = "ws://localhost:8000/";
constexpr auto CONTROL_CHANNEL = "rti/control";
constexpr auto CHANNELS_CHANNEL = "rti/channels";
constexpr auto CLIENTS_CHANNEL = "rti/clients";
constexpr auto ENTITY_OPERATION_CHANNEL = "rti/entities";
constexpr auto ENTITY_CHANNEL = "rti/entity";
constexpr auto POSITION_CHANNEL = "rti/position";
constexpr auto SCENARIOS_CHANNEL = "rti/scenarios";
constexpr auto LAUNCH_CONFIGURATIONS_CHANNEL = "rti/launchconfigurations";
constexpr auto LAUNCH_CHANNEL = "rti/launch";
constexpr auto LOGS_CHANNEL = "rti/logs";
constexpr auto BROKER_STATS_CHANNEL = "rti/brokerstats";
constexpr auto BROKER_PINGS_CHANNEL = "rti/brokerpings";
constexpr auto CLIENT_CONNECT_CHANNEL = "rti/clientconnect";
constexpr auto CLIENT_DISCONNECT_CHANNEL = "rti/clientdisconnect";
constexpr auto MESSAGE_BUNDLE_CHANNEL = "rti/messagebundle";
constexpr auto GEOMETRY_OPERATION_CHANNEL = "rti/geometries";
constexpr auto GEOMETRY_CHANNEL = "rti/geometry";
constexpr auto MEASURES_CHANNEL = "rti/measures";
constexpr auto MEASUREMENT_CHANNEL = "rti/measurement";
constexpr auto MEASUREMENT_BUNDLE_CHANNEL = "rti/measurementbundle";
constexpr auto TOAST_CHANNEL = "rti/toast";
constexpr auto INJECTABLE_OPERATION_CHANNEL = "rti/injectables";
constexpr auto INJECTABLE_CHANNEL = "rti/injectable";
constexpr auto INJECTION_OPERATION_CHANNEL = "rti/injections";
constexpr auto INJECTION_CHANNEL = "rti/injection";
constexpr auto COMMANDS_CHANNEL = "rti/commands";

constexpr auto RUNTIME_CONTROL_CAPABILITY = "runtime";
constexpr auto SCENARIO_CAPABILITY = "scenario";
constexpr auto TIME_SCALE_CAPABILITY = "timescale";
constexpr auto LOG_CAPABILITY = "log";
constexpr auto PLAYBACK_CAPABILITY = "playback";
constexpr auto LAUNCH_CAPABILITY = "launch";

typedef std::function<void()> connectcallback_t;
typedef std::shared_ptr<connectcallback_t> connectcallback_p;

typedef std::function<void()> disconnectcallback_t;
typedef std::shared_ptr<disconnectcallback_t> disconnectcallback_p;

typedef std::function<void(const std::string &, const std::string &)> messagecallback_t;
typedef std::shared_ptr<messagecallback_t> messagecallback_p;

typedef std::function<void(const std::string &, const std::string &)> errorcallback_t;
typedef std::shared_ptr<errorcallback_t> errorcallback_p;

typedef std::function<void(const std::string &)> stringcallback_t;
typedef std::shared_ptr<stringcallback_t> stringcallback_p;
typedef std::unordered_map<int, stringcallback_p> intstringcallbackmap_t;

typedef std::unordered_map<std::string, std::vector<messagecallback_p>> subscriptionmap_t;

typedef std::chrono::time_point<std::chrono::steady_clock> timestamp_t;

enum class ConnectionPhase { DISCONNECTED = -1, CONNECTING, AUTHENTICATING, CONNECTED };

// Forward declaration
std::string base64_encode(std::string const &input);
std::string base64_decode(std::string const &input);

class INHUMATE_RTI_EXPORT RTIClient
{
    public:
    RTIClient(const std::string &application = "C++",
              const bool connect = true,
              const std::string &url = "",
              const std::string &federation = "",
              const std::string &secret = "",
              const std::string &user = "",
              const std::string &password = "",
              const std::string &clientId = "");
    RTIClient(const RTIClient &) = delete;
    RTIClient(RTIClient &&) = default;
    ~RTIClient();

    void Connect();
    void Disconnect();

    connectcallback_p OnConnected(connectcallback_t callback);
    void OffConnected(connectcallback_p callback);
    connectcallback_p OnFirstConnect(connectcallback_t callback);
    void OffFirstConnect(connectcallback_p callback);
    disconnectcallback_p OnDisconnected(disconnectcallback_t callback);
    void OffDisconnected(disconnectcallback_p callback);
    errorcallback_p OnError(errorcallback_t callback);
    void OffError(errorcallback_p callback);

    void Publish(const std::string &channelName, const std::string &message, const bool registerChannel = true);
    void Publish(const std::string &channelName,
                 const google::protobuf::Message &message,
                 const bool registerChannel = true);

    messagecallback_p
    Subscribe(const std::string &channelName, messagecallback_t callback, const bool registerChannel = true);
    template <typename Message>
    messagecallback_p Subscribe(const std::string &channelName,
                                void (*callback)(const std::string &, const Message &),
                                const bool registerChannel = true)
    {
        return Subscribe(
        channelName,
        [callback](const std::string &channelName, const std::string &content) {
            callback(channelName, Parse<Message>(content));
        },
        registerChannel);
    }

    template <typename Message>
    messagecallback_p Subscribe(const std::string &channelName,
                                std::function<void(const std::string &, const Message &)> callback,
                                const bool registerChannel = true)
    {
        return Subscribe(
        channelName,
        [callback](const std::string &channelName, const std::string &content) {
            callback(channelName, Parse<Message>(content));
        },
        registerChannel);
    }

    void Unsubscribe(const std::string &channelName);
    void Unsubscribe(messagecallback_p callback);

    std::size_t Poll();
    void PollForever();
    void ResetPing();

    template <typename Message> static Message Parse(const std::string &content)
    {
        Message message;
        message.ParseFromString(base64_decode(content));
        return message;
    }

    void set_state(const proto::RuntimeState newState);

    const proto::RuntimeState state()
    {
        return _state;
    }
    const std::string &url()
    {
        return _url;
    }
    const std::string &federation()
    {
        return _federation;
    }
    const bool incognito()
    {
        return _incognito;
    }
    void set_incognito(const bool incognito)
    {
        _incognito = incognito;
    }
    const std::string &host()
    {
        return _host;
    }
    void set_host(const std::string &host)
    {
        _host = host;
    }
    const std::string &station()
    {
        return _station;
    }
    void set_station(const std::string &station)
    {
        _station = station;
    }
    const std::string &participant()
    {
        return _participant;
    }
    void set_participant(const std::string &participant)
    {
        _participant = participant;
    }
    const std::string &role()
    {
        return _role;
    }
    void set_role(const std::string &role)
    {
        _role = role;
    }
    const std::string &full_name()
    {
        return _fullName;
    }
    void set_full_name(const std::string &fullName)
    {
        _fullName = fullName;
    }
    const std::string &application()
    {
        return _application;
    }
    const std::string &client_id()
    {
        return clientId;
    }
    const std::string &user()
    {
        return _user;
    }
    bool connected()
    {
        return connectionPhase == ConnectionPhase::CONNECTED;
    }
    const ConnectionPhase connection_phase()
    {
        return connectionPhase;
    }
    const std::string &broker_version()
    {
        return brokerVersion;
    }
    const std::string &application_version()
    {
        return applicationVersion;
    }
    void set_application_version(const std::string &version)
    {
        applicationVersion = version;
    }
    const std::string &engine_version()
    {
        return engineVersion;
    }
    void set_engine_version(const std::string &version)
    {
        engineVersion = version;
    }
    const std::string &integration_version()
    {
        return integrationVersion;
    }
    void set_integration_version(const std::string &version)
    {
        integrationVersion = version;
    }
    const std::vector<std::string> &capabilities()
    {
        return _capabilities;
    }
    void add_capability(const std::string &capability)
    {
        _capabilities.push_back(capability);
    }
    const float measurement_interval_time_scale()
    {
        return measurementIntervalTimeScale;
    }
    void set_measurement_interval_time_scale(const float scale)
    {
        measurementIntervalTimeScale = scale;
    }
    const std::string own_channel_prefix()
    {
        std::string prefix("@");
        prefix.append(client_id());
        prefix.append(":");
        return prefix;
    }

    void PublishClient();
    void PublishState();
    void PublishMeasures();
    void PublishError(const std::string &message);
    void PublishError(const std::string &message, const proto::RuntimeState state);
    void PublishHeartbeat();
    void PublishProgress(const unsigned int progress);
    void PublishValue(const std::string &value, const bool highlight = false, const bool error = false);

    const std::vector<proto::Channel> &known_channels()
    {
        return knownChannels;
    }

    proto::Channel *known_channel(const std::string &name)
    {
        auto it = find_channel(name);
        if (it != knownChannels.end()) return &(*it);
        return nullptr;
    }
    std::vector<proto::Channel>::iterator find_channel(const std::string &name)
    {
        for (auto it = knownChannels.begin(); it != knownChannels.end(); it++) {
            if (it->name() == name) return it;
        }
        return knownChannels.end();
    }
    std::vector<proto::ChannelUse>::iterator find_used_channel(const std::string &name)
    {
        for (auto it = usedChannels.begin(); it != usedChannels.end(); it++) {
            if (it->channel().name() == name) return it;
        }
        return usedChannels.end();
    }

    std::vector<proto::Client> known_clients();
    proto::Client *known_client(const std::string &id)
    {
        return knownClients.find(id) != knownClients.end() ? &knownClients[id] : nullptr;
    }

    std::vector<proto::Measure> known_measures();
    proto::Measure *known_measure(const std::string &id)
    {
        return knownMeasures.find(id) != knownMeasures.end() ? &knownMeasures[id] : nullptr;
    }

    void RegisterChannel(const proto::Channel &channel);
    void RegisterMeasure(const proto::Measure &measure);
    void Measure(const std::string &measureId, const float value);
    void Measure(const proto::Measure &measure, const float value);

    void Transmit(const std::string &eventName, const std::string &data = "");
    void Invoke(const std::string &method, const std::string &data, const stringcallback_t callback);
    void Invoke(const std::string &method,
                const std::string &data,
                const stringcallback_t callback,
                const stringcallback_t errorCallback);

    private:
    std::unique_ptr<client> wsclient;
    std::unique_ptr<client_tls> wsclient_tls;

    connection_hdl_t connection_hdl;

    std::string _url;
    std::string _federation;
    bool _incognito;
    std::string _host;
    std::string _station;
    std::string _participant;
    std::string _role;
    std::string _fullName;
    std::string _application;
    std::string applicationVersion;
    std::string engineVersion;
    std::string integrationVersion;
    std::string clientId;
    std::string secret;
    std::string _user;
    std::string _password;
    std::vector<std::string> _capabilities;
    std::string brokerVersion;
    subscriptionmap_t subscriptions;
    std::vector<connectcallback_p> connectcallbacks;
    std::vector<connectcallback_p> firstconnectcallbacks;
    std::vector<disconnectcallback_p> disconnectcallbacks;
    std::vector<errorcallback_p> errorcallbacks;
    intstringcallbackmap_t rpcCallbacks;
    intstringcallbackmap_t rpcErrorCallbacks;
    uint64_t connectTime;
    uint64_t lastReconnectTime;
    uint64_t lastPingTime;
    uint64_t cid;

    // vectors are used here instead of unordered_map because clang/unreal build would crash weirdly in destructor
    std::vector<proto::ChannelUse> usedChannels;
    std::vector<proto::Channel> knownChannels;

    std::unordered_map<std::string, proto::Client> knownClients;
    std::unordered_map<std::string, proto::Measure> usedMeasures;
    std::unordered_map<std::string, proto::Measure> knownMeasures;
    std::unordered_map<std::string, std::unique_ptr<std::queue<float>>> collectQueue;
    timestamp_t lastCollectCheck;
    std::unordered_map<std::string, timestamp_t> lastCollect;
    float measurementIntervalTimeScale = 1.f;

    ConnectionPhase connectionPhase = ConnectionPhase::DISCONNECTED;
    proto::RuntimeState _state = proto::RuntimeState::UNKNOWN;
    bool connectCalled;
    bool shouldBeConnected;
    bool firstConnected;

    void OnOpen(connection_hdl_t hdl);
    void OnMessage(connection_hdl_t hdl, message_ptr_t msg);
    void OnClients(const std::string &channelName, const proto::Clients &message);
    void OnChannels(const std::string &channelName, const proto::Channels &message);
    void OnMeasures(const std::string &channelName, const proto::Measures &message);

    void RegisterChannelUsage(const std::string &channelName,
                              const bool usePublish,
                              const std::string &typeName = "unknown");
    void DiscoverChannel(const proto::Channel &channel);
    void Subscribe(const std::string &channelName);
    void SendAuthToken();
    void Send(const std::string &content);

    void CollectMeasurements();
};


/*
    ******
    base64.hpp is a repackaging of the base64.cpp and base64.h files into a
    single header suitable for use as a header only library. This conversion was
    done by Peter Thorson (webmaster@zaphoyd.com) in 2012. All modifications to
    the code are redistributed under the same license as the original, which is
    listed below.
    ******

   base64.cpp and base64.h

   Copyright (C) 2004-2008 René Nyffenegger

   This source code is provided 'as-is', without any express or implied
   warranty. In no event will the author be held liable for any damages
   arising from the use of this software.

   Permission is granted to anyone to use this software for any purpose,
   including commercial applications, and to alter it and redistribute it
   freely, subject to the following restrictions:

   1. The origin of this source code must not be misrepresented; you must not
      claim that you wrote the original source code. If you use this source code
      in a product, an acknowledgment in the product documentation would be
      appreciated but is not required.

   2. Altered source versions must be plainly marked as such, and must not be
      misrepresented as being the original source code.

   3. This notice may not be removed or altered from any source distribution.

   René Nyffenegger rene.nyffenegger@adp-gmbh.ch

*/

static std::string const base64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                                        "abcdefghijklmnopqrstuvwxyz"
                                        "0123456789+/";

/// Test whether a character is a valid base64 character
/**
 * @param c The character to test
 * @return true if c is a valid base64 character
 */
constexpr bool is_base64(unsigned char c)
{
    return (c == 43 || // +
            (c >= 47 && c <= 57) || // /-9
            (c >= 65 && c <= 90) || // A-Z
            (c >= 97 && c <= 122)); // a-z
}

/// Encode a char buffer into a base64 string
/**
 * @param input The input data
 * @param len The length of input in bytes
 * @return A base64 encoded string representing input
 */
inline std::string base64_encode(unsigned char const *input, size_t len)
{
    std::string ret;
    int i = 0;
    int j = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];

    while (len--) {
        char_array_3[i++] = *(input++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for (i = 0; (i < 4); i++) {
                ret += base64_chars[char_array_4[i]];
            }
            i = 0;
        }
    }

    if (i) {
        for (j = i; j < 3; j++) {
            char_array_3[j] = '\0';
        }

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
        char_array_4[3] = char_array_3[2] & 0x3f;

        for (j = 0; (j < i + 1); j++) {
            ret += base64_chars[char_array_4[j]];
        }

        while ((i++ < 3)) {
            ret += '=';
        }
    }

    return ret;
}

/// Encode a string into a base64 string
/**
 * @param input The input data
 * @return A base64 encoded string representing input
 */
inline std::string base64_encode(std::string const &input)
{
    return base64_encode(reinterpret_cast<const unsigned char *>(input.data()), input.size());
}

/// Decode a base64 encoded string into a string of raw bytes
/**
 * @param input The base64 encoded input data
 * @return A string representing the decoded raw bytes
 */
inline std::string base64_decode(std::string const &input)
{
    size_t in_len = input.size();
    int i = 0;
    int j = 0;
    int in_ = 0;
    unsigned char char_array_4[4], char_array_3[3];
    std::string ret;

    while (in_len-- && (input[in_] != '=') && is_base64(input[in_])) {
        char_array_4[i++] = input[in_];
        in_++;
        if (i == 4) {
            for (i = 0; i < 4; i++) {
                char_array_4[i] = static_cast<unsigned char>(base64_chars.find(char_array_4[i]));
            }

            char_array_3[0] = (char_array_4[0] << 2) + ((char_array_4[1] & 0x30) >> 4);
            char_array_3[1] = ((char_array_4[1] & 0xf) << 4) + ((char_array_4[2] & 0x3c) >> 2);
            char_array_3[2] = ((char_array_4[2] & 0x3) << 6) + char_array_4[3];

            for (i = 0; (i < 3); i++) {
                ret += char_array_3[i];
            }
            i = 0;
        }
    }

    if (i) {
        for (j = i; j < 4; j++)
            char_array_4[j] = 0;

        for (j = 0; j < 4; j++)
            char_array_4[j] = static_cast<unsigned char>(base64_chars.find(char_array_4[j]));

        char_array_3[0] = (char_array_4[0] << 2) + ((char_array_4[1] & 0x30) >> 4);
        char_array_3[1] = ((char_array_4[1] & 0xf) << 4) + ((char_array_4[2] & 0x3c) >> 2);
        char_array_3[2] = ((char_array_4[2] & 0x3) << 6) + char_array_4[3];

        for (j = 0; (j < i - 1); j++) {
            ret += static_cast<std::string::value_type>(char_array_3[j]);
        }
    }

    return ret;
}


} // namespace rti
} // namespace inhumate

#endif
