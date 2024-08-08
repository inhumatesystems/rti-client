// Typescript declarations for RTI UI as a component library

// There are some unresolved issues, see TODO below.

// Some notes on implementation:
//  - sources of inspiration
//      https://medium.com/justfrontendthings/how-to-create-and-publish-your-own-vuejs-component-library-on-npm-using-vue-cli-28e60943eed3
//      https://github.com/MikeMitterer/vue-ts-sfc-starter
//      https://vuejs.org/v2/guide/typescript.html#Augmenting-Types-for-Use-with-Plugins
//
//  - the double-vue problem haunted me for well over a day, see 
//    https://github.com/vuetifyjs/vuetify/issues/11893 and https://github.com/vuetifyjs/vuetify/discussions/4068

// vue.config.js that makes consumers of the library work:
//
// const path = require("path");
// module.exports = {
//   "transpileDependencies": [
//     "vuetify"
//   ],
//   configureWebpack: {
//     resolve: {
//       symlinks: false,
//       alias: {
//         'vue$': path.resolve(__dirname, 'node_modules/vue/dist/vue.esm.js'),
//       }
//     }
//   }
// };


import { RTIClient, RTIOptions } from "@inhumate/rti-legacy"
import Vue, { VueConstructor, PluginFunction } from "vue"

declare module "vue/types/vue" {
    export interface Vue {
        $rti: RTIClient
    }
    export interface VueConstructor {
        $rti: RTIClient
    }
}

// TODO: why isn't it enough with just the above?
// like vuetify: https://github.com/vuetifyjs/vuetify/blob/master/packages/vuetify/types/index.d.ts
// and why doesn't this.$rti compile in a Vuetify project, but it does in a pure vue project? Vue.$rti works...

declare module "vue" {
    export interface Vue {
        $rti: RTIClient
    }
    export interface VueConstructor {
        $rti: RTIClient
    }
}
import { Vue as VPDVue, VueConstructor as VPDVueConstructor } from "vue-property-decorator"
declare module "vue-property-decorator" {
    export interface Vue {
        $rti: RTIClient
    }
    export interface VueConstructor {
        $rti: RTIClient
    }
}

import SubscribingComponent from "./components/subscribingcomponent"

export class RuntimeState extends Vue {}
export class RuntimeControl extends SubscribingComponent {}
export class PlaybackTimeline extends SubscribingComponent {}
export class Log extends SubscribingComponent {}
export class Logs extends SubscribingComponent {}
export class LogsDialog extends Vue {}
export class LaunchControl extends SubscribingComponent {}
export class Errors extends Vue {}
export class Clients extends SubscribingComponent {}
export class Channels extends SubscribingComponent {}
export class LoginDialog extends Vue {}
export class ChangePasswordDialog extends Vue {}
export class ConfirmationDialog extends Vue {}
export class InjectionList extends Vue {}
export class Inject extends Vue {}
export class Parameters extends Vue {}
export class ImageSubscription extends SubscribingComponent {}

export interface RtiUiPluginOptions extends RTIOptions {
    store?: any
}

declare const RtiUiPlugin: RtiUiPlugin
export default RtiUiPlugin
export interface RtiUiPlugin {
    install: PluginFunction<RtiUiPluginOptions>
}

import constants from "./constants"
export * from "./formatting"
export { constants, SubscribingComponent }
