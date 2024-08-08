<template>
    <div style="display: flex; justify-content: center">
        <div :style="style" v-if="imageData">
            <img :src="'data:' + type + ';base64,' + imageData" style="width: 100%; opacity: 0" />
        </div>
        <slot v-else></slot>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Watch } from "vue-property-decorator"
import SubscribingComponent from "./subscribingcomponent"
import * as RTI from "@inhumate/rti-legacy"

@Component({})
export default class ImageSubscription extends SubscribingComponent {
    @Prop({ required: true })
    channel!: string

    @Prop({ default: "image/jpeg" })
    type!: string

    @Prop({ default: "none" })
    fade!: string

    @Prop({ type: Boolean, default: false })
    scale!: Boolean

    imageData = ""
    subscription?: RTI.Subscription

    get style() {
        return (
            "display: inline" +
            (this.imageData ? `; background-image:url('data:${this.type};base64,${this.imageData}');` : "; background: transparent") +
            (this.scale ? "; width: 100%; background-size: cover" : "background-size: contain") +
            `; transition: background ${this.fade}`
        )
    }

    @Watch("channel")
    changeChannel() {
        this.imageData = ""
        if (this.channel) this.subscribeToImage()
    }

    mounted() {
        if (this.channel) this.subscribeToImage()
    }

    subscribeToImage() {
        if (this.subscription) this.unsubscribe()
        this.subscription = this.subscribeText(this.channel, (data) => {
            this.imageData = data
        })
    }
}
</script>
