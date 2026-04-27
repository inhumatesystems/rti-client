// Fast-time worker example using RTIRuntimeControl.
//
// fastTime=true adds the fasttimeworker capability and subscribes to
// rti/fasttimecontrol. When a Configure message arrives the helper automatically
// sends Acknowledge and switches the client to BUFFERED dispatch mode so that
// incoming messages are queued until FlushBuffers() is called at step start.
//
// Run alongside the Inhumate broker and a fast-time controller.

#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <thread>

#include "../inhumaterti.hpp"
#include "../rtiruntimecontrol.hpp"

using namespace inhumate::rti;

static double simTime = 0.0;

static void update(double dt)
{
    std::cout << "Update: simTime=" << simTime << " dt=" << dt << std::endl;
    // do simulation work
}

static std::atomic<bool> running{true};

int main()
{
    std::signal(SIGINT, [](int) { running = false; });

    RTIClient rti("C++ fasttime example");
    rti.OnConnected([]() { std::cout << "Connected" << std::endl; });
    rti.OnDisconnected([]() { std::cout << "Disconnected" << std::endl; });
    rti.OnError([](const std::string &channel, const std::string &error) {
        std::cerr << "Error: " << channel << ": " << error << std::endl;
    });

    // GetStepGrant pattern: poll the queue from the main loop.
    RTIRuntimeControl runtime(rti, /*subscribe=*/true, /*fastTime=*/true);

    // ------------------------------------------------------------------------
    // Alternative: stepFn pattern — helper auto-completes after the callback
    // returns, or marks failed if it throws.
    //
    // RTIRuntimeControl runtime(rti, true, false, [](const StepGrant &grant) {
    //     simTime = grant.start_time;
    //     update(grant.time_step);
    //     simTime = grant.end_time;
    // });
    // ------------------------------------------------------------------------

    auto lastRealTime = std::chrono::steady_clock::now();

    while (running) {
        // Drive the dispatch loop. Incoming step grants are delivered to the
        // helper inside Poll(), then queued for GetStepGrant() to pick up below.
        rti.Poll();

        if (runtime.is_fast_time()) {
            // Fast-time: pick up the next granted step (non-blocking).
            if (auto grant = runtime.GetStepGrant()) {
                simTime = grant->start_time;
                update(grant->time_step);
                simTime = grant->end_time;
                runtime.CompleteStep(*grant);
            }
            // else: no grant yet — loop and Poll() again.
        } else if (rti.state() == proto::RuntimeState::RUNNING) {
            // Real-time fallback: advance sim time using wall clock and time scale.
            auto now = std::chrono::steady_clock::now();
            double dt = std::chrono::duration<double>(now - lastRealTime).count();
            lastRealTime = now;
            simTime += dt * (runtime.has_time_scale() ? runtime.time_scale() : 1.0);
            update(dt);
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        } else {
            lastRealTime = std::chrono::steady_clock::now();
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }

    rti.Disconnect();
    for (int i = 0; i < 10; i++) {
        rti.Poll();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    std::cout << "kthxbye" << std::endl;
}
