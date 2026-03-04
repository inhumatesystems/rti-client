import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import inhumate_rti as RTI
import time

sim_time = 0.0


def update(dt):
    print(f"Update: sim_time={sim_time:.3f} dt={dt:.3f}")
    # do simulation work
    time.sleep(0.01)


last_real_time = time.time()


def main_loop():
    global sim_time
    global last_real_time

    if runtime.is_fast_time:
        # Fast-time mode: poll for the next step grant (timeout=0, non-blocking).
        #
        # IMPORTANT: with main_loop=, the socket read loop and main_loop share one
        # thread via MainLoopDispatcher.  A blocking wait_for_step_grant(timeout>0)
        # would stall that thread, preventing select() from reading the incoming
        # StepGrant — which then sits in the OS buffer until the timeout fires.
        # Use timeout=0 so main_loop returns immediately when no grant is queued;
        # the dispatcher then reads the socket and calls main_loop again once the
        # grant has arrived.
        #
        # If you use the multi-threaded pattern instead (no main_loop= argument),
        # the socket is read on a background thread and a blocking timeout is fine:
        #   grant = runtime.wait_for_step_grant(timeout=5)
        grant = runtime.wait_for_step_grant(timeout=0)
        if grant is not None:
            sim_time = grant.start_time
            update(grant.time_step)
            sim_time = grant.end_time
            runtime.complete_step(grant)
        # else: timed out (paused, no grant yet) — just loop again

    elif rti.state == RTI.proto.RuntimeState.RUNNING:
        # Real-time mode: advance sim time based on wall clock and time scale
        real_time = time.time()
        dt = real_time - last_real_time
        last_real_time = real_time
        sim_time += dt * (runtime.time_scale or 1.0)
        update(dt)

    else:
        last_real_time = time.time()
        time.sleep(0.1)  # idle


rti = RTI.Client(application="python_fasttime_example", main_loop=main_loop)

# fast_time=True adds the fast_time_worker capability and subscribes to
# rti/fasttimecontrol. When a Configure message arrives the helper automatically
# sends Acknowledge and switches the client to BUFFERED dispatch mode so that
# incoming messages are queued until flush_buffers() is called at step start.
runtime = RTI.RuntimeControl(rti, fast_time=True)

# ---------------------------------------------------------------------------
# Alternative: step_fn pattern (better for multi-threaded use without main_loop)
#
# def step(grant):
#     update(grant.time_step)
#     # complete_step is called automatically after this function returns
#
# rti = RTI.Client(application="python_fasttime_example")
# runtime = RTI.RuntimeControl(rti, step_fn=step)
# ---------------------------------------------------------------------------


def on_connect():
    print("Connected")
rti.on("connect", on_connect)


def on_disconnect():
    print("Disconnected")
rti.on("disconnect", on_disconnect)


def on_error(type, message, exception):
    print(f"Error: {type}: {message} {exception}")
rti.on("error", on_error)


try:
    rti.connect()  # blocks; runs main_loop repeatedly until disconnected

except KeyboardInterrupt:
    pass

rti.disconnect()
