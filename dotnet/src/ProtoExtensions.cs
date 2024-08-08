using System.Collections.Generic;
using System.Linq;

namespace Inhumate.RTI.Proto {

    public static class ProtoExtensions {

        public static Command Argument(this Command command, string name, string defaultValue = "", string type = "string", string description = "", bool required = false) {
            return command.Argument(new Parameter {
                Name = name,
                DefaultValue = defaultValue,
                Type = type,
                Description = description,
                Required = required
            });
        }

        public static Command Argument(this Command command, Parameter argument) {
            command.Arguments.Add(argument);
            return command;
        }

        public static string GetArgumentValue(this Command command, ExecuteCommand exec, string argumentName) {
            if (exec.Arguments.ContainsKey(argumentName)) return exec.Arguments[argumentName];
            var argument = command.Arguments.Where(a => a.Name == argumentName).FirstOrDefault();
            var index = command.Arguments.IndexOf(argument);
            if (exec.Arguments.ContainsKey(index.ToString())) return exec.Arguments[index.ToString()];
            if (argument != null) return argument.DefaultValue;
            return null;
        }

        public static CommandResponse Return(this CommandResponse response, string name, string value) {
            response.ReturnValues.Add(name, value);
            return response;
        }

    }

}
