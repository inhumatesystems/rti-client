<template>
    <div class="about">
        <v-container class="text-center">
            <h2 class="my-3">RTI UI</h2>
            <p><span class="grey--text body-2">Version</span> {{ constants.version }}</p>
            <p class="grey--text body-2">Client version {{ rtiConstants.version }}</p>
            <p class="grey--text body-2">Broker version {{ brokerVersion }}</p>
        </v-container>
    </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator"
import constants from "@/constants"
import { constants as rtiConstants } from "@inhumate/rti-legacy"

@Component({})
export default class About extends Vue {
    constants = constants
    rtiConstants = rtiConstants

    get brokerVersion() {
        return Vue.$rti.brokerVersion
    }
}
</script>
