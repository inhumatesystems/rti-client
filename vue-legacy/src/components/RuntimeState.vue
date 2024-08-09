<template>
    <div id="runtime-state" v-if="clientsAvailable">
        <v-btn text disabled v-if="showState">
            <span class="white--text ml-3">{{ stateAsText(aggregatedState) }}</span>
        </v-btn>

        <v-btn text disabled v-if="time && time > 0.2">
            <span class="white--text" :style="time && aggregatedStateIsActive ? '' : 'opacity: 0.5'">{{ formatDuration(time) }}</span>
        </v-btn>
        <v-btn text disabled v-else-if="stopTime">
            <span class="white--text" style="opacity: 0.5">{{ formatDuration(stopTime) }}</span>
        </v-btn>

        <v-menu offset-y>
            <template v-slot:activator="{ on }">
                <v-btn v-if="timeScale" text v-on="on" :style="timeScale == 1 ? 'opacity: 0.5' : ''">{{ timeScale }}x</v-btn>
                <v-btn v-else text v-on="on" style="opacity: 0.5">TS</v-btn>
            </template>
            <v-list>
                <v-list-item v-for="(item, index) in timeScales" :key="index" @click="setTimeScale(item)">
                    <v-list-item-title>{{ item }}x</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
    </div>
    <div v-else-if="emptyText">
        <v-btn text disabled>
            {{ emptyText }}
        </v-btn>
    </div>
</template>

<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator"
import * as RTI from "inhumate-rti-legacy"
import { runtimeStateAsText, formatDuration } from "@/formatting"
import { mapState } from "vuex"

@Component({
    computed: {
        ...mapState({
            time: (state: any) => state.rti.time,
            stopTime: (state: any) => state.rti.stopTime,
            timeScale: (state: any) => state.rti.timeScale,
            clients: (state: any) => state.rti.clients,
            log: (state: any) => state.rti.log,
            states: (state: any) => state.rti.states,
            aggregatedState: (state: any) => state.rti.aggregatedState,
            brand: (state: any) => state.rti.brand,
        }),
    },
})
export default class RuntimeState extends Vue {
    timeScales = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 20, 50]
    time!: number | null
    stopTime!: number | null
    timeScale!: number | null
    clients!: RTI.proto.Client[]
    log!: RTI.proto.Log | null
    states!: { [key: number]: number }
    aggregatedState!: number | null
    brand!: any

    @Prop({ type: Boolean, default: false })
    updateTitle!: boolean

    @Prop({ default: "No clients" })
    emptyText!: string

    get showState() {
        return this.aggregatedState && this.aggregatedState != RTI.proto.RuntimeState.UNKNOWN
    }

    get clientsAvailable() {
        return (
            this.clients.length > 0 &&
            this.clients.find(
                (c) =>
                    (c.getState() == RTI.proto.RuntimeState.UNKNOWN ||
                        (c.getState() > RTI.proto.RuntimeState.LAUNCHING && c.getState() < RTI.proto.RuntimeState.SHUTTING_DOWN)) &&
                    c.getApplication() != "RTI UI" &&
                    c.getApplication() != "CLI"
            )
        )
    }

    get aggregatedStateIsActive() {
        return this.aggregatedState == RTI.proto.RuntimeState.RUNNING || this.aggregatedState == RTI.proto.RuntimeState.PLAYBACK
    }

    @Watch("clients")
    @Watch("states")
    stateChanged() {
        if (this.updateTitle) {
            document.title = this.$rti.federation || this.brand.name || "RTI"
            if (this.aggregatedState && this.showState) {
                document.title += ` - ${this.stateAsText(this.aggregatedState)}`
            } else if (this.clients.length == 0) {
                document.title += " - No clients"
            }
        }
    }

    mounted() {
        this.$store.dispatch("rti/subscribeClients")
    }

    setTimeScale(scale: number) {
        const message = new RTI.proto.RuntimeControl()
        const timeScale = new RTI.proto.RuntimeControl.SetTimeScale()
        timeScale.setTimeScale(scale)
        message.setSetTimeScale(timeScale)
        this.$rti.publish(RTI.channel.control, message, false)
    }

    stateAsText(state: number) {
        if (state < 0) return "???"
        return runtimeStateAsText(state)
    }

    formatDuration(time: number) {
        if (time < 1) return "00:00"
        return formatDuration(time)
    }
}
</script>
