import { Component, Vue } from "vue-property-decorator"
import * as RTI from "@inhumate/rti-legacy"

@Component({})
export default class SubscribingComponent extends Vue {
    subscriptions: RTI.Subscription[] = []
    destroyed() {
        this.unsubscribe()
    }

    subscribe(channelName: string, type: any, handler: (message: any) => any, register = true): RTI.Subscription {
        const subscription = this.$rti.subscribe(channelName, type, handler, register)
        this.subscriptions.push(subscription)
        return subscription
    }

    subscribeText(channelName: string, handler: (message: string) => any, register = true): RTI.Subscription {
        const subscription = this.$rti.subscribeText(channelName, handler, register)
        this.subscriptions.push(subscription)
        return subscription
    }

    subscribeJSON(channelName: string, handler: (message: any) => any, register = true): RTI.Subscription {
        const subscription = this.$rti.subscribeJSON(channelName, handler, register)
        this.subscriptions.push(subscription)
        return subscription
    }

    unsubscribe() {
        for (const sub of this.subscriptions) {
            this.$rti.unsubscribe(sub)
        }
        this.subscriptions = []
    }
}
