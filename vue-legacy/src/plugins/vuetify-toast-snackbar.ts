import Vue from "vue"
import Vuetify, { VSnackbar, VBtn, VIcon } from "vuetify/lib"
import VuetifyToast from "vuetify-toast-snackbar-ng"

Vue.use(Vuetify, {
    components: {
        VSnackbar,
        VBtn,
        VIcon,
    },
})

Vue.use(VuetifyToast, {
    x: "center", // default
    y: "bottom", // default
    color: "#008078", // default
    icon: "",
    iconColor: "", // default
    classes: ["body-1"],
    timeout: 5000, // default
    dismissable: true, // default
    multiLine: false, // default
    vertical: false, // default
    queueable: false, // default
    showClose: false, // default
    closeIcon: "mdi-close",
    closeText: "", // default
    closeColor: "", // default
    shorts: {
        custom: {
            color: "purple",
        },
    },
    property: "$toast", // default
})
