#include <functional>
#include <iostream>
#include <thread>

#include "../inhumaterti.hpp"

using namespace inhumate::rti;
using namespace inhumate::rti::proto;
using namespace std::placeholders;

void poll_for_a_while(RTIClient &rti)
{
    for (int i = 0; i < 100; i++) {
        rti.Poll();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

int main()
{
    try {
        RTIClient rti("C++ disableping example");
        poll_for_a_while(rti);

        rti.Transmit("disableping");

        poll_for_a_while(rti);
        std::cout << "zzz" << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(30));
        std::cout << "zzz" << std::endl;
        poll_for_a_while(rti);
        std::this_thread::sleep_for(std::chrono::seconds(30));
        std::cout << "is back, should be connected still " << rti.connected() << std::endl;

        rti.Transmit("enableping");
        rti.ResetPing();
        poll_for_a_while(rti);

        std::cout << "publish" << std::endl;
        rti.Publish("foo", "bar");
        poll_for_a_while(rti);

        std::cout << "zzz" << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(30));
        std::cout << "is back" << std::endl;
        poll_for_a_while(rti);
        std::cout << "should be disconnected " << rti.connected() << std::endl;

        if (rti.connected()) {
            std::cerr << "should not be connected" << std::endl;
            rti.Disconnect();
            poll_for_a_while(rti);
            return 1;
        }

    } catch (const std::exception &e) {
        std::cerr << "Exception: " << e.what() << std::endl;
    }
    std::cout << "kthxbye" << std::endl;
}