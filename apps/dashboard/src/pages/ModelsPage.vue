<script setup lang="ts">
import { computed, ref } from "vue";
import { store, patchModel, syncClients, type CatalogModel } from "../composables/usePool";
import ModelRow from "../components/ModelRow.vue";
import Skeleton from "../components/Skeleton.vue";

const busy = ref<string | null>(null);
const syncing = ref(false);
const syncResult = ref<{ ok: boolean; message: string } | null>(null);

const canonical = computed(() => store.models.filter((m) => !m.aliasOf));
const aliases = computed(() => store.models.filter((m) => m.aliasOf));
const enabledCount = computed(() => store.models.filter((m) => m.enabled).length);
const connectedClients = computed(() => store.clients.filter((client) => client.connected));
const clientHint = computed(() => {
  if (!store.ready) return "Writes enabled models to connected client configs";
  if (connectedClients.value.length === 0) return "No connected clients yet";
  return `Writes enabled models to ${connectedClients.value.map((client) => client.name).join(", ")}`;
});

function accountLabel(id: string) {
  return store.accounts.find((a) => a.id === id)?.label ?? id;
}

function accounts(model: CatalogModel) {
  return model.accountIds.map(accountLabel).join(" · ");
}

async function toggle(model: CatalogModel) {
  busy.value = model.id;
  try {
    await patchModel(model.id, { enabled: !model.enabled });
  } finally {
    busy.value = null;
  }
}

async function sync() {
  syncing.value = true;
  syncResult.value = null;
  try {
    const result = await syncClients();
    const detail = result.clients
      .filter((client) => client.synced || (client.connected && client.message))
      .map((client) => `${client.name} · ${client.file}`)
      .join("\n");
    const parts = [result.message, result.warning, detail].filter(Boolean);
    syncResult.value = {
      ok: result.ok,
      message: parts.join("\n"),
    };
  } catch (error) {
    syncResult.value = { ok: false, message: error instanceof Error ? error.message : "Sync failed" };
  } finally {
    syncing.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-lg">Models</h1>
        <p class="mt-1 max-w-xl text-sm text-mist">
          Discovered from Command Code accounts. Disabled models are hidden from
          <span class="font-mono text-[12px]">GET /v1/models</span> and rejected on chat.
        </p>
      </div>
      <Skeleton v-if="!store.ready" class="h-3 w-20" />
      <p v-else class="font-mono text-[11px] text-mist">{{ enabledCount }} enabled · {{ store.models.length }} total</p>
    </header>

    <section class="flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-3">
      <button
        type="button"
        class="border border-line px-2 py-0.5 font-mono text-[11px] text-paper hover:border-amber disabled:opacity-50"
        :disabled="syncing"
        @click="sync"
      >
        {{ syncing ? "Syncing…" : "Sync with clients" }}
      </button>
      <p class="font-mono text-[11px] text-mist">{{ clientHint }}</p>
    </section>
    <p v-if="syncResult" class="whitespace-pre-wrap font-mono text-[12px]" :class="syncResult.ok ? 'text-ok' : 'text-bad'">
      {{ syncResult.message }}
    </p>

    <div v-if="!store.ready" class="space-y-2" role="status" aria-label="Loading models">
      <div v-for="i in 4" :key="i" class="border border-line bg-panel px-3 py-3">
        <div class="flex items-baseline justify-between">
          <Skeleton class="h-3.5 w-48" />
          <Skeleton class="h-3 w-16" />
        </div>
        <Skeleton class="mt-2 h-2.5 w-32" />
      </div>
    </div>
    <div v-else-if="store.models.length === 0" class="border border-dashed border-line p-6 font-mono text-sm text-mist">
      No models yet. Add a Command Code account and wait for the next health tick.
    </div>
    <template v-else>
      <ModelRow
        v-for="model in canonical"
        :key="model.id"
        :model="model"
        :accounts="accounts(model)"
        :busy="busy === model.id"
        @toggle="toggle(model)"
      />
      <section v-if="aliases.length" class="space-y-2">
        <p class="font-mono text-[11px] tracking-[0.28em] text-mist">ALIASES</p>
        <ModelRow
          v-for="model in aliases"
          :key="model.id"
          :model="model"
          :accounts="`alias of ${model.aliasOf}`"
          :busy="busy === model.id"
          @toggle="toggle(model)"
        >
          alias of {{ model.aliasOf }}
        </ModelRow>
      </section>
    </template>
  </div>
</template>
