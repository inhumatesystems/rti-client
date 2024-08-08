import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)

import rti from "../src"
app.use(rti, { application: "vue" })

import { createPinia } from "pinia"
app.use(createPinia())

app.mount('#app')
