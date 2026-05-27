#include "catch.hpp"

#include "inhumaterti.hpp"
#include "rtiruntimecontrol.hpp"

#include <chrono>
#include <thread>

using namespace inhumate::rti;
using namespace inhumate::rti::proto;

// Note: rti / rti2 / POLL / POLL_CONDITION / SLEEP are defined in client_behavior_test.cpp
// and linked into the same test binary.
extern RTIClient rti;
extern RTIClient rti2;

#define SLEEP(x) std::this_thread::sleep_for(std::chrono::milliseconds(x));
#define POLL2(duration)                                   \
    for (int count = 0; count < duration / 10; count++) { \
        rti.Poll();                                       \
        rti2.Poll();                                      \
        SLEEP(10);                                        \
    }
#define POLL2_UNTIL(duration, condition)                                   \
    for (int count = 0; !(condition) && count < duration / 10; count++) { \
        rti.Poll();                                                        \
        rti2.Poll();                                                       \
        SLEEP(10);                                                         \
    }

static void publish_seek(double time)
{
    RuntimeControl m;
    m.mutable_seek()->set_time(time);
    rti2.Publish(RUNTIME_CONTROL_CHANNEL, m);
}

TEST_CASE("seek_from_initial_sets_playback_paused")
{
    RTIRuntimeControl runtime(rti);
    POLL2(100); // drain leftover messages so runtime sees a clean state
    rti.set_state(RuntimeState::INITIAL);
    publish_seek(12.5);
    POLL2_UNTIL(2000, rti.state() == RuntimeState::PLAYBACK_PAUSED);
    REQUIRE(rti.state() == RuntimeState::PLAYBACK_PAUSED);
}

TEST_CASE("seek_during_playback_leaves_state_untouched")
{
    RTIRuntimeControl runtime(rti);
    POLL2(100);
    rti.set_state(RuntimeState::PLAYBACK);
    publish_seek(1.0);
    POLL2(200);
    REQUIRE(rti.state() == RuntimeState::PLAYBACK);
}

TEST_CASE("seek_during_running_leaves_state_untouched")
{
    RTIRuntimeControl runtime(rti);
    POLL2(100);
    rti.set_state(RuntimeState::RUNNING);
    publish_seek(1.0);
    POLL2(200);
    REQUIRE(rti.state() == RuntimeState::RUNNING);
}

TEST_CASE("seek_during_paused_leaves_state_untouched")
{
    RTIRuntimeControl runtime(rti);
    POLL2(100);
    rti.set_state(RuntimeState::PAUSED);
    publish_seek(1.0);
    POLL2(200);
    REQUIRE(rti.state() == RuntimeState::PAUSED);
}

TEST_CASE("seek_during_playback_stopped_sets_playback_paused")
{
    RTIRuntimeControl runtime(rti);
    POLL2(100);
    rti.set_state(RuntimeState::PLAYBACK_STOPPED);
    publish_seek(1.0);
    POLL2_UNTIL(2000, rti.state() == RuntimeState::PLAYBACK_PAUSED);
    REQUIRE(rti.state() == RuntimeState::PLAYBACK_PAUSED);
}

TEST_CASE("seek_calls_on_seek_hook")
{
    struct MyRuntime : public RTIRuntimeControl {
        using RTIRuntimeControl::RTIRuntimeControl;
        bool called = false;
        double received_time = 0.0;
        void OnSeek(const proto::RuntimeControl_Seek &seek) override {
            called = true;
            received_time = seek.time();
        }
    };
    MyRuntime runtime(rti);
    POLL2(100);
    publish_seek(7.25);
    POLL2_UNTIL(2000, runtime.called);
    REQUIRE(runtime.called);
    REQUIRE(runtime.received_time == Approx(7.25));
}
