// Basic RTIRuntimeControl usage — react to start/stop/reset and load scenario.
//
// Run alongside the Inhumate broker (default ws://127.0.0.1:8000) and use the
// CLI or another RTI tool to send runtime control messages.

#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <thread>

#include "../inhumaterti.hpp"
#include "../rtiruntimecontrol.hpp"

using namespace inhumate::rti;

class MyRuntime : public RTIRuntimeControl
{
    public:
    using RTIRuntimeControl::RTIRuntimeControl;

    bool OnLoadScenario(const proto::RuntimeControl_ScenarioSpecification &scenario, bool playback) override
    {
        std::cout << "Load scenario: " << scenario.name() << (playback ? " (playback)" : "") << std::endl;
        return true;
    }
    void OnStart() override { std::cout << "Start" << std::endl; }
    void OnPause() override { std::cout << "Pause" << std::endl; }
    void OnEnd() override { std::cout << "End" << std::endl; }
    void OnStop() override { std::cout << "Stop" << std::endl; }
    void OnReset() override { std::cout << "Reset" << std::endl; }
    void OnTimeScale(double timeScale) override
    {
        std::cout << "Time scale: " << timeScale << std::endl;
    }
};

static std::atomic<bool> running{true};

int main()
{
    std::signal(SIGINT, [](int) { running = false; });

    RTIClient rti("C++ runtime control example");
    rti.OnConnected([]() { std::cout << "Connected" << std::endl; });
    rti.OnDisconnected([]() { std::cout << "Disconnected" << std::endl; });
    rti.OnError([](const std::string &channel, const std::string &error) {
        std::cerr << "Error: " << channel << ": " << error << std::endl;
    });

    MyRuntime runtime(rti);

    double simTime = 0.0;
    auto lastRealTime = std::chrono::steady_clock::now();

    while (running) {
        rti.Poll();

        if (rti.state() == proto::RuntimeState::RUNNING) {
            auto now = std::chrono::steady_clock::now();
            double dt = std::chrono::duration<double>(now - lastRealTime).count();
            lastRealTime = now;
            simTime += dt * (runtime.has_time_scale() ? runtime.time_scale() : 1.0);
            std::cout << "Update: simTime=" << simTime << " dt=" << dt << std::endl;
        } else {
            lastRealTime = std::chrono::steady_clock::now();
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    rti.Disconnect();
    for (int i = 0; i < 10; i++) {
        rti.Poll();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    std::cout << "kthxbye" << std::endl;
}
