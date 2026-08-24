<script setup lang="ts">
import { computed } from "vue";
import { store } from "../composables/usePool";

const usage = computed(() => store.usage ?? {});
const series = computed(() => (usage.value.series as { t: number; tokens: number }[] | undefined) ?? []);
const max = computed(() => Math.max(1, ...series.value.map((p) => p.tokens)));
const month = computed(() => (usage.value.month ?? {}) as Record<string, number | undefined>);
const byAccount = computed(() => (usage.value.byAccount as Rollup[] | undefined) ?? []);
const byModel = computed(() => (usage.value.byModel as Rollup[] | undefined) ?? []);
const bySession = computed(() => (usage.value.bySession as Rollup[] | undefined) ?? []);

interface Rollup {
  key?: string;
  requests?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
}

function label(id?: string) {
  if (!id) return "—";
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}

function money(n?: number | null) {
  return n === undefined || n === null ? "—" : `~$${Number(n).toFixed(2)}`;
}

function tokens(n?: number) {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-lg">Usage</h1>
    <section class="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
      <div class="bg-ink p-3" v-for="card in [
        { k: 'Requests (30d)', v: month.requests ?? 0 },
        { k: 'Cache hit', v: usage.cacheHit ? `${((usage.cacheHit as number) * 100).toFixed(1)}%` : '—' },
        { k: 'Paid', v: usage.paid ? `$${(usage.paid as number).toFixed(2)}` : '—' },
        { k: 'Subsidy', v: usage.subsidy ? `${(usage.subsidy as number).toFixed(2)}×` : '—' },
      ]" :key="card.k">
        <p class="font-mono text-[11px] uppercase tracking-wider text-mist">{{ card.k }}</p>
        <p class="mt-1 font-mono text-xl text-amber">{{ card.v }}</p>
      </div>
    </section>
    <p class="font-mono text-[11px] text-mist">
      Cache read {{ tokens(month.cacheReadTokens) }} · Uncached input {{ tokens(month.inputTokens) }}
      <span v-if="usage.consumed"> · Estimated inference {{ money(usage.consumed as number) }}</span>
    </p>
    <p v-if="usage.subsidy" class="font-mono text-[11px] text-mist">
      Subsidy uses configured subscription cost and measured consumption. Monetary values are estimates unless marked exact.
    </p>
    <section class="border border-line bg-panel p-3">
      <p class="mb-3 font-mono text-[11px] uppercase tracking-wider text-mist">Tokens this week</p>
      <div class="flex h-32 items-end gap-px">
        <div
          v-for="point in series"
          :key="point.t"
          class="flex-1 bg-amber/80"
          :style="{ height: `${(point.tokens / max) * 100}%` }"
          :title="new Date(point.t).toISOString()"
        />
      </div>
    </section>
    <section class="grid gap-4 md:grid-cols-3">
      <div v-for="group in [
        { title: 'By account', rows: byAccount, name: (r: Rollup) => label(r.key) },
        { title: 'By model', rows: byModel, name: (r: Rollup) => r.key ?? '—' },
        { title: 'By session', rows: bySession, name: (r: Rollup) => r.key ?? '—' },
      ]" :key="group.title">
        <h2 class="mb-2 text-sm">{{ group.title }}</h2>
        <ol class="space-y-1 font-mono text-[11px]">
          <li v-for="row in group.rows" :key="String(row.key)" class="flex justify-between border-b border-line/60 py-1">
            <span class="truncate pr-2">{{ group.name(row) }}</span>
            <span class="text-mist">{{ row.requests ?? 0 }} · {{ money(row.estimatedCost) }}</span>
          </li>
          <li v-if="group.rows.length === 0" class="text-mist">No usage yet.</li>
        </ol>
      </div>
    </section>
  </div>
</template>
