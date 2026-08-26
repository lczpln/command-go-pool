<script setup lang="ts">
import { RouterLink } from "vue-router";
import QuotaBar from "./QuotaBar.vue";
import StatusPill from "./StatusPill.vue";
import type { Account } from "../composables/usePool";
import { formatMoney } from "../utils/format";

const props = defineProps<{ account: Account }>();
defineEmits<{ disable: []; enable: []; remove: [] }>();

function fmtPct(n?: number) {
  return n === undefined ? "—" : `${(n * 100).toFixed(1)}%`;
}

function fmtSeat(n?: number) {
  return n === undefined ? "—" : `$${n}/mo`;
}
</script>

<template>
  <article
    class="border bg-panel px-3 py-3"
    :class="account.generating ? 'border-amber' : account.status === 'active' ? 'border-amber/50' : 'border-line'"
  >
    <header class="mb-3 flex items-baseline justify-between gap-3">
      <h3 class="font-mono text-[13px] tracking-wide">{{ account.label }}</h3>
      <StatusPill :status="account.status" />
    </header>
    <p v-if="account.status === 'quota_exhausted' || account.status === 'cooldown'" class="mb-2 font-mono text-[11px] text-warn">
      {{ account.cooldownReason ?? "Cooling down" }}
      <span v-if="account.cooldownUntil"> · rejoins {{ new Date(account.cooldownUntil).toLocaleTimeString() }}</span>
    </p>
    <div class="space-y-1.5">
      <QuotaBar label="5h" :window="account.quota.fiveHour" />
      <QuotaBar label="Week" :window="account.quota.weekly" />
      <QuotaBar label="Month" :window="account.quota.monthly" />
    </div>
    <dl class="mt-3 grid grid-cols-2 gap-y-1 font-mono text-[11px] text-mist md:grid-cols-4">
      <div>Sessions {{ account.activeSessionCount }}</div>
      <div>Requests {{ account.stats?.requests ?? 0 }}</div>
      <div>Cache {{ fmtPct(account.stats?.cacheHit) }}</div>
      <div>Today {{ formatMoney(account.stats?.todayCost) }}</div>
    </dl>
    <footer class="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
      <p class="text-mist">{{ fmtSeat(account.monthlySubscriptionCost) }}</p>
      <div class="flex items-center gap-2">
        <RouterLink :to="`/accounts/${account.id}`" class="border border-line px-2 py-0.5 text-paper hover:border-amber">Inspect</RouterLink>
        <button
          class="border border-line px-2 py-0.5 text-paper hover:border-amber"
          @click="account.enabled ? $emit('disable') : $emit('enable')"
        >
          {{ account.enabled ? "Disable" : "Enable" }}
        </button>
        <button class="border border-line px-2 py-0.5 text-mist hover:border-bad hover:text-bad" @click="$emit('remove')">
          Remove
        </button>
      </div>
    </footer>
  </article>
</template>
