//
// Inhumate RTI C++ Client — RTIRuntimeControl helper
// Copyright 2026 Inhumate AB
//

#include "rtiruntimecontrol.hpp"

#include <algorithm>
#include <stdexcept>
#include <thread>

namespace inhumate
{
namespace rti
{

using namespace std::chrono;

StepGrant::StepGrant(const proto::FastTimeControl_StepGrant &p, const std::string &runId)
    : step_number(p.step_number()),
      start_time(p.start_time()),
      end_time(p.end_time()),
      time_step(p.end_time() - p.start_time()),
      _run_id(runId),
      _real_start(steady_clock::now())
{
}

RTIRuntimeControl::RTIRuntimeControl(RTIClient &rti_, bool subscribe, bool fastTime, step_fn_t stepFn)
    : rti(rti_), _stepFn(std::move(stepFn))
{
    _fastTimeEnabled = fastTime || (bool)_stepFn;

    const auto &caps = rti.capabilities();
    if (std::find(caps.begin(), caps.end(), RUNTIME_CONTROL_CAPABILITY) == caps.end())
        rti.add_capability(RUNTIME_CONTROL_CAPABILITY);
    if (std::find(caps.begin(), caps.end(), SCENARIO_CAPABILITY) == caps.end())
        rti.add_capability(SCENARIO_CAPABILITY);
    if (std::find(caps.begin(), caps.end(), TIME_SCALE_CAPABILITY) == caps.end())
        rti.add_capability(TIME_SCALE_CAPABILITY);

    rti.set_state(proto::RuntimeState::INITIAL);

    if (_fastTimeEnabled) {
        if (std::find(caps.begin(), caps.end(), FAST_TIME_WORKER_CAPABILITY) == caps.end())
            rti.add_capability(FAST_TIME_WORKER_CAPABILITY);
    }

    if (subscribe) Subscribe();
}

RTIRuntimeControl::~RTIRuntimeControl()
{
    if (_runtimeControlSub) rti.Unsubscribe(_runtimeControlSub);
    if (_ownRuntimeControlSub) rti.Unsubscribe(_ownRuntimeControlSub);
    if (_fastTimeControlSub) rti.Unsubscribe(_fastTimeControlSub);
    if (_clientDisconnectSub) rti.Unsubscribe(_clientDisconnectSub);
}

// Runtime control publish methods.

void RTIRuntimeControl::Reset()
{
    proto::RuntimeControl m;
    m.mutable_reset();
    PublishAndReceive(m);
}

void RTIRuntimeControl::LoadScenario(const std::string &scenarioName)
{
    proto::RuntimeControl m;
    m.mutable_load_scenario()->set_name(scenarioName);
    PublishAndReceive(m);
}

void RTIRuntimeControl::Start()
{
    proto::RuntimeControl m;
    m.mutable_start();
    PublishAndReceive(m);
}

void RTIRuntimeControl::Play()
{
    proto::RuntimeControl m;
    m.mutable_play();
    PublishAndReceive(m);
}

void RTIRuntimeControl::Pause()
{
    proto::RuntimeControl m;
    m.mutable_pause();
    PublishAndReceive(m);
}

void RTIRuntimeControl::End()
{
    proto::RuntimeControl m;
    m.mutable_end();
    PublishAndReceive(m);
}

void RTIRuntimeControl::Stop()
{
    proto::RuntimeControl m;
    m.mutable_stop();
    PublishAndReceive(m);
}

void RTIRuntimeControl::SetTimeScale(double timeScale)
{
    proto::RuntimeControl m;
    m.mutable_set_time_scale()->set_time_scale(timeScale);
    PublishAndReceive(m);
}

void RTIRuntimeControl::Seek(double time)
{
    proto::RuntimeControl m;
    m.mutable_seek()->set_time(time);
    PublishAndReceive(m);
}

std::unique_ptr<StepGrant> RTIRuntimeControl::GetStepGrant()
{
    if (_grantQueue.empty()) return nullptr;
    std::unique_ptr<StepGrant> grant(new StepGrant(std::move(_grantQueue.front())));
    _grantQueue.pop();
    return grant;
}

void RTIRuntimeControl::CompleteStep(const StepGrant &grant, bool failed, const std::string &reason)
{
    auto duration = duration_cast<milliseconds>(steady_clock::now() - grant._real_start).count();
    proto::FastTimeControl msg;
    auto *sc = msg.mutable_step_complete();
    sc->set_client_id(rti.client_id());
    sc->set_run_id(grant._run_id);
    sc->set_step_number(grant.step_number);
    sc->set_duration(static_cast<int32_t>(duration));
    if (failed) {
        sc->set_failed(true);
        if (!reason.empty()) sc->set_reason(reason);
    }
    rti.Publish(FAST_TIME_CONTROL_CHANNEL, msg);
}

void RTIRuntimeControl::Subscribe()
{
    if (_subscribed) return;

    auto onRuntime = [this](const std::string &, const proto::RuntimeControl &m) { Receive(m); };
    // Always IMMEDIATE so stop/end/reset pierce BUFFERED mode during fast-time steps.
    _runtimeControlSub = rti.Subscribe<proto::RuntimeControl>(
        RUNTIME_CONTROL_CHANNEL,
        std::function<void(const std::string &, const proto::RuntimeControl &)>(onRuntime),
        true, DispatchMode::IMMEDIATE);
    _ownRuntimeControlSub = rti.Subscribe<proto::RuntimeControl>(
        rti.own_channel_prefix() + RUNTIME_CONTROL_CHANNEL,
        std::function<void(const std::string &, const proto::RuntimeControl &)>(onRuntime),
        true, DispatchMode::IMMEDIATE);

    if (_fastTimeEnabled) {
        auto onFastTime = [this](const std::string &, const proto::FastTimeControl &m) { ReceiveFastTime(m); };
        _fastTimeControlSub = rti.Subscribe<proto::FastTimeControl>(
            FAST_TIME_CONTROL_CHANNEL,
            std::function<void(const std::string &, const proto::FastTimeControl &)>(onFastTime),
            true, DispatchMode::IMMEDIATE);
        _clientDisconnectSub = rti.Subscribe(
            CLIENT_DISCONNECT_CHANNEL,
            [this](const std::string &, const std::string &content) {
                OnControllerDisconnect(base64_decode(content));
            },
            false, DispatchMode::IMMEDIATE);
    }

    _subscribed = true;
}

void RTIRuntimeControl::WaitForApplicationState(const std::string &application,
                                                proto::RuntimeState state,
                                                double timeoutSec)
{
    WaitForApplicationState(application, std::vector<proto::RuntimeState>{state}, timeoutSec);
}

void RTIRuntimeControl::WaitForApplicationState(const std::string &application,
                                                const std::vector<proto::RuntimeState> &states,
                                                double timeoutSec)
{
    if (!_subscribed) throw std::runtime_error("Cannot wait for application state without being subscribed");

    auto matches = [&](const proto::Client &c) {
        return std::find(states.begin(), states.end(), c.state()) != states.end();
    };

    bool requested = false;
    auto deadline = steady_clock::now() + duration_cast<steady_clock::duration>(duration<double>(timeoutSec));
    while (true) {
        rti.Poll();
        auto clients = rti.known_clients();
        std::vector<proto::Client> matching;
        for (auto &c : clients) if (c.application() == application) matching.push_back(c);

        if (!matching.empty()) {
            bool allOk = true;
            for (auto &c : matching) if (!matches(c)) { allOk = false; break; }
            if (allOk) return;
        } else if (!requested) {
            proto::Clients req;
            req.mutable_request_clients();
            rti.Publish(CLIENTS_CHANNEL, req);
            requested = true;
        }

        if (steady_clock::now() > deadline)
            throw std::runtime_error("Timeout waiting for application '" + application + "' state");
        std::this_thread::sleep_for(milliseconds(10));
    }
}

void RTIRuntimeControl::WaitForClientState(const std::string &clientId,
                                           proto::RuntimeState state,
                                           double timeoutSec)
{
    WaitForClientState(clientId, std::vector<proto::RuntimeState>{state}, timeoutSec);
}

void RTIRuntimeControl::WaitForClientState(const std::string &clientId,
                                           const std::vector<proto::RuntimeState> &states,
                                           double timeoutSec)
{
    if (!_subscribed) throw std::runtime_error("Cannot wait for client state without being subscribed");

    bool requested = false;
    auto deadline = steady_clock::now() + duration_cast<steady_clock::duration>(duration<double>(timeoutSec));
    while (true) {
        rti.Poll();
        auto *client = rti.known_client(clientId);
        if (client) {
            if (std::find(states.begin(), states.end(), client->state()) != states.end()) return;
        } else if (!requested) {
            proto::Clients req;
            req.mutable_request_clients();
            rti.Publish(CLIENTS_CHANNEL, req);
            requested = true;
        }

        if (steady_clock::now() > deadline)
            throw std::runtime_error("Timeout waiting for client '" + clientId + "' state");
        std::this_thread::sleep_for(milliseconds(10));
    }
}

void RTIRuntimeControl::PublishAndReceive(const proto::RuntimeControl &message)
{
    rti.Publish(RUNTIME_CONTROL_CHANNEL, message);
    if (!rti.connected() || !_subscribed) Receive(message);
}

void RTIRuntimeControl::OnControllerDisconnect(const std::string &clientId)
{
    if (clientId == _fastTimeControllerClientId && is_fast_time() &&
        rti.state() != proto::RuntimeState::RUNNING && rti.state() != proto::RuntimeState::PAUSED) {
        ResetFastTime();
    }
}

void RTIRuntimeControl::ReceiveFastTime(const proto::FastTimeControl &message)
{
    switch (message.control_case()) {
    case proto::FastTimeControl::kConfigure: {
        _fastTimeRunId = message.configure().run_id();
        _fastTimeControllerClientId = message.configure().controller_client_id();
        // defaultDispatchMode stays IMMEDIATE until the first step grant arrives.
        proto::FastTimeControl ack;
        auto *a = ack.mutable_acknowledge();
        a->set_client_id(rti.client_id());
        a->set_run_id(message.configure().run_id());
        rti.Publish(FAST_TIME_CONTROL_CHANNEL, ack);
        rti.set_fast_time_mode(true);
        break;
    }
    case proto::FastTimeControl::kStepGrant: {
        if (message.step_grant().run_id() != _fastTimeRunId) break;
        StepGrant grant(message.step_grant(), _fastTimeRunId);
        rti.defaultDispatchMode = DispatchMode::BUFFERED; // switch to BUFFERED on first step
        rti.FlushBuffers(); // dispatch messages buffered since last step
        if (_stepFn) {
            try {
                _stepFn(grant);
                CompleteStep(grant);
            } catch (std::exception &e) {
                CompleteStep(grant, true, e.what());
            } catch (...) {
                CompleteStep(grant, true, "unknown exception");
            }
        } else {
            OnStepGrant(grant);
            _grantQueue.push(std::move(grant));
        }
        break;
    }
    default:
        break;
    }
}

void RTIRuntimeControl::ResetFastTime()
{
    if (_fastTimeRunId.empty()) return;
    _fastTimeRunId.clear();
    _fastTimeControllerClientId.clear();
    while (!_grantQueue.empty()) _grantQueue.pop();
    rti.defaultDispatchMode = DispatchMode::IMMEDIATE;
    rti.FlushBuffers();
    rti.set_fast_time_mode(false);
}

void RTIRuntimeControl::Receive(const proto::RuntimeControl &message)
{
    switch (message.control_case()) {
    case proto::RuntimeControl::kReset:
        OnResetEndStop();
        OnReset();
        rti.set_state(proto::RuntimeState::INITIAL);
        if (_fastTimeEnabled) ResetFastTime();
        break;
    case proto::RuntimeControl::kLoadScenario: {
        _hasScenario = false;
        bool playback = rti.state() == proto::RuntimeState::PLAYBACK;
        rti.set_state(proto::RuntimeState::LOADING);
        bool success = OnLoadScenario(message.load_scenario(), playback);
        if (!success) {
            rti.set_state(proto::RuntimeState::UNKNOWN);
            return;
        }
        _scenario = message.load_scenario();
        _hasScenario = true;
        rti.set_state(playback ? proto::RuntimeState::PLAYBACK : proto::RuntimeState::READY);
        break;
    }
    case proto::RuntimeControl::kRequestCurrentScenario: {
        if (publish_scenario && _hasScenario) {
            proto::RuntimeControl out;
            out.mutable_current_scenario()->set_name(_scenario.name());
            rti.Publish(RUNTIME_CONTROL_CHANNEL, out);
        }
        break;
    }
    case proto::RuntimeControl::kStart:
        OnStart();
        rti.set_state(proto::RuntimeState::RUNNING);
        break;
    case proto::RuntimeControl::kPlay:
        OnPlay();
        rti.set_state(proto::RuntimeState::PLAYBACK);
        if (_fastTimeEnabled) ResetFastTime();
        break;
    case proto::RuntimeControl::kPause: {
        OnPause();
        auto s = rti.state();
        if (s == proto::RuntimeState::PLAYBACK || s == proto::RuntimeState::PLAYBACK_PAUSED)
            rti.set_state(proto::RuntimeState::PLAYBACK_PAUSED);
        else if (s != proto::RuntimeState::END && s != proto::RuntimeState::PLAYBACK_END &&
                 s != proto::RuntimeState::STOPPED && s != proto::RuntimeState::PLAYBACK_STOPPED)
            rti.set_state(proto::RuntimeState::PAUSED);
        break;
    }
    case proto::RuntimeControl::kEnd:
        OnResetEndStop();
        OnEndStop();
        OnEnd();
        rti.set_state(rti.state() == proto::RuntimeState::PLAYBACK
                          ? proto::RuntimeState::PLAYBACK_END
                          : proto::RuntimeState::END);
        if (_fastTimeEnabled) ResetFastTime();
        break;
    case proto::RuntimeControl::kStop: {
        OnResetEndStop();
        OnEndStop();
        OnStop();
        auto s = rti.state();
        if (s == proto::RuntimeState::PLAYBACK || s == proto::RuntimeState::PLAYBACK_PAUSED ||
            s == proto::RuntimeState::PLAYBACK_STOPPED || s == proto::RuntimeState::PLAYBACK_END)
            rti.set_state(proto::RuntimeState::PLAYBACK_STOPPED);
        else
            rti.set_state(proto::RuntimeState::STOPPED);
        if (_fastTimeEnabled) ResetFastTime();
        break;
    }
    case proto::RuntimeControl::kSetTimeScale:
        _timeScale = message.set_time_scale().time_scale();
        _hasTimeScale = true;
        OnTimeScale(_timeScale);
        break;
    case proto::RuntimeControl::kTimeSync:
        _timeScale = message.time_sync().time_scale();
        _hasTimeScale = true;
        OnTimeSync(message.time_sync());
        break;
    case proto::RuntimeControl::kCurrentScenario:
        _scenario.Clear();
        _scenario.set_name(message.current_scenario().name());
        _hasScenario = true;
        break;
    default:
        break;
    }
}

} // namespace rti
} // namespace inhumate
