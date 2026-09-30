<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import ChatMainApp from '@/apps/chat-main/ChatMainApp.vue'

const route = useRoute()
const router = useRouter()
const isReady = ref(false)

router.isReady().then(() => {
  isReady.value = true
})

const isAuthPage = computed(() => route.name === 'login')
</script>

<template>
  <div v-if="!isReady" class="h-screen w-screen" />
  <div v-else-if="isAuthPage" class="h-screen w-screen">
    <RouterView />
  </div>
  <ChatMainApp v-else />
</template>
