import { Vue } from "vue-property-decorator";
import * as RTI from "inhumate-rti-legacy";
export default class SubscribingComponent extends Vue {
    subscriptions: RTI.Subscription[];
    destroyed(): void;
    subscribe(channelName: string, type: any, handler: (message: any) => any, register?: boolean): RTI.Subscription;
    subscribeText(channelName: string, handler: (message: string) => any, register?: boolean): RTI.Subscription;
    subscribeJSON(channelName: string, handler: (message: any) => any, register?: boolean): RTI.Subscription;
    unsubscribe(): void;
}
