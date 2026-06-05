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

static void publish_configure_run(const std::string &run_id, double time_step = 1.0)
{
    FastTimeControl m;
    m.mutable_configure_run()->set_controller_client_id(rti2.client_id());
    m.mutable_configure_run()->set_run_id(run_id);
    m.mutable_configure_run()->set_time_step(time_step);
    rti2.Publish(FAST_TIME_CONTROL_CHANNEL, m);
}

static void publish_abandon_run(const std::string &run_id)
{
    FastTimeControl m;
    m.mutable_abandon_run()->set_run_id(run_id);
    rti2.Publish(FAST_TIME_CONTROL_CHANNEL, m);
}

static void publish_configuration(FastTimeControl_ExecutionMode mode, double time_step = 1.0)
{
    FastTimeControl m;
    m.mutable_configuration()->set_mode(mode);
    m.mutable_configuration()->set_time_step(time_step);
    rti2.Publish(FAST_TIME_CONTROL_CHANNEL, m);
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

TEST_CASE("fast_time_abandon_run_resets_fast_time")
{
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);
    POLL2(100);
    rti.set_state(RuntimeState::INITIAL);
    publish_configure_run("run-abandon");
    POLL2_UNTIL(2000, runtime.is_fast_time());
    REQUIRE(runtime.is_fast_time());
    publish_abandon_run("run-abandon");
    POLL2_UNTIL(2000, !runtime.is_fast_time());
    REQUIRE(!runtime.is_fast_time());
    REQUIRE(!rti.fast_time_mode());
    REQUIRE(rti.defaultDispatchMode == DispatchMode::IMMEDIATE);
}

TEST_CASE("fast_time_abandon_other_run_does_not_reset")
{
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);
    POLL2(100);
    rti.set_state(RuntimeState::INITIAL);
    publish_configure_run("run-abandon-mine");
    POLL2_UNTIL(2000, runtime.is_fast_time());
    REQUIRE(runtime.is_fast_time());
    publish_abandon_run("run-abandon-other");
    POLL2(300);
    REQUIRE(runtime.is_fast_time());
    // Clean up shared client state for subsequent tests
    publish_abandon_run("run-abandon-mine");
    POLL2_UNTIL(2000, !runtime.is_fast_time());
}

TEST_CASE("fast_time_realtime_configuration_resets_fast_time")
{
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);
    POLL2(100);
    rti.set_state(RuntimeState::INITIAL);
    publish_configure_run("run-config-rt");
    POLL2_UNTIL(2000, runtime.is_fast_time());
    REQUIRE(runtime.is_fast_time());
    publish_configuration(FastTimeControl_ExecutionMode_REAL_TIME);
    POLL2_UNTIL(2000, !runtime.is_fast_time());
    REQUIRE(!runtime.is_fast_time());
    REQUIRE(!rti.fast_time_mode());
    REQUIRE(rti.defaultDispatchMode == DispatchMode::IMMEDIATE);
}

TEST_CASE("fast_time_unknown_mode_configuration_resets_fast_time")
{
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);
    POLL2(100);
    rti.set_state(RuntimeState::INITIAL);
    publish_configure_run("run-config-unknown");
    POLL2_UNTIL(2000, runtime.is_fast_time());
    REQUIRE(runtime.is_fast_time());
    publish_configuration(FastTimeControl_ExecutionMode_UNKNOWN_MODE);
    POLL2_UNTIL(2000, !runtime.is_fast_time());
    REQUIRE(!runtime.is_fast_time());
}

TEST_CASE("fast_time_fixed_step_configuration_does_not_reset")
{
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);
    POLL2(100);
    rti.set_state(RuntimeState::INITIAL);
    publish_configure_run("run-config-fixed");
    POLL2_UNTIL(2000, runtime.is_fast_time());
    REQUIRE(runtime.is_fast_time());
    publish_configuration(FastTimeControl_ExecutionMode_FIXED_STEP);
    POLL2(300);
    REQUIRE(runtime.is_fast_time());
    // Clean up shared client state for subsequent tests
    publish_abandon_run("run-config-fixed");
    POLL2_UNTIL(2000, !runtime.is_fast_time());
}
