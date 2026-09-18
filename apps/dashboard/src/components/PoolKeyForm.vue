<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { rotatePoolApiKey, savePoolApiKey, store } from "../composables/usePool";
import Skeleton from "./Skeleton.vue";

const key = ref("");
const revealed = ref(false);
const applied = ref(false);
const seeded = ref(false);
const busy = ref(false);
const copied = ref(false);
const message = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const configured = computed(() => {
  const server = store.config?.server as { apiKey?: string } | undefined;
  return server?.apiKey === "[set]";
});

watch(
  () => store.ready,
  (ready) => {
    if (!ready || seeded.value) return;
    seeded.value = true;
    if (configured.value) applied.value = true;
  },
  { immediate: true },
);

function updatedLabel(updated: Array<{ id: string; ok: boolean }>) {
  const names = updated
    .filter((row) => row.ok)
    .map((row) => (row.id === "claude" ? "Claude Code" : row.id === "opencode" ? "OpenCode" : row.id === "codex" ? "Codex Desktop" : row.id));
  if (names.length === 0) return "No connected CLIs to update.";
  return `Updated ${names.join(" and ")}.`;
}

async function rotate() {
  busy.value = true;
  message.value = null;
  copied.value = false;
  clearTimeout(copiedTimer);
  try {
    const replacing = applied.value;
    const result = await rotatePoolApiKey();
    key.value = result.apiKey;
    revealed.value = true;
    applied.value = true;
    message.value = `${replacing ? "Local pool key rotated." : "Local pool key saved."} ${updatedLabel(result.updated)} Copy it now; this screen will not show it again.`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Failed to rotate key";
  } finally {
    busy.value = false;
  }
}

async function clearKey() {
  busy.value = true;
  message.value = null;
  try {
    await savePoolApiKey("");
    key.value = "";
    revealed.value = false;
    applied.value = false;
    message.value = "Pool API key removed. Inference is open again; connected CLIs keep a placeholder key.";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Failed to clear key";
  } finally {
    busy.value = false;
  }
}

async function copy() {
  if (!revealed.value || !key.value) return;
  try {
    await navigator.clipboard.writeText(key.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
    }, 1200);
  } catch {
    message.value = "Could not copy. Select the key and copy it manually.";
  }
}

function selectKey(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement && revealed.value && key.value) input.select();
}
</script>

<template>
  <section class="border border-line bg-panel">
    <header class="border-b border-line px-4 py-3">
      <p class="font-mono text-[11px] tracking-[0.28em] text-mist">LOCAL PROXY KEY</p>
      <h2 class="mt-1 text-sm">Optional lock for inference. Not required.</h2>
    </header>
    <form class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-end" @submit.prevent="rotate">
      <label class="block min-w-0 flex-1">
        <span class="font-mono text-[11px] uppercase tracking-wider text-mist">
          COMMAND_GO_POOL_API_KEY
          <Skeleton v-if="!store.ready" class="ml-1 h-2.5 w-10 align-middle" />
          <span v-else class="text-paper">{{ configured ? "· set" : "· unset" }}</span>
        </span>
        <span class="relative mt-1 block">
          <input
            v-model="key"
            class="w-full border border-line bg-ink py-2 pl-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
            :class="revealed && key ? 'pr-9' : 'pr-2'"
            type="text"
            readonly
            spellcheck="false"
            autocomplete="off"
            :placeholder="configured ? '••••••••  generate to replace' : 'unset — generate only if you want a lock'"
            @focus="selectKey"
          />
          <button
            v-if="revealed && key"
            class="absolute inset-y-0 right-0 flex w-9 items-center justify-center hover:text-amber disabled:opacity-50"
            :class="copied ? 'text-ok hover:text-ok' : 'text-mist'"
            :disabled="busy"
            type="button"
            :aria-label="copied ? 'Copied' : 'Copy'"
            :title="copied ? 'Copied' : 'Copy'"
            @click="copy"
          >
            <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
            </svg>
          </button>
        </span>
      </label>
      <button class="border border-line px-3 py-2 font-mono text-[12px] hover:border-amber disabled:opacity-50" :disabled="busy || !store.ready" type="submit">
        {{ busy ? "Saving…" : configured ? "Rotate" : "Generate" }}
      </button>
      <button
        v-if="configured"
        class="border border-line px-3 py-2 font-mono text-[12px] text-mist hover:border-bad hover:text-bad disabled:opacity-50"
        :disabled="busy || !store.ready"
        type="button"
        @click="clearKey"
      >
        Remove
      </button>
    </form>
    <p class="border-t border-line px-4 py-2 font-mono text-[11px] text-mist">
      Optional. Clients work without it. If you generate one, connected CLIs on the Clients page receive the new key automatically.
    </p>
    <p v-if="message" class="px-4 pb-3 font-mono text-[12px] text-ok">{{ message }}</p>
  </section>
</template>
