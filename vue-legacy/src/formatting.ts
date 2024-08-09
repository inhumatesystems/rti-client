import { proto } from "inhumate-rti-legacy"
const RuntimeState = proto.RuntimeState

export function runtimeStateAsText(state: number) {
    switch (state) {
        case RuntimeState.UNKNOWN:
            return "Unknown"
        case RuntimeState.LAUNCHING:
            return "Launching"
        case RuntimeState.LAUNCHED:
            return "Launched"
        case RuntimeState.INITIAL:
            return "Initial"
        case RuntimeState.LOADING:
            return "Loading"
        case RuntimeState.READY:
            return "Ready"
        case RuntimeState.RUNNING:
            return "Running"
        case RuntimeState.PLAYBACK:
            return "Playback"
        case RuntimeState.PAUSED:
            return "Paused"
        case RuntimeState.PLAYBACK_PAUSED:
            return "Playback paused"
        case RuntimeState.END:
            return "End"
        case RuntimeState.PLAYBACK_END:
            return "Playback end"
        case RuntimeState.STOPPING:
            return "Stopping"
        case RuntimeState.STOPPED:
            return "Stopped"
        case RuntimeState.PLAYBACK_STOPPED:
            return "Playback stopped"
        case RuntimeState.SHUTTING_DOWN:
            return "Shutting down"
        case RuntimeState.SHUT_DOWN:
            return "Shut down"
        default:
            return "(" + state + ")"
    }
}

// export function processStateAsText(state: number) {
//     switch (state) {
//         case LaunchEvent.ProcessState.UNKNOWN:
//             return "Unknown"
//         case LaunchEvent.ProcessState.PENDING:
//             return "Pending"
//         case LaunchEvent.ProcessState.STARTED:
//             return "Started"
//         case LaunchEvent.ProcessState.RUNNING:
//             return "Running"
//         case LaunchEvent.ProcessState.STOPPING:
//             return "Stopping"
//         case LaunchEvent.ProcessState.DONE:
//             return "Done"
//         case LaunchEvent.ProcessState.FAILED:
//             return "Failed"
//         default:
//             return "(" + state + ")"
//     }
// }

export function formatDuration(time: number) {
    if (time === null) return "--:--"
    if (Math.abs(time) < 0.01) return "0"
    const sign = time < 0 ? "-" : ""
    if (time < 0) time = -time
    if (time < 1 && time > 0) return `${sign}${Math.round(time * 1000)} ms`
    const hours = Math.floor(time / 3600)
    const minutes = Math.floor(time / 60 - hours * 60)
    const seconds = Math.floor(time - minutes * 60 - hours * 3600)
    return sign + (hours ? hours + ":" : "") + ("00" + minutes).slice(-2) + ":" + ("00" + seconds).slice(-2)
}

export function parseDuration(str: string) {
    if (str === null || str === undefined) return -1
    if (str.length == 0) return 0
    if (str.indexOf(":") >= 0) {
        const parts = str.split(":")
        if (parts.length == 2) {
            return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
        } else if (parts.length == 3) {
            return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
        } else {
            return -1
        }
    } else {
        return parseFloat(str)
    }
}
