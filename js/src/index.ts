export { RTIClient as Client } from "./rticlient.js"
export type { RTIOptions as Options } from "./rticlient.js"

import * as proto from "./proto.js"
export { proto }

import constants, { channel, capability } from "./constants.js"
export { constants, channel, capability }

import { RTIClient } from "./rticlient.js"
export default RTIClient
