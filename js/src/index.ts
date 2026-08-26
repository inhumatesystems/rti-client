export { RTIClient as Client, DispatchMode } from "./rticlient.js"
export type { RTIOptions as Options, EncodableMessageType, DecodableMessageType } from "./rticlient.js"
export { RTIRuntimeControl as RuntimeControl, StepGrant } from "./rtiruntimecontrol.js"

// Everything the contract generates, straight off its own index.
export { proto, constants, channel, channelTypeName, channels, channelType, capability } from "./generated/index.js"

import { RTIClient } from "./rticlient.js"
export default RTIClient
