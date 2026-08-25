<script setup lang="ts">
import { computed } from "vue";
import { store } from "../composables/usePool";
import { useUsageScope, type UsageDimension } from "../composables/useUsageScope";
import StatGridSkeleton from "../components/StatGridSkeleton.vue";
import Skeleton from "../components/Skeleton.vue";
import UsageWeekChart from "../components/UsageWeekChart.vue";
import UsageFilterRow from "../components/UsageFilterRow.vue";
import { formatMoney, formatTokens } from "../utils/format";
import type { UsagePoint } from "../utils/chart";

interface Rollup {
  key?: string;
  requests?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
}

const { filters, usage, hasFilter, toggle, clear } = useUsageScope();
const series = computed(() => (usage.value.series as UsagePoint[] | undefined) ?? []);
const month = computed(() => (usage.value.month ?? {}) as Record<string, number | undefined>);
const byAccount = computed(() => (usage.value.byAccount as Rollup[] | undefined) ?? []);
const byModel = computed(() => (usage.value.byModel as Rollup[] | undefined) ?? []);
const bySession = computed(() => (usage.value.bySession as Rollup[] | undefined) ?? []);

const groups = computed(() => [
  { title: "By account", dimension: "accountId" as UsageDimension, rows: byAccount.value, name: (row: Rollup) => label(row.key) },
  { title: "By model", dimension: "model" as UsageDimension, rows: byModel.value, name: (row: Rollup) => row.key ?? "—" },
  { title: "By session", dimension: "sessionId" as UsageDimension, rows: bySession.value, name: (row: Rollup) => row.key ?? "—" },
]);

function label(id?: string) {
  if (!id) return "—";
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-lg">Usage</h1>
    <template v-if="!store.ready">
      <StatGridSkeleton />
      <Skeleton class="h-3 w-80" />
      <section class="border border-line bg-panel p-3">
        <Skeleton class="mb-3 h-2.5 w-28" />
        <Skeleton class="h-32 w-full" />
      </section>
      <section class="grid gap-4 md:grid-cols-3">
        <div v-for="i in 3" :key="i">
          <Skeleton class="mb-3 h-3.5 w-24" />
          <div class="space-y-2">
            <Skeleton v-for="j in 4" :key="j" class="h-6 w-full" />
          </div>
        </div>
      </section>
    </template>
    <template v-else>
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
        Cache read {{ formatTokens(month.cacheReadTokens) }} · Uncached input {{ formatTokens(month.inputTokens) }}
        <span v-if="usage.consumed"> · Estimated inference {{ formatMoney(usage.consumed as number) }}</span>
      </p>
      <p v-if="usage.subsidy" class="font-mono text-[11px] text-mist">
        Subsidy uses configured subscription cost and measured consumption. Monetary values are estimates unless marked exact.
      </p>
      <section class="border border-line bg-panel p-3">
        <div class="mb-3 flex items-baseline justify-between gap-3">
          <p class="font-mono text-[11px] uppercase tracking-wider text-mist">Tokens this week</p>
          <button
            v-if="hasFilter"
            class="font-mono text-[11px] text-mist hover:text-amber"
            type="button"
            @click="clear"
          >
            Clear filters
          </button>
        </div>
        <UsageWeekChart :series="series" />
      </section>
      <section class="grid gap-4 md:grid-cols-3">
        <div v-for="group in groups" :key="group.title">
          <h2 class="mb-2 text-sm">{{ group.title }}</h2>
          <ol class="space-y-1">
            <UsageFilterRow
              v-for="row in group.rows"
              :key="String(row.key)"
              :name="group.name(row)"
              :selected="filters[group.dimension] === row.key"
              :requests="row.requests"
              :input-tokens="row.inputTokens"
              :cache-read-tokens="row.cacheReadTokens"
              :output-tokens="row.outputTokens"
              :estimated-cost="row.estimatedCost"
              @click="toggle(group.dimension, row.key)"
            />
            <li v-if="group.rows.length === 0" class="font-mono text-[11px] text-mist">No usage yet.</li>
          </ol>
        </div>
      </section>
    </template>
  </div>
</template>
