<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { store, patchAccount } from "../composables/usePool";
import QuotaBar from "../components/QuotaBar.vue";
import StatusPill from "../components/StatusPill.vue";
import ModelBadges from "../components/ModelBadges.vue";
import Skeleton from "../components/Skeleton.vue";

const route = useRoute();
const account = computed(() => store.accounts.find((a) => a.id === route.params.id));
const sessions = computed(() => store.sessions.filter((s) => s.accountId === route.params.id));

const credential = ref("");
const busy = ref(false);
const result = ref<{ ok: boolean; message: string } | null>(null);

async function rotate() {
  if (!account.value) return;
  const key = credential.value.trim();
  if (!key) {
    result.value = { ok: false, message: "Studio API key is required" };
    return;
  }
  busy.value = true;
  result.value = null;
  try {
    await patchAccount(account.value.id, { credential: key });
    credential.value = "";
    const next = store.accounts.find((a) => a.id === account.value?.id);
    result.value = {
      ok: next?.status !== "auth_error",
      message: next?.status === "auth_error" ? "Credential stored, authentication failed" : "Credential replaced",
    };
  } catch (error) {
    result.value = { ok: false, message: error instanceof Error ? error.message : "Failed to replace credential" };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!store.ready" class="space-y-4" role="status" aria-label="Loading account">
    <RouterLink to="/accounts" class="font-mono text-[11px] text-mist">← Accounts</RouterLink>
    <header class="flex items-baseline justify-between">
      <Skeleton class="h-5 w-32" />
      <Skeleton class="h-3 w-16" />
    </header>
    <div class="space-y-2 border border-line bg-panel p-3">
      <div v-for="i in 3" :key="i" class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-2">
        <Skeleton class="h-2.5 w-8" />
        <Skeleton class="h-[7px] w-full" />
        <Skeleton class="h-2.5 w-16" />
      </div>
    </div>
    <div class="flex gap-1">
      <Skeleton v-for="i in 3" :key="i" class="h-5 w-28" />
    </div>
    <section>
      <h2 class="mb-2 text-sm">Sessions</h2>
      <div class="space-y-1">
        <Skeleton v-for="i in 3" :key="i" class="h-9 w-full" />
      </div>
    </section>
  </div>
  <div v-else-if="account" class="space-y-4">
    <RouterLink to="/accounts" class="font-mono text-[11px] text-mist">← Accounts</RouterLink>
    <header class="flex items-baseline justify-between">
      <h1 class="font-mono text-lg">{{ account.label }}</h1>
      <StatusPill :status="account.status" />
    </header>
    <div class="space-y-1.5 border border-line bg-panel p-3">
      <QuotaBar label="5h" :window="account.quota.fiveHour" />
      <QuotaBar label="Week" :window="account.quota.weekly" />
      <QuotaBar label="Month" :window="account.quota.monthly" />
    </div>
    <ModelBadges :models="account.models" />
    <section class="border border-line bg-panel">
      <header class="border-b border-line px-4 py-3">
        <p class="font-mono text-[11px] tracking-[0.28em] text-mist">REPLACE CREDENTIAL</p>
        <h2 class="mt-1 text-sm">Rotate the Studio API key for this seat</h2>
      </header>
      <form class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-end" @submit.prevent="rotate">
        <label class="block min-w-0 flex-1">
          <span class="font-mono text-[11px] uppercase tracking-wider text-mist">Studio API key</span>
          <input
            v-model="credential"
            class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
            type="password"
            placeholder="user_…"
            autocomplete="new-password"
            spellcheck="false"
          />
        </label>
        <button class="border border-amber px-3 py-2 font-mono text-[12px] text-amber hover:bg-amber hover:text-ink disabled:opacity-50" :disabled="busy" type="submit">
          {{ busy ? "Replacing…" : "Replace key" }}
        </button>
      </form>
      <p class="border-t border-line px-4 py-2 font-mono text-[11px] text-mist">
        The previous key is deleted from the secret store. This screen never shows the value again.
      </p>
      <p v-if="result" class="px-4 pb-3 font-mono text-[12px]" :class="result.ok ? 'text-ok' : 'text-bad'">
        {{ result.ok ? "✓" : "✗" }} {{ result.message }}
      </p>
    </section>
    <section>
      <h2 class="mb-2 text-sm">Sessions</h2>
      <RouterLink v-for="session in sessions" :key="session.id" :to="`/sessions/${session.id}`" class="block border border-line px-3 py-2 font-mono text-[12px]">
        {{ session.id }} · {{ session.model }}
      </RouterLink>
      <p v-if="sessions.length === 0" class="font-mono text-[12px] text-mist">No active sessions.</p>
    </section>
  </div>
  <p v-else class="font-mono text-mist">Account not found.</p>
</template>
