//
// Inhumate RTI C++ Client — RTIRuntimeControl helper
// Copyright 2026 Inhumate AB
//
// Utility class to simplify sending and responding to runtime control messages
// (start, stop, etc.) and to add fast-time worker support to a C++ RTI client.
//

#ifndef __INHUMATE_RTI_RUNTIMECONTROL_H__
#define __INHUMATE_RTI_RUNTIMECONTROL_H__

#include <chrono>
#include <functional>
#include <memory>
#include <queue>
#include <string>
#include <vector>

#include "inhumaterti.hpp"

namespace inhumate
{
namespace rti
{

class INHUMATE_RTI_EXPORT StepGrant
{
    public:
    int64_t step_number = 0;
    double start_time = 0.0;
    double end_time = 0.0;
    double time_step = 0.0;

    StepGrant() = default;
    StepGrant(const proto::FastTimeControl_StepGrant &p, const std::string &runId);

    // Internal — used by RTIRuntimeControl when sending StepComplete.
    std::string _run_id;
    std::chrono::time_point<std::chrono::steady_clock> _real_start;
};

class INHUMATE_RTI_EXPORT RTIRuntimeControl
{
    public:
    typedef std::function<void(const StepGrant &)> step_fn_t;

    // subscribe: install runtime-control subscriptions immediately (default true).
    // fastTime: enable fast-time worker support (also enabled if stepFn is set).
    // stepFn: optional callback pattern — invoked on every step grant; helper calls
    //         CompleteStep automatically (or with failed=true if stepFn throws).
    RTIRuntimeControl(RTIClient &rti,
                      bool subscribe = true,
                      bool fastTime = false,
                      step_fn_t stepFn = nullptr);
    RTIRuntimeControl(const RTIRuntimeControl &) = delete;
    RTIRuntimeControl &operator=(const RTIRuntimeControl &) = delete;
    virtual ~RTIRuntimeControl();

    // Override hooks — subclass and override to add custom behavior.
    virtual void OnReset() {}
    virtual bool OnLoadScenario(const proto::RuntimeControl_LoadScenario &loadScenario, bool playback)
    {
        (void)loadScenario;
        (void)playback;
        return true;
    }
    virtual void OnStart() {}
    virtual void OnPlay() {}
    virtual void OnPause() {}
    virtual void OnEnd() {}
    virtual void OnStop() {}
    virtual void OnEndStop() {}
    virtual void OnResetEndStop() {}
    virtual void OnTimeScale(double timeScale) { (void)timeScale; }
    virtual void OnTimeSync(const proto::RuntimeControl_TimeSync &timeSync) { (void)timeSync; }

    // Called when a fast-time step grant is received. Override to add custom behavior.
    // Only called when using the GetStepGrant() pattern (no stepFn provided).
    virtual void OnStepGrant(const StepGrant &grant) { (void)grant; }

    // Runtime control publish methods.
    void Reset();
    void LoadScenario(const std::string &scenarioName);
    void Start();
    void Play();
    void Pause();
    void End();
    void Stop();
    void SetTimeScale(double timeScale);
    void Seek(double time);

    // Fast-time worker.
    bool is_fast_time() const { return !_fastTimeRunId.empty(); }

    // Returns the next queued step grant, or nullptr if none.
    // Non-blocking: in C++ the dispatch loop is driven by rti.Poll(), so the caller
    // is expected to poll regularly and check for grants between polls. Example:
    //
    //   while (running) {
    //       rti.Poll();
    //       auto grant = runtime.GetStepGrant();
    //       if (grant) {
    //           // do simulation work
    //           runtime.CompleteStep(*grant);
    //       }
    //   }
    std::unique_ptr<StepGrant> GetStepGrant();

    // Send StepComplete to the fast-time controller.
    void CompleteStep(const StepGrant &grant, bool failed = false, const std::string &reason = "");

    void Subscribe();

    // Block (while polling) until all clients with the given application name are in one of
    // the specified states. Throws std::runtime_error on timeout.
    void WaitForApplicationState(const std::string &application,
                                 proto::RuntimeState state,
                                 double timeoutSec = 30.0);
    void WaitForApplicationState(const std::string &application,
                                 const std::vector<proto::RuntimeState> &states,
                                 double timeoutSec = 30.0);

    // Block (while polling) until the client with the given ID is in one of the specified states.
    // Throws std::runtime_error on timeout.
    void WaitForClientState(const std::string &clientId,
                            proto::RuntimeState state,
                            double timeoutSec = 30.0);
    void WaitForClientState(const std::string &clientId,
                            const std::vector<proto::RuntimeState> &states,
                            double timeoutSec = 30.0);

    // State exposed for callers.
    bool publish_scenario = false;
    bool async_ready = false;
    bool has_time_scale() const { return _hasTimeScale; }
    double time_scale() const { return _timeScale; }
    bool has_scenario() const { return _hasScenario; }
    const proto::RuntimeControl_LoadScenario &scenario() const { return _scenario; }

    protected:
    RTIClient &rti;

    private:
    bool _subscribed = false;
    step_fn_t _stepFn;
    bool _fastTimeEnabled;
    std::string _fastTimeRunId;
    std::string _fastTimeControllerClientId;
    std::queue<StepGrant> _grantQueue;

    bool _hasTimeScale = false;
    double _timeScale = 1.0;
    bool _hasScenario = false;
    proto::RuntimeControl_LoadScenario _scenario;

    messagecallback_p _runtimeControlSub;
    messagecallback_p _ownRuntimeControlSub;
    messagecallback_p _fastTimeControlSub;
    messagecallback_p _clientDisconnectSub;

    void PublishAndReceive(const proto::RuntimeControl &message);
    void Receive(const proto::RuntimeControl &message);
    void ReceiveFastTime(const proto::FastTimeControl &message);
    void OnControllerDisconnect(const std::string &clientId);
    void ResetFastTime();
};

} // namespace rti
} // namespace inhumate

#endif
