#include <functional>
#include <iostream>
#include <thread>

#include "../inhumaterti.hpp"

using namespace inhumate::rti;
using namespace inhumate::rti::proto;
using namespace std::placeholders;

class Test
{
    public:
    Test(RTIClient &_rti) : rti(_rti)
    {
        rti.OnError([](const std::string &channelName, const std::string &error) {
            std::cerr << "error" << (channelName == "test" ? " (expected): " : ": ") << channelName
                      << ": " << error << std::endl;
            if (channelName == "fail") exit(1);
        });

        conn_handle = rti.OnConnected([this]() {
            std::cout << "connected!" << std::endl;

            // four ways to subscribe:

            // subscribe with string and parse ourselves
            rti.Subscribe("test", [this](const std::string &channelName, const std::string &content) {
                RuntimeControl message = rti.Parse<RuntimeControl>(content);
                std::cout << "received subscribed str " << channelName << " "
                          << message.load_scenario().name() << std::endl;
            });

            // lambda callback as a variable
            std::function<void(const std::string &, const RuntimeControl &)> lambdaCallback =
            [this](const std::string &channelName, const RuntimeControl &message) {
                std::cout << "received subscribed typed " << channelName << " "
                          << message.load_scenario().name() << std::endl;
            };
            rti.Subscribe("test", lambdaCallback);

            // line lambda
            rti.Subscribe<RuntimeControl>("test", [this](const std::string &channelName,
                                                         const RuntimeControl &message) {
                std::cout << "received subscribed typed inline " << channelName << " "
                          << message.load_scenario().name() << std::endl;
            });

            // bound class method
            std::function<void(const std::string &, const RuntimeControl &)> boundClassMethod =
            std::bind(&Test::onRuntimeControl, this, _1, _2);
            rti.Subscribe("test", boundClassMethod);

        });
        rti.OnDisconnected([]() { std::cout << "disconnected!" << std::endl; });
    }

    void onRuntimeControl(const std::string &channelName, const RuntimeControl &message)
    {
        std::cout << "received bound class method " << channelName << " "
                  << message.load_scenario().name() << std::endl;
    }

    protected:
    RTIClient &rti;
    connectcallback_p conn_handle;
};

void poll_for_a_while(RTIClient& rti) {
    for (int i = 0; i < 100; i++) {
        rti.Poll();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

int main()
{
    RTIClient rti("C++ usage example", false);
    Test test(rti);
    rti.Connect();

    poll_for_a_while(rti);

    std::cout << "publish" << std::endl;
    RuntimeControl_LoadScenario *loadScenario = new RuntimeControl_LoadScenario();
    loadScenario->set_name("foo");
    RuntimeControl message;
    message.set_allocated_load_scenario(loadScenario);
    rti.Publish("test", message);

    poll_for_a_while(rti);

    rti.Disconnect();

    poll_for_a_while(rti);
    
    std::cout << "kthxbye" << std::endl;
}