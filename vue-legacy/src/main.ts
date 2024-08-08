import Vue from "vue"
import "./plugins/vuetify-toast-snackbar"
import vuetify from "./plugins/vuetify"
import store from "./store"
import router from "./router"

import rtiui from "./index"
import constants from "./constants"
Vue.use(rtiui, {
    application: "vue-legacy",
    applicationVersion: constants.version,
    url: process.env.VUE_APP_RTI_URL,
    store,
})

import App from "./App.vue"

Vue.config.productionTip = false

new Vue({
    vuetify,
    store,
    router,
    render: (h) => h(App),
}).$mount("#app")
;(window as any).store = store
;(window as any).rti = Vue.$rti
