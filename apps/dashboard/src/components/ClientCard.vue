<script setup lang="ts">
import { ref, watch } from "vue";
import { connectClient, disconnectClient, type PoolClient } from "../composables/usePool";

const props = defineProps<{
  client: PoolClient;
}>();

const emit = defineEmits<{
  message: [value: { ok: boolean; text: string }];
}>();

const busy = ref(false);
const draft = ref(props.client.configPath);

watch(
  () => props.client.configPath,
  (path) => {
    if (!busy.value) draft.value = path;
  },
);

function stateLabel() {
  if (props.client.connected) return "CONNECTED";
  if (props.client.installed) return "INSTALLED";
  return "NOT FOUND";
}

async function toggle() {
  busy.value = true;
  try {
    const result = props.client.connected
      ? await disconnectClient(props.client.id)
      : await connectClient(props.client.id, draft.value);
    emit("message", { ok: true, text: result.message });
  } catch (error) {
    emit("message", { ok: false, text: error instanceof Error ? error.message : "Request failed" });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article class="border border-line bg-panel px-4 py-4">
    <header class="flex flex-wrap items-baseline justify-between gap-3">
      <h2 class="font-mono text-[13px] tracking-wide">{{ client.name }}</h2>
      <p class="font-mono text-[11px]" :class="client.connected ? 'text-ok' : 'text-mist'">{{ stateLabel() }}</p>
    </header>
    <label class="mt-2 block">
      <span class="font-mono text-[11px] uppercase tracking-wider text-mist">Config path</span>
      <input
        v-model="draft"
        class="mt-1 w-full border border-line bg-ink px-2 py-1.5 font-mono text-[11px] text-paper outline-none focus:border-amber disabled:opacity-50"
        :aria-label="`${client.name} config path`"
        :disabled="client.connected || busy"
        spellcheck="false"
      />
    </label>
    <p v-if="client.howToRun" class="mt-1 font-mono text-[11px] text-paper">{{ client.howToRun }}</p>
    <footer class="mt-3 flex justify-end">
      <button
        type="button"
        class="border border-line px-2 py-0.5 font-mono text-[11px] text-paper hover:border-amber disabled:opacity-50"
        :disabled="busy"
        @click="toggle"
      >
        {{ busy ? "Working…" : client.connected ? "Disconnect" : "Connect" }}
      </button>
    </footer>
  </article>
</template>
