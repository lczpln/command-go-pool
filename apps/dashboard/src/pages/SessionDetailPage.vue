<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { store } from "../composables/usePool";

const route = useRoute();
const bindings = ref<{ accountId: string; reason: string | null; at: number }[]>([]);
const session = computed(() => store.sessions.find((s) => s.id === route.params.id));

onMounted(async () => {
  const res = await fetch(`/api/sessions/${route.params.id}`);
  if (!res.ok) return;
  const body = (await res.json()) as { migrations: typeof bindings.value };
  bindings.value = body.migrations;
});

function label(id: string) {
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}

function hit(s: { inputTokens: number; cacheReadTokens: number }) {
  const den = s.inputTokens + s.cacheReadTokens;
  return den ? `${((s.cacheReadTokens / den) * 100).toFixed(1)}%` : "—";
}
</script>

<template>
  <div v-if="session" class="space-y-4 font-mono text-[12px]">
    <RouterLink to="/sessions" class="text-mist">← Sessions</RouterLink>
    <h1 class="text-lg text-paper">{{ session.id }}</h1>
    <dl class="grid grid-cols-2 gap-2 md:grid-cols-3">
      <div><dt class="text-mist">Account</dt><dd>{{ label(session.accountId) }}</dd></div>
      <div><dt class="text-mist">Model</dt><dd>{{ session.model }}</dd></div>
      <div><dt class="text-mist">Requests</dt><dd>{{ session.requests }}</dd></div>
      <div><dt class="text-mist">Input</dt><dd>{{ session.inputTokens }}</dd></div>
      <div><dt class="text-mist">Cache read</dt><dd>{{ session.cacheReadTokens }}</dd></div>
      <div><dt class="text-mist">Cache hit</dt><dd>{{ hit(session) }}</dd></div>
      <div><dt class="text-mist">Migrations</dt><dd>{{ session.migrations }}</dd></div>
    </dl>
    <section>
      <h2 class="mb-2 text-sm">Migration timeline</h2>
      <ol v-if="bindings.length" class="space-y-1">
        <li v-for="(bind, i) in bindings" :key="i" class="border-l border-line pl-3">
          {{ new Date(bind.at).toLocaleTimeString() }} · {{ label(bind.accountId) }}
          <span class="text-mist">{{ bind.reason }}</span>
        </li>
      </ol>
      <p v-else class="text-mist">No migrations.</p>
    </section>
  </div>
  <p v-else class="font-mono text-mist">Session not found.</p>
</template>
