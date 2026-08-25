<script setup lang="ts">
import { computed, ref } from "vue";
import { store, connectClient, disconnectClient, type PoolClient } from "../composables/usePool";
import Skeleton from "../components/Skeleton.vue";

const busy = ref<string | null>(null);
const message = ref<{ ok: boolean; text: string } | null>(null);

const clients = computed(() => store.clients);

function stateLabel(client: PoolClient) {
  if (client.connected) return "CONNECTED";
  if (client.installed) return "INSTALLED";
  return "NOT FOUND";
}

async function toggle(client: PoolClient) {
  busy.value = client.id;
  message.value = null;
  try {
    const result = client.connected ? await disconnectClient(client.id) : await connectClient(client.id);
    message.value = { ok: true, text: result.message };
  } catch (error) {
    message.value = { ok: false, text: error instanceof Error ? error.message : "Request failed" };
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-lg">Clients</h1>
        <p class="mt-1 max-w-xl text-sm text-mist">
          Local coding CLIs that send traffic to this pool. Connect writes pool config into the CLI folder. A pool API key is optional; if you generate one on Settings, connected CLIs are updated automatically.
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
      <article v-for="client in clients" :key="client.id" class="border border-line bg-panel px-4 py-4">
        <header class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="font-mono text-[13px] tracking-wide">{{ client.name }}</h2>
          <p class="font-mono text-[11px]" :class="client.connected ? 'text-ok' : 'text-mist'">{{ stateLabel(client) }}</p>
        </header>
        <p class="mt-2 font-mono text-[11px] text-mist">{{ client.configPath }}</p>
        <p v-if="client.howToRun" class="mt-1 font-mono text-[11px] text-paper">{{ client.howToRun }}</p>
        <footer class="mt-3 flex justify-end">
          <button
            type="button"
            class="border border-line px-2 py-0.5 font-mono text-[11px] text-paper hover:border-amber disabled:opacity-50"
            :disabled="busy === client.id"
            @click="toggle(client)"
          >
            {{ busy === client.id ? "Working…" : client.connected ? "Disconnect" : "Connect" }}
          </button>
        </footer>
      </article>
    </div>
  </div>
</template>
