<script setup lang="ts">
import { computed, ref } from "vue";
import { saveProxyApiKey, store } from "../composables/usePool";

const key = ref("");
const busy = ref(false);
const message = ref<string | null>(null);
const configured = computed(() => {
  const server = store.config?.server as { apiKey?: string } | undefined;
  return server?.apiKey === "[set]";
});

async function save() {
  busy.value = true;
  message.value = null;
  try {
    await saveProxyApiKey(key.value.trim());
    key.value = "";
    message.value = "Local proxy key saved. Clients send it as Authorization: Bearer.";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Failed to save key";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="border border-line bg-panel">
    <header class="border-b border-line px-4 py-3">
      <p class="font-mono text-[11px] tracking-[0.28em] text-mist">LOCAL PROXY KEY</p>
      <h2 class="mt-1 text-sm">Optional key for OpenCode, Claude, and curl</h2>
    </header>
    <form class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-end" @submit.prevent="save">
      <label class="block min-w-0 flex-1">
        <span class="font-mono text-[11px] uppercase tracking-wider text-mist">
          COMMAND_GO_PROXY_API_KEY
          <span class="text-paper">{{ configured ? "· set" : "· unset" }}</span>
        </span>
        <input
          v-model="key"
          class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
          type="password"
          :placeholder="configured ? '••••••••  replace key' : 'leave empty on localhost'"
          autocomplete="new-password"
        />
      </label>
      <button class="border border-line px-3 py-2 font-mono text-[12px] hover:border-amber disabled:opacity-50" :disabled="busy" type="submit">
        {{ busy ? "Saving…" : "Save" }}
      </button>
    </form>
    <p class="border-t border-line px-4 py-2 font-mono text-[11px] text-mist">
      Required if you bind outside 127.0.0.1. Not an upstream Command Code credential. This screen never echoes the value back.
    </p>
    <p v-if="message" class="px-4 pb-3 font-mono text-[12px] text-ok">{{ message }}</p>
  </section>
</template>
