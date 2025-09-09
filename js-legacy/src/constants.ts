export default {
    version: "0.0.1-dev-version",
    defaultHost: "localhost",
    defaultPort: 8000,
}

const internalPrefix = "rti/"
export const channel = {
    internalPrefix,
    control: internalPrefix + "control",
    channels: internalPrefix + "channels",
    clients: internalPrefix + "clients",
    scenarios: internalPrefix + "scenarios",
    entityOperation: internalPrefix + "entities",
    entity: internalPrefix + "entity",
    position: internalPrefix + "position",
    launchConfigurations: internalPrefix + "launchconfigurations",
    launch: internalPrefix + "launch",
    logs: internalPrefix + "logs",
    brokerStats: internalPrefix + "brokerstats",
    brokerPings: internalPrefix + "brokerpings",
    clientConnect: internalPrefix + "clientconnect",
    clientDisconnect: internalPrefix + "clientdisconnect",
    messageBundle: internalPrefix + "messagebundle",
    geometryOperation: internalPrefix + "geometries",
    geometry: internalPrefix + "geometry",
    measures: internalPrefix + "measures",
    measurement: internalPrefix + "measurement",
    measurementBundle: internalPrefix + "measurementbundle",
    toast: internalPrefix + "toast",
    injectableOperation: internalPrefix + "injectables",
    injectable: internalPrefix + "injectable",
    injectionOperation: internalPrefix + "injections",
    injection: internalPrefix + "injection",
    commands: internalPrefix + "commands",
    timelineEvent: internalPrefix + "timelineevent",
    entityEvent: internalPrefix + "entityevent",
}

export const capability = {
    runtimeControl: "runtime",
    scenario: "scenario",
    timeScale: "timescale",
    log: "log",
    playback: "playback",
    launch: "launch"
}