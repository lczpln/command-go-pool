<script setup lang="ts">
import { computed } from "vue";
import { store, patchAccount, removeAccount } from "../composables/usePool";
import StatusDot from "../components/StatusDot.vue";
import PoolQuota from "../components/PoolQuota.vue";
import AccountCard from "../components/AccountCard.vue";
import AddAccountForm from "../components/AddAccountForm.vue";
import StatGridSkeleton from "../components/StatGridSkeleton.vue";
import PoolQuotaSkeleton from "../components/PoolQuotaSkeleton.vue";
import AccountCardSkeleton from "../components/AccountCardSkeleton.vue";

const overview = computed(() => store.overview ?? {});
const pool = computed(() => (overview.value.pool ?? {}) as Record<string, unknown>);
const credits = computed(() => {
  const value = pool.value.estimatedCreditsAvailable;
  return typeof value === "number" ? value : undefined;
});

async function toggle(id: string, enabled: boolean) {
  await patchAccount(id, { enabled });
}

async function remove(id: string, label: string) {
  if (!window.confirm(`Remove ${label} from the pool? The stored key is deleted.`)) return;
  await removeAccount(id);
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div>
        <p class="font-mono text-[11px] tracking-[0.25em] text-mist">COMMAND GO POOL</p>
        <h1 class="mt-1 text-xl tracking-tight">Local inference gateway</h1>
      </div>
      <p class="inline-flex items-center gap-1.5 font-mono text-[12px]" :class="store.connected ? 'text-ok' : 'text-mist'">
        <StatusDot />
        {{ store.connected ? "RUNNING" : "CONNECTING" }}
      </p>
    </header>

    <StatGridSkeleton v-if="!store.ready" />
    <section v-else class="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
      <div v-for="item in [
        { k: 'Accounts', v: overview.accounts ?? 0 },
        { k: 'Available', v: overview.available ?? 0 },
        { k: 'Cooling down', v: overview.cooldown ?? 0 },
        { k: 'Sessions', v: overview.sessions ?? 0 },
      ]" :key="item.k" class="bg-ink px-3 py-3">
        <p class="font-mono text-[11px] uppercase tracking-wider text-mist">{{ item.k }}</p>
        <p class="mt-1 font-mono text-2xl text-amber">{{ item.v }}</p>
      </div>
    </section>

    <AddAccountForm v-if="store.ready && store.accounts.length === 0" />

    <PoolQuotaSkeleton v-if="!store.ready" />
    <PoolQuota
      v-else
      :five-hour="pool.fiveHour as never"
      :weekly="pool.weekly as never"
      :monthly="pool.monthly as never"
      :credits="credits"
    />

    <section v-if="!store.ready" class="grid gap-3 md:grid-cols-2" role="status" aria-label="Loading accounts">
      <AccountCardSkeleton v-for="i in 4" :key="i" />
    </section>
    <section v-else class="grid gap-3 md:grid-cols-2">
      <AccountCard
        v-for="account in store.accounts"
        :key="account.id"
        :account="account"
        @disable="toggle(account.id, false)"
        @enable="toggle(account.id, true)"
        @remove="remove(account.id, account.label)"
      />
    </section>
  </div>
</template>
