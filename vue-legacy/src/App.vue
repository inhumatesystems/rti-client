<template>
    <v-app>
        <v-app-bar app :color="brand.barColor || 'teal darken-4'" v-if="connected">
            <v-toolbar-title class="headline">
                <router-link to="/" style="text-decoration: none" class="white--text">
                    <div class="font-weight-thin" style="font-family: Inter var">{{ brand.name || "Lab" }} RTI</div>
                </router-link>
                <router-link to="/about" style="text-decoration: none" class="white--text">
                    <div class="caption font-weight-thin" style="font-family: Inter var">{{ version }}</div>
                </router-link>
            </v-toolbar-title>
            <v-spacer></v-spacer>
            <v-chip v-if="brokerPing && brokerPing > 100" color="error" class="mx-3 font-weight-bold">PING {{ brokerPing }} ms</v-chip>
            <runtime-state v-if="connected" update-title empty-text="" />
            <v-btn icon @click="refresh"><v-icon style="opacity: 0.4">mdi-refresh</v-icon></v-btn>
            <v-menu v-if="user" offset-y>
                <template v-slot:activator="{ on }">
                    <v-btn text v-on="on" class="text-none">{{ user }}</v-btn>
                </template>
                <v-list>
                    <v-list-item @click="showChangePassword = true"> Change password </v-list-item>
                    <v-list-item @click="logout()"> Log out </v-list-item>
                </v-list>
            </v-menu>
            <v-btn text v-else-if="authenticated" @click="logout()">Log out</v-btn>
        </v-app-bar>

        <v-main>
            <router-view v-if="connected" />
            <div v-if="!connected && !needAuthentication && timesUp">
                <v-container class="mt-5 display-1 font-weight-thin text-center grey--text">
                    No connection to RTI
                    <div v-if="error" class="title mt-5 font-weight-light error--text">{{ error }}</div>
                    <div class="title mt-5 font-weight-thin">{{ url }}</div>
                </v-container>
            </div>
        </v-main>
    </v-app>
</template>

<style>
.theme--dark.v-application {
    background-color: #1e2022;
}
.v-snack.vts .theme--dark {
    color: white;
    font-size: 22px;
}
.v-snack__content {
    font-size: 18px;
    line-height: 26px;
    white-space: pre-wrap;
}
</style>

<script lang="ts">
import { Component, Vue, Watch } from "vue-property-decorator"
import SubscribingComponent from "./components/subscribingcomponent"
import RuntimeState from "./components/RuntimeState.vue"
import * as RTI from "inhumate-rti-legacy"
import { mapGetters, mapState } from "vuex"

@Component({
    components: {
        RuntimeState,
    },
    computed: {
        ...mapState({
            connected: (state: any) => state.rti.connected,
            needAuthentication: (state: any) => state.rti.needAuthentication,
            error: (state: any) => state.rti.error,
            federation: (state: any) => state.rti.federation,
            user: (state: any) => state.rti.user,
            brand: (state: any) => state.rti.brand,
        }),
        ...mapGetters({
            brokerPing: "rti/brokerPing",
        }),
    },
})
export default class App extends SubscribingComponent {
    connected!: boolean
    needAuthentication!: boolean
    error!: string
    federation!: string
    user!: string
    brand!: any
    brokerPing!: number | undefined
    showChangePassword = false
    timesUp = false
    timeout: any
    pollTimeout?: any
    pollInterval = 5000

    get url() {
        return Vue.$rti.url
    }

    get authenticated() {
        return Vue.$rti.authenticated
    }

    get version() {
        if (Vue.$rti.brokerVersion != RTI.constants.version) {
            let text = ""
            if (Vue.$rti.brokerVersion && Vue.$rti.brokerVersion != "0.0.1-dev-version") {
                text += " broker " + Vue.$rti.brokerVersion
            }
            if (RTI.constants.version && RTI.constants.version != "0.0.1-dev-version") {
                text += " client " + RTI.constants.version
            }
            return text
        } else if (RTI.constants.version && RTI.constants.version != "0.0.1-dev-version") {
            return RTI.constants.version
        }
        return ""
    }

    mounted() {
        Vue.$rti.on("connect", () => {
            document.title = Vue.$rti.federation || this.brand.name || "RTI"
        })
        Vue.$rti.on("disconnect", () => {
            document.title = (Vue.$rti.federation || this.brand.name || "RTI") + " - Disconnected"
        })
        this.tickTock()
        this.poll()
        this.subscribeText(RTI.channel.toast, this.$toast)
    }

    destroyed() {
        if (this.pollTimeout) clearTimeout(this.pollTimeout)
    }

    login() {
        this.tickTock()
    }

    logout() {
        this.$store.commit("rti/logout")
    }

    tickTock() {
        if (this.timeout) clearTimeout(this.timeout)
        this.timesUp = false
        this.timeout = setTimeout(() => {
            this.timesUp = true
        }, 1500)
    }

    poll() {
        this.pollTimeout = setTimeout(() => {
            this.poll()
        }, this.pollInterval)
    }

    changeFederation(federation: string) {
        this.timesUp = false
        setTimeout(() => {
            this.timesUp = true
        }, 1500)
        sessionStorage.rtiFederation = federation
        if (location.search.indexOf("federation=") >= 0) {
            location.search = location.search.replace(/federation=\w+/, "")
        } else {
            location.reload()
        }
    }

    @Watch("brand")
    watchBrand() {
        if (this.brand.theme == "light") this.$vuetify.theme.dark = false
        const theme = this.$vuetify.theme.dark ? this.$vuetify.theme.themes.dark : this.$vuetify.theme.themes.light
        if (this.brand.primaryColor) theme.primary = this.brand.primaryColor
        if (this.brand.secondaryColor) theme.secondary = this.brand.secondaryColor
        if (this.brand.infoColor) theme.info = this.brand.infoColor
        if (this.brand.warningColor) theme.warning = this.brand.warningColor
        if (this.brand.errorColor) theme.error = this.brand.errorColor
    }

    refresh() {
        this.$store.dispatch("refresh")
        this.$root.$emit("refresh")
    }
}
</script>
