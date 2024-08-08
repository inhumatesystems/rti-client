# Utility class to simplify providing RTI commands

# Example usage:
# def my_command(arguments: dict):
#     # ...
#     if success:
#         return (True, "")
#     else:
#         return (False, "Stuff didn't go well")
# RTICommand("my_command", my_command, parameters=["param1", "param2"], description="My fantastic command")
# RTICommand.subscribe(rti)


from . import RTIClient, proto as Proto, channel as Channel

class RTICommand:
    all_commands = dict()

    def __init__(self, name, handler, parameters = [], description = None):
        self.name = name
        self.handler = handler
        self.description = description
        self.parameters = parameters
        RTICommand.all_commands[name] = self

    def check_missing_parameters(self, arguments: dict):
        for p in self.parameters:
            if p not in arguments:
                return False
        return True
    
    def execute(self, arguments: dict):
        return self.handler(arguments)
    
    def publish(self, rti):
        cmds = Proto.Commands()
        cmds.command.name = self.name
        if self.description:
            cmds.command.description = self.description
        for parameter in self.parameters:
            p = cmds.command.arguments.add()
            p.name = parameter
            p.required = True
        rti.publish(Channel.commands, cmds)

    @staticmethod
    def publish_all(rti: RTIClient):
        for key, cmd in RTICommand.all_commands.items():
            cmd.publish(rti)

    @staticmethod
    def subscribe(rti: RTIClient):
        def on_command(channelName: str, msg: Proto.Commands):
            if msg.HasField('request_commands'):
                RTICommand.publish_all(rti)
            if msg.HasField('command'):
                pass
            if msg.HasField('execute'):
                cmd = RTICommand.all_commands.get(msg.execute.name, None)
                if cmd:
                    if msg.execute.transaction_id:
                        response = Proto.Commands()
                        response.response.transaction_id = msg.execute.transaction_id
                        if not cmd.check_missing_parameters(msg.execute.arguments):
                            response.response.failed = True
                            response.response.message = "Missing parameter."
                        else:
                            (success, message) = cmd.execute(msg.execute.arguments)
                            response.response.message = message
                            if success:
                                response.response.failed = False
                            else:
                                response.response.failed = True

                        rti.publish(channelName, response)

            if msg.HasField('response'):
                pass

        rti.subscribe(Channel.commands, Proto.Commands, on_command)
        rti.subscribe(rti.own_channel_prefix + Channel.commands, Proto.Commands, on_command)
