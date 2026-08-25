<script setup lang="ts">
import { store } from "../composables/usePool";
import AddAccountForm from "../components/AddAccountForm.vue";
import ProxyKeyForm from "../components/ProxyKeyForm.vue";
import Skeleton from "../components/Skeleton.vue";
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg">Settings</h1>
    <AddAccountForm />
    <ProxyKeyForm />
    <section class="border border-line bg-panel">
      <header class="border-b border-line px-4 py-3">
        <p class="font-mono text-[11px] tracking-[0.28em] text-mist">RUNTIME</p>
        <h2 class="mt-1 text-sm">Bind, routing, and aliases</h2>
      </header>
      <div v-if="!store.ready" class="space-y-2 p-4" role="status" aria-label="Loading runtime config">
        <Skeleton v-for="i in 8" :key="i" class="h-3" :class="i % 3 === 0 ? 'w-2/3' : 'w-full'" />
      </div>
      <pre v-else class="overflow-auto p-4 font-mono text-[11px] text-mist">{{ JSON.stringify(store.config, null, 2) }}</pre>
    </section>
    <p class="max-w-xl text-sm text-mist">
      Bind is localhost by default. Keys live in the encrypted store and never appear in this payload.
    </p>
  </div>
</template>
