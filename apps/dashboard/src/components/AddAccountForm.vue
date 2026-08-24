<script setup lang="ts">
import { computed, ref } from "vue";
import { addAccount, store } from "../composables/usePool";

const emit = defineEmits<{ added: [] }>();

const label = ref("");
const credential = ref("");
const cost = ref("1");
const busy = ref(false);
const result = ref<{ ok: boolean; message: string } | null>(null);

const suggested = computed(() => `Go #${String(store.accounts.length + 1).padStart(2, "0")}`);

async function submit() {
  result.value = null;
  const name = label.value.trim() || suggested.value;
  const key = credential.value.trim();
  if (!key) {
    result.value = { ok: false, message: "Studio API key is required" };
    return;
  }
  busy.value = true;
  try {
    const created = await addAccount({
      label: name,
      credential: key,
      monthlySubscriptionCost: Number(cost.value) || undefined,
    });
    credential.value = "";
    label.value = "";
    result.value = {
      ok: created.test.ok,
      message: created.test.ok ? "Authentication successful · account ready" : created.test.message,
    };
    emit("added");
  } catch (error) {
    result.value = { ok: false, message: error instanceof Error ? error.message : "Failed to add account" };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="border border-line bg-panel">
    <header class="border-b border-line px-4 py-3">
      <p class="font-mono text-[11px] tracking-[0.28em] text-mist">COMMISSION ACCOUNT</p>
      <h2 class="mt-1 text-sm">Seat a Command Code Go key into the pool</h2>
    </header>
    <form class="grid gap-3 px-4 py-4 md:grid-cols-[1fr_1.4fr_6rem_auto] md:items-end" @submit.prevent="submit">
      <label class="block">
        <span class="font-mono text-[11px] uppercase tracking-wider text-mist">Label</span>
        <input
          v-model="label"
          class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
          :placeholder="suggested"
          autocomplete="off"
        />
      </label>
      <label class="block">
        <span class="font-mono text-[11px] uppercase tracking-wider text-mist">Studio API key</span>
        <input
          v-model="credential"
          class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
          type="password"
          name="command-code-key"
          placeholder="user_…"
          autocomplete="new-password"
          spellcheck="false"
        />
      </label>
      <label class="block">
        <span class="font-mono text-[11px] uppercase tracking-wider text-mist">$/mo</span>
        <input
          v-model="cost"
          class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
          inputmode="decimal"
        />
      </label>
      <button
        class="border border-amber px-3 py-2 font-mono text-[12px] text-amber hover:bg-amber hover:text-ink disabled:opacity-50"
        :disabled="busy"
        type="submit"
      >
        {{ busy ? "Testing…" : "Add to pool" }}
      </button>
    </form>
    <p class="border-t border-line px-4 py-2 font-mono text-[11px] text-mist">
      The key is encrypted at rest and never shown again. Paste a Studio key you own — the proxy will not create accounts.
    </p>
    <p v-if="result" class="px-4 pb-3 font-mono text-[12px]" :class="result.ok ? 'text-ok' : 'text-bad'">
      {{ result.ok ? "✓" : "✗" }} {{ result.message }}
    </p>
  </section>
</template>
