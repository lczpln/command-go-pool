<script setup lang="ts">
import { computed, ref } from "vue";
import { store } from "../composables/usePool";
import ClientCard from "../components/ClientCard.vue";
import Skeleton from "../components/Skeleton.vue";

const message = ref<{ ok: boolean; text: string } | null>(null);
const clients = computed(() => store.clients);
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-lg">Clients</h1>
        <p class="mt-1 max-w-xl text-sm text-mist">
          Local coding CLIs that send traffic to this pool. Connect writes pool config into the path below. If the CLI runs in another container, share that file with a volume and point this path at the mount.
        </p>
      </div>
      <Skeleton v-if="!store.ready" class="h-3 w-20" />
      <p v-else class="font-mono text-[11px] text-mist">{{ clients.filter((c) => c.connected).length }} connected</p>
    </header>

    <p v-if="message" class="whitespace-pre-wrap font-mono text-[12px]" :class="message.ok ? 'text-ok' : 'text-bad'">
      {{ message.text }}
    </p>

    <div v-if="!store.ready" class="space-y-2" role="status" aria-label="Loading clients">
      <div v-for="i in 2" :key="i" class="border border-line bg-panel px-4 py-4">
        <Skeleton class="h-3.5 w-32" />
        <Skeleton class="mt-2 h-2.5 w-64" />
      </div>
    </div>
    <div v-else class="space-y-3">
      <ClientCard v-for="client in clients" :key="client.id" :client="client" @message="message = $event" />
    </div>
  </div>
</template>
