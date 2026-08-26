<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { store } from "../composables/usePool";
import Skeleton from "../components/Skeleton.vue";

const route = useRoute();
const bindings = ref<{ accountId: string; reason: string | null; at: number }[]>([]);
const bindingsReady = ref(false);
const session = computed(() => store.sessions.find((s) => s.id === route.params.id));

onMounted(async () => {
  try {
    const res = await fetch(`/api/sessions/${route.params.id}`);
    if (res.ok) {
      const body = (await res.json()) as { migrations: typeof bindings.value };
      bindings.value = body.migrations;
    }
  } finally {
    bindingsReady.value = true;
  }
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
  <div v-if="!store.ready" class="min-w-0 space-y-4 font-mono text-[12px]" role="status" aria-label="Loading session">
    <RouterLink to="/sessions" class="text-mist">← Sessions</RouterLink>
    <Skeleton class="h-5 w-40" />
    <dl class="grid grid-cols-2 gap-2 md:grid-cols-3">
      <div v-for="i in 7" :key="i">
        <Skeleton class="h-2.5 w-14" />
        <Skeleton class="mt-1 h-3 w-24" />
      </div>
    </dl>
    <section>
      <h2 class="mb-2 text-sm">Migration timeline</h2>
      <div class="space-y-2">
        <Skeleton v-for="i in 3" :key="i" class="h-6 w-full" />
      </div>
    </section>
  </div>
  <div v-else-if="session" class="min-w-0 space-y-4 font-mono text-[12px]">
    <RouterLink to="/sessions" class="text-mist">← Sessions</RouterLink>
    <h1 class="min-w-0 wrap-anywhere text-lg text-paper">{{ session.id }}</h1>
    <dl class="grid grid-cols-2 gap-2 md:grid-cols-3">
      <div class="min-w-0"><dt class="text-mist">Account</dt><dd class="wrap-anywhere">{{ label(session.accountId) }}</dd></div>
      <div class="min-w-0"><dt class="text-mist">Model</dt><dd class="wrap-anywhere">{{ session.model }}</dd></div>
      <div><dt class="text-mist">Requests</dt><dd>{{ session.requests }}</dd></div>
      <div><dt class="text-mist">Input</dt><dd>{{ session.inputTokens }}</dd></div>
      <div><dt class="text-mist">Cache read</dt><dd>{{ session.cacheReadTokens }}</dd></div>
      <div><dt class="text-mist">Cache hit</dt><dd>{{ hit(session) }}</dd></div>
      <div><dt class="text-mist">Migrations</dt><dd>{{ session.migrations }}</dd></div>
    </dl>
    <section>
      <h2 class="mb-2 text-sm">Migration timeline</h2>
      <div v-if="!bindingsReady" class="space-y-2" role="status" aria-label="Loading timeline">
        <Skeleton v-for="i in 3" :key="i" class="h-6 w-full" />
      </div>
      <ol v-else-if="bindings.length" class="space-y-1">
        <li v-for="(bind, i) in bindings" :key="i" class="min-w-0 wrap-anywhere border-l border-line pl-3">
          {{ new Date(bind.at).toLocaleTimeString() }} · {{ label(bind.accountId) }}
          <span class="text-mist">{{ bind.reason }}</span>
        </li>
      </ol>
      <p v-else class="text-mist">No migrations.</p>
    </section>
  </div>
  <p v-else class="font-mono text-mist">Session not found.</p>
</template>
