<script setup lang="ts">
import { computed, ref } from "vue";
import { store } from "../composables/usePool";
import Skeleton from "../components/Skeleton.vue";

const filter = ref("all");
const filtered = computed(() => {
  if (filter.value === "all") return store.events;
  if (["info", "warning", "error"].includes(filter.value)) return store.events.filter((e) => e.level === filter.value);
  return store.events.filter((e) => e.category === filter.value);
});

function accountLabel(id: unknown) {
  if (typeof id !== "string") return String(id ?? "");
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}

function describe(event: (typeof store.events)[number]): string {
  const p = event.payload;
  if (event.type === "session.migrated") {
    return `Session ${p.sessionId} migrated ${accountLabel(p.from)} → ${accountLabel(p.to)} (${p.reason})`;
  }
  if (event.type === "session.started") {
    return `Session ${p.sessionId} started on ${accountLabel(p.accountId)}`;
  }
  if (event.type === "account.cooldown") {
    return `${accountLabel(p.accountId)} ${p.message ?? "entered cooldown"}`;
  }
  if (event.type === "account.recovered") {
    return `${accountLabel(p.accountId) || p.label} rejoined pool`;
  }
  if (event.type === "account.updated") {
    return `${accountLabel(p.accountId)} updated`;
  }
  if (event.type === "proxy.error") {
    return `${accountLabel(p.accountId)} ${p.code}: ${p.message ?? ""}`.trim();
  }
  return `${event.type}`;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-lg">Events</h1>
      <select v-model="filter" class="border border-line bg-ink px-2 py-1 font-mono text-[12px]">
        <option value="all">all</option>
        <option>info</option>
        <option>warning</option>
        <option>error</option>
        <option>routing</option>
        <option>quota</option>
        <option>authentication</option>
      </select>
    </div>
    <ol v-if="!store.ready" class="space-y-1" role="status" aria-label="Loading events">
      <li v-for="i in 8" :key="i" class="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line/60 py-2">
        <Skeleton class="h-3 w-16" />
        <Skeleton class="h-3 w-full max-w-xl" />
      </li>
    </ol>
    <ol v-else class="space-y-1 font-mono text-[12px]">
      <li v-for="event in filtered" :key="event.id" class="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line/60 py-1">
        <time class="text-mist">{{ new Date(event.at).toLocaleTimeString() }}</time>
        <span :class="event.level === 'error' ? 'text-bad' : event.level === 'warning' ? 'text-warn' : 'text-paper'">
          {{ describe(event) }}
        </span>
      </li>
    </ol>
  </div>
</template>
