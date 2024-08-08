<template>
    <span>{{ rti.stateText }}</span>
</template>

<script setup lang="ts">
import { useRtiStore } from "@/rti"
const rti = useRtiStore()
</script>
