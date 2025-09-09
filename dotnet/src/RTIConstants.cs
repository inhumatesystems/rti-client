namespace Inhumate.RTI {
    public static class RTIConstants {
        public const string Version = "0.0.1-dev-version";
        internal const string DefaultUrl = "ws://localhost:8000/";
    }
    public static class RTIChannel
    {
        public const string InternalPrefix = "rti/";
        public const string Control = InternalPrefix + "control";
        public const string Channels = InternalPrefix + "channels";
        public const string Clients = InternalPrefix + "clients";
        public const string EntityOperation = InternalPrefix + "entities";
        public const string Entity = InternalPrefix + "entity";
        public const string Position = InternalPrefix + "position";
        public const string Scenarios = InternalPrefix + "scenarios";
        public const string LaunchConfigurations = InternalPrefix + "launchconfigurations";
        public const string Launch = InternalPrefix + "launch";
        public const string Logs = InternalPrefix + "logs";
        public const string BrokerStats = InternalPrefix + "brokerstats";
        public const string BrokerPings = InternalPrefix + "brokerpings";
        public const string ClientConnect = InternalPrefix + "clientconnect";
        public const string ClientDisconnect = InternalPrefix + "clientdisconnect";
        public const string MessageBundle = InternalPrefix + "messagebundle";
        public const string GeometryOperation = InternalPrefix + "geometries";
        public const string Geometry = InternalPrefix + "geometry";
        public const string Measures = InternalPrefix + "measures";
        public const string Measurement = InternalPrefix + "measurement";
        public const string MeasurementBundle = InternalPrefix + "measurementbundle";
        public const string Toast = InternalPrefix + "toast";
        public const string InjectableOperation = InternalPrefix + "injectables";
        public const string Injectable = InternalPrefix + "injectable";
        public const string InjectionOperation = InternalPrefix + "injections";
        public const string Injection = InternalPrefix + "injection";
        public const string Commands = InternalPrefix + "commands";
        public const string TimelineEvent = InternalPrefix + "timelineevent";
        public const string EntityEvent = InternalPrefix + "entityevent";
    }
    public static class RTICapability {
        public const string RuntimeControl = "runtime";
        public const string Scenario = "scenario";
        public const string TimeScale = "timescale";
        public const string Log = "log";
        public const string Playback = "playback";
        public const string Launch = "launch";
    }
}
