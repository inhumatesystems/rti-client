<template>
    <div style="display: flex; justify-content: center">
        <div :style="style" v-if="imageData">
            <img :src="'data:' + type + ';base64,' + imageData" style="width: 100%; opacity: 0" />
        </div>
        <div v-else>
            <slot></slot>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue"
import { computed, onMounted, ref, watch } from "vue"
import { useRtiStore } from "@/rti"

const rti = useRtiStore()

const props = defineProps<{
    channel: string
    type?: string
    fade?: string
    scale?: boolean
}>()

const imageData = ref("")

const style = computed(() => {
    return (
        "display: inline" +
        (imageData.value ? `; background-image:url('data:${props.type};base64,${imageData.value}');` : "; background: transparent") +
        (props.scale ? "; width: 100%; background-size: cover" : "background-size: contain; background-repeat: no-repeat") +
        `; transition: background ${props.fade}`
    )
})

watch(
    () => props.channel,
    () => {
        imageData.value = ""
        if (props.channel) subscribeToImage()
    }
)

onMounted(() => {
    if (props.channel) subscribeToImage()
})

onUnmounted(() => {
    if (subscription) unsubscribe()
})

let subscription: any = undefined
function subscribeToImage() {
    if (subscription) unsubscribe()
    subscription = rti.client.subscribeText(props.channel, (data: string) => {
        imageData.value = data
    }, false)
}

function unsubscribe() {
    if (subscription) {
        rti.client.unsubscribe(subscription)
        subscription = undefined
    }
}
</script>
