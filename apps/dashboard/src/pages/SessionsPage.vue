<script setup lang="ts">
import { RouterLink } from "vue-router";
import { store } from "../composables/usePool";
import SessionCardSkeleton from "../components/SessionCardSkeleton.vue";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function hit(session: { inputTokens: number; cacheReadTokens: number }): string {
  const den = session.inputTokens + session.cacheReadTokens;
  if (!den) return "—";
  return `${((session.cacheReadTokens / den) * 100).toFixed(1)}%`;
}

function accountLabel(id: string) {
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg">Sessions</h1>
    <div v-if="!store.ready" class="space-y-3" role="status" aria-label="Loading sessions">
      <SessionCardSkeleton v-for="i in 3" :key="i" />
    </div>
    <div v-else-if="store.sessions.length === 0" class="border border-dashed border-line p-6 font-mono text-sm text-mist">
      No active sessions.
    </div>
    <template v-else>
      <RouterLink v-for="session in store.sessions" :key="session.id" :to="`/sessions/${session.id}`" class="block">
        <article class="border border-line bg-panel p-3 font-mono text-[12px] hover:border-amber">
          <header class="mb-2 flex justify-between">
            <span>{{ session.id }}</span>
            <span class="text-mist">{{ accountLabel(session.accountId) }}</span>
          </header>
          <p class="text-mist">{{ session.model }}</p>
          <dl class="mt-3 grid grid-cols-2 gap-y-1 md:grid-cols-4">
            <div><dt class="text-mist">Requests</dt><dd>{{ session.requests }}</dd></div>
            <div><dt class="text-mist">Input</dt><dd>{{ fmt(session.inputTokens) }}</dd></div>
            <div><dt class="text-mist">Cache read</dt><dd>{{ fmt(session.cacheReadTokens) }}</dd></div>
            <div><dt class="text-mist">Cache hit</dt><dd>{{ hit(session) }}</dd></div>
            <div><dt class="text-mist">Output</dt><dd>{{ fmt(session.outputTokens) }}</dd></div>
            <div><dt class="text-mist">Migrations</dt><dd>{{ session.migrations }}</dd></div>
            <div v-if="session.estimatedCost !== undefined"><dt class="text-mist">Usage</dt><dd>~${{ session.estimatedCost.toFixed(3) }}</dd></div>
          </dl>
        </article>
      </RouterLink>
    </template>
  </div>
</template>
