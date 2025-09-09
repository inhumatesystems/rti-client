#define CATCH_CONFIG_EXTERNAL_INTERFACES
#include "catch.hpp"

#include "inhumaterti.hpp"
#include <chrono>
#include <iostream>
#include <thread>

using namespace inhumate::rti;
using namespace inhumate::rti::proto;
using namespace google::protobuf;
using namespace std::placeholders;

RTIClient rti("C++ test");
RTIClient rti2("C++ test 2", false);

#define SLEEP(x) std::this_thread::sleep_for(std::chrono::milliseconds(x));
#define POLL(duration)                                    \
    for (int count = 0; count < duration / 10; count++) { \
        rti.Poll();                                       \
        rti2.Poll();                                      \
        SLEEP(10);                                        \
    }
#define POLL_CONDITION(duration, condition)                            \
    for (int count = 0; condition && count < duration / 10; count++) { \
        rti.Poll();                                                    \
        rti2.Poll();                                                   \
        SLEEP(10);                                                     \
    }

struct Listener : Catch::TestEventListenerBase {
    using TestEventListenerBase::TestEventListenerBase;

    void testRunStarting(Catch::TestRunInfo const &testRunInfo) override
    {
        rti.set_station("station1");
        rti.OnError([](const std::string &channelName, const std::string &error) {
            if (channelName != "test")
                std::cerr << "error: " << channelName << ": " << error << std::endl;
            if (channelName == "fail") exit(1);
        });
        rti2.OnError([](const std::string &channelName, const std::string &error) {
            if (channelName != "test")
                std::cerr << "error: " << channelName << ": " << error << " (2nd client)" << std::endl;
            if (channelName == "fail") exit(1);
        });
        //rti.OnConnected([]() { std::cout << "connected" << std::endl; });
        //rti.OnDisconnected([]() { std::cout << "disconnected" << std::endl; });
        POLL_CONDITION(1000, !rti.connected());
        if (!rti.connected()) rti.Connect();
        POLL_CONDITION(5000, !rti.connected());

        rti2.Connect();
        POLL_CONDITION(1000, !rti2.connected());
        if (!rti2.connected()) rti2.Connect();
        POLL_CONDITION(5000, !rti2.connected());
    }
    void testRunEnded(Catch::TestRunStats const &testRunStats) override
    {
        if (rti.connected()) rti.Disconnect();
        if (rti2.connected()) rti2.Disconnect();
        POLL(100);
    }
};
CATCH_REGISTER_LISTENER(Listener);

TEST_CASE("proper_defaults")
{
    REQUIRE(!rti.incognito());
}

TEST_CASE("connect_disconnect_works")
{
    // Connection is done in RTI constructor
    REQUIRE(rti.connected());

    rti.Disconnect();
    POLL_CONDITION(500, rti.connected());
    REQUIRE(!rti.connected());
    POLL(100);

    rti.Connect();
    POLL_CONDITION(5000, !rti.connected());
    REQUIRE(rti.connected());
}
 

TEST_CASE("connect_disconnect_events_called")
{
    bool disconnectCalled = false;
    auto disconnectListener = rti.OnDisconnected([&]() { disconnectCalled = true; });
    rti.Disconnect();
    POLL_CONDITION(500, !disconnectCalled);
    REQUIRE(!rti.connected());
    REQUIRE(disconnectCalled);
    POLL(100);

    bool connectCalled = false;
    auto connectListener = rti.OnConnected([&]() { connectCalled = true; });
    rti.Connect();
    POLL_CONDITION(5000, !rti.connected());
    REQUIRE(rti.connected());
    REQUIRE(connectCalled);
}

TEST_CASE("subscribe_callbackerror_errorevent_called")
{
    bool received = false;
    rti.Subscribe("test", [&](const std::string &channel, const std::string &message) {
        throw std::exception();
    });
    auto listener = rti.OnError([&](const std::string &channelName, const std::string &error) {
        if (channelName == "test") received = true;
    });
    POLL(100);
    rti.Publish("test", "foo");
    POLL_CONDITION(500, !received);
    rti.OffError(listener);
    rti.Unsubscribe("test");
    REQUIRE(received);
}

TEST_CASE("publish_subscribe_string_works")
{
    bool received = false;
    rti.Subscribe("test",
                  [&](const std::string &channel, const std::string &message) { received = true; });
    POLL(100);
    rti.Publish("test", "foo");
    POLL_CONDITION(500, !received);
    rti.Unsubscribe("test");
    REQUIRE(received);
}

TEST_CASE("unsubscribe_single_listener_works")
{
    bool received = false;
    auto listener = rti.Subscribe("test", [&](const std::string &channel,
                                              const std::string &message) { received = true; });
    POLL(100);
    rti.Publish("test", "foo");
    POLL_CONDITION(500, !received);
    REQUIRE(received);

    rti.Unsubscribe(listener);
    received = false;
    POLL(100);
    rti.Publish("test", "foo again");
    POLL(500);
    REQUIRE(!received);
}

TEST_CASE("unsubscribe_two_listeners_works")
{
    bool received = false;
    auto listener = rti.Subscribe("test", [&](const std::string &channel, const std::string &message) { 
        received = true; 
    });
    bool received2 = false;
    auto listener2 = rti.Subscribe("test", [&](const std::string &channel, const std::string &message) { 
        received2 = true; 
    });

    POLL(100);
    rti.Publish("test", "foo");
    POLL_CONDITION(500, !received);
    POLL_CONDITION(500, !received2);
    REQUIRE(received);
    REQUIRE(received2);

    rti.Unsubscribe(listener);
    rti.Unsubscribe(listener2);
    POLL(100);
    received = false;
    received2 = false;
    rti.Publish("test", "foo again");
    POLL(500);
    REQUIRE(!received);
    REQUIRE(!received2);
}

TEST_CASE("publish_subscribe_proto_message_works")
{
    bool received = false;
    rti.Subscribe<RuntimeControl>("control-test", [&](const std::string &channel, const RuntimeControl &message) {
        received = true;
    });
    POLL(100);
    RuntimeControl message;
    message.set_allocated_pause(new Empty());
    rti.Publish("control-test", message);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("publishes_client_on_connect")
{
    // Another RTI (rti) connects. Other RTI (rti2) should know about it.
    bool received = false;
    for (int count = 0; !received && count < 500; count++) {
        POLL(10);
        if (rti2.known_client(rti.client_id())) received = true;
    }
    REQUIRE(received);
}

TEST_CASE("responds_to_client_request")
{
    // Another RTI client (rti2) requests clients. RTI client (rti) should respond.
    bool received = false;
    rti2.Subscribe<Clients>(CLIENTS_CHANNEL, [&](const std::string &channel, const Clients &message) {
        if (message.which_case() == Clients::WhichCase::kClient &&
            message.client().id() == rti.client_id())
            received = true;
    });
    Clients message;
    message.set_allocated_request_clients(new Empty());
    rti2.Publish(CLIENTS_CHANNEL, message);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("responds_to_channels_request")
{
    // Another RTI (rti2) requests channels. RTI (rti) should respond.
    bool received = false;
    rti2.Subscribe<Channels>(CHANNELS_CHANNEL, [&](const std::string &channel, const Channels &message) {
        if (message.which_case() == Channels::WhichCase::kChannelUsage &&
            message.channel_usage().client_id() == rti.client_id())
            received = true;
    });
    Channels message;
    message.set_allocated_request_channel_usage(new Empty());
    rti2.Publish(CHANNELS_CHANNEL, message);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("channels_request_knows_channel")
{
    // Another RTI (rti2) subscribes to a custom channel. RTI (rti) should be able to request and know about it.
    rti2.Subscribe("foobar", [](const std::string &channel, const std::string &message) {});
    Channels message;
    message.set_allocated_request_channel_usage(new Empty());
    rti.Publish(CHANNELS_CHANNEL, message);
    POLL_CONDITION(500, rti.known_channel("foobar") == nullptr);
    REQUIRE(rti.known_channel("foobar") != nullptr);
}

TEST_CASE("set_state_publishes_client")
{
    bool received = false;
    rti.Subscribe<Clients>(CLIENTS_CHANNEL, [&](const std::string &channel, const Clients &message) {
        if (message.which_case() == Clients::WhichCase::kClient &&
            message.client().id() == rti.client_id())
            received = true;
    });
    POLL(100);
    rti.set_state(RuntimeState::PLAYBACK);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("publish_error_works")
{
    bool received = false;
    rti.Subscribe<RuntimeControl>(CONTROL_CHANNEL, [&](const std::string &channel, const RuntimeControl &message) {
        if (message.control_case() == RuntimeControl::ControlCase::kError &&
            message.error().client_id() == rti.client_id())
            received = true;
    });
    POLL(100);
    rti.PublishError("test");
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("broker_version_is_set")
{
    POLL(100);
    auto version = rti.broker_version();
    REQUIRE(version != "");
}

TEST_CASE("host_is_set")
{
    REQUIRE(rti.host() != "");
}

TEST_CASE("large_message")
{
    Geometry message;
    auto mesh = new Geometry_Mesh();
    for (int i = 0; i < 100000; i++) {
        mesh->add_vertices();
        mesh->add_indices(i);
    }
    message.set_allocated_mesh(mesh);
    rti.Publish(GEOMETRY_CHANNEL, message);
    POLL(1000);
}

TEST_CASE("responds_to_measure_request")
{
    Measure measure;
    measure.set_id("test");
    rti.RegisterMeasure(measure);

    // Another RTI client (rti2) requests measures. RTI client (rti) should respond.
    bool received = false;
    auto subscription = rti2.Subscribe<Measures>(MEASURES_CHANNEL, [&](const std::string &channel, const Measures &message) {
        if (message.which_case() == Measures::WhichCase::kMeasure && message.measure().id() == "test")
            received = true;
    });
    Measures message;
    message.set_allocated_request_measures(new Empty());
    rti2.Publish(MEASURES_CHANNEL, message);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
    rti2.Unsubscribe(subscription);
}

TEST_CASE("measure_without_interval__measurement__publishes_instantly")
{
    bool received = false;
    auto subscription = rti.Subscribe<Measurement>(MEASUREMENT_CHANNEL, [&](const std::string &channel, const Measurement &measurement) {
        if (std::abs(measurement.value() - 42) < 0.01) received = true;
    });
    rti.Measure("test", 42);
    POLL_CONDITION(500, !received);
    REQUIRE(received);
    rti.Unsubscribe(subscription);
}

TEST_CASE("measure_with_interval__one_measurement__publishes_value")
{
    Measure measure;
    measure.set_id("interval");
    measure.set_interval(1);

    bool received = false;
    auto subscription = rti.Subscribe<Measurement>(MEASUREMENT_CHANNEL, [&](const std::string &channel, const Measurement &measurement) {
        if (std::abs(measurement.value() - 42) < 0.01) received = true;
    });

    // Make a measurement
    rti.Measure(measure, 42);

    // Should not be published until interval (1s) passes
    POLL_CONDITION(500, !received);
    REQUIRE(!received);

    // Should be received after ~1s
    POLL_CONDITION(1000, !received);
    REQUIRE(received);
    rti.Unsubscribe(subscription);
}

TEST_CASE("measure_with_interval__multiple_measurements__publishes_window")
{
    Measure measure;
    measure.set_id("multinterval");
    measure.set_interval(1);

    bool received = false;
    auto subscription = rti.Subscribe<Measurement>(MEASUREMENT_CHANNEL, [&](const std::string &channel, const Measurement &measurement) {
        //REQUIRE(measurement.window().count() == 3);
        REQUIRE(std::abs(measurement.window().mean() - 42) < 0.01);
        REQUIRE(std::abs(measurement.window().max() - 44) < 0.01);
        REQUIRE(std::abs(measurement.window().min() - 40) < 0.01);
        received = true;
    });

    // Make measurements
    rti.Measure(measure, 42);
    rti.Measure(measure, 44);
    rti.Measure(measure, 40);

    // Should not be published until interval (1s) passes
    POLL_CONDITION(500, !received);
    REQUIRE(!received);

    // Should be received after ~1s
    POLL_CONDITION(1000, !received);
    REQUIRE(received);
    rti.Unsubscribe(subscription);
}

TEST_CASE("entity_measure_with_interval__multiple_measurements__publishes_window")
{
    Measure measure;
    measure.set_id("multinterval");
    measure.set_interval(1);
    measure.set_entity(true);

    bool received1 = false;
    bool received2 = false;
    auto subscription = rti.Subscribe<Measurement>(MEASUREMENT_CHANNEL, [&](const std::string &channel, const Measurement &measurement) {
        //REQUIRE(measurement.window().count() == 3);
        if (measurement.entity_id() == "entity1") {
            REQUIRE(std::abs(measurement.window().mean() - 43) < 0.01);
            received1 = true;
        } else if (measurement.entity_id() == "entity2") {
            REQUIRE(std::abs(measurement.value() - 40) < 0.01);
            received2 = true;
        }
    });

    // Make measurements
    rti.Measure(measure, 42, "entity1");
    rti.Measure(measure, 44, "entity1");
    rti.Measure(measure, 40, "entity2");

    // Should not be published until interval (1s) passes
    POLL_CONDITION(500, !received1 && !received2);
    REQUIRE(!received1);
    REQUIRE(!received2);

    // Should be received after ~1s
    POLL_CONDITION(1000, !received1 && !received2);
    REQUIRE(received1);
    REQUIRE(received2);
    rti.Unsubscribe(subscription);
}

TEST_CASE("participant_registration_for_station__sets_participant")
{
    Clients message;
    auto reg = new ParticipantRegistration();
    reg->set_participant("mr.foo");
    reg->set_station("station1");
    message.set_allocated_register_participant(reg);
    
    rti2.Publish(CLIENTS_CHANNEL, message);
    POLL(500);

    REQUIRE(rti.participant() == "mr.foo");
    REQUIRE(rti2.known_client(rti.client_id())->participant() == "mr.foo");
}

TEST_CASE("participant_registration_for_client__sets_participant")
{
    Clients message;
    auto reg = new ParticipantRegistration();
    reg->set_participant("mr.foo");
    reg->set_client_id(rti.client_id());
    message.set_allocated_register_participant(reg);
    
    rti2.Publish(CLIENTS_CHANNEL, message);
    POLL(500);

    REQUIRE(rti.participant() == "mr.foo");
    REQUIRE(rti2.known_client(rti.client_id())->participant() == "mr.foo");
}

TEST_CASE("heartbeat_progress_value")
{
    rti.PublishHeartbeat();
    POLL(100);
    rti.PublishValue("foo", false, true);
    POLL(100);
    for (int i = 0; i < 10; i++) {
        rti.PublishProgress((i+1)*10);
        POLL(100);
    }
}

TEST_CASE("ephemeral_channel_registered_after_first_use__updates_to_ephemeral") {
    bool received = false;
    bool ephemeral = false;
    rti2.Subscribe("ephx", [&](const std::string &channel, const std::string &message) {
        received = true;
        ephemeral = rti2.known_channel("ephx")->ephemeral();
    });
    rti.Publish("ephx", "foo");
    POLL(100);

    Channel channel;
    channel.set_name("ephx");
    channel.set_ephemeral(true);
    rti.RegisterChannel(channel);
    POLL(100);
    received = false;
    rti.Publish("ephx", "bar");
    POLL_CONDITION(500, !received);

    REQUIRE(received);
    REQUIRE(ephemeral);
}

TEST_CASE("broker_rpc")
{
    bool received = false;
    rti.Invoke("echo", "hello", [&](const std::string &response) {
        received = true;
        REQUIRE(response == "hello");
    });
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("broker_rpc_error")
{
    bool received = false;
    auto off = rti.OnError([&](const std::string &channelName, const std::string &error) {
        if (channelName == "rpc") {
            received = true;
            REQUIRE(error == "error test");
        }
    });
    rti.Invoke("echo", "error test", [](const std::string &response) {});
    POLL_CONDITION(500, !received);
    rti.OffError(off);
    REQUIRE(received);
}

TEST_CASE("broker_rpc_specific_error")
{
    bool received = false;
    rti.Invoke("echo", "error test", [](const std::string &response) {},  [&](const std::string &error) {
        received = true;
        REQUIRE(error == "error test");
    });
    POLL_CONDITION(500, !received);
    REQUIRE(received);
}

TEST_CASE("publish_before_connect")
{
    RTIClient temprti("C++ test temp", false);
    try {
        temprti.Publish("test", "foo");
        POLL(100);
        FAIL("Should have thrown exception");
    } catch (const std::exception &e) {
    }
}
