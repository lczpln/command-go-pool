<script setup lang="ts">
import { store, patchAccount, removeAccount } from "../composables/usePool";
import AccountCard from "../components/AccountCard.vue";
import AddAccountForm from "../components/AddAccountForm.vue";

async function toggle(id: string, enabled: boolean) {
  await patchAccount(id, { enabled });
}

async function remove(id: string, label: string) {
  if (!window.confirm(`Remove ${label} from the pool? The stored key is deleted.`)) return;
  await removeAccount(id);
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-baseline justify-between gap-3">
      <h1 class="text-lg">Accounts</h1>
      <p class="font-mono text-[11px] text-mist">{{ store.accounts.length }} seated</p>
    </header>
    <AddAccountForm />
    <div v-if="store.accounts.length === 0" class="border border-dashed border-line p-6 font-mono text-sm text-mist">
      No Command Code accounts yet. Paste a Studio API key above.
    </div>
    <div class="grid gap-3 lg:grid-cols-2">
      <AccountCard
        v-for="account in store.accounts"
        :key="account.id"
        :account="account"
        @disable="toggle(account.id, false)"
        @enable="toggle(account.id, true)"
        @remove="remove(account.id, account.label)"
      />
    </div>
  </div>
</template>
