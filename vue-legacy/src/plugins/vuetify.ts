import Vue from "vue"
import Vuetify, { colors } from "vuetify/lib"

Vue.use(Vuetify)

export default new Vuetify({
    icons: {
        iconfont: "mdi",
    },
    theme: {
        dark: true,
        themes: {
            dark: {
                primary: colors.teal.lighten2,
                error: "#c34",
                secondary: "#888",
            },
        },
    },
})
