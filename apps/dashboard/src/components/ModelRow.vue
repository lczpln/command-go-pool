<script setup lang="ts">
import type { CatalogModel } from "../composables/usePool";

const props = defineProps<{
  model: CatalogModel;
  accounts: string;
  busy?: boolean;
}>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <article class="border border-line bg-panel px-3 py-3">
    <header class="mb-2 flex items-baseline justify-between gap-3">
      <h2 class="font-mono text-[13px] tracking-wide">{{ props.model.id }}</h2>
      <span class="font-mono text-[11px] tracking-widest" :class="props.model.enabled ? 'text-ok' : 'text-mist'">
        ● {{ props.model.enabled ? "ENABLED" : "DISABLED" }}
      </span>
    </header>
    <p class="font-mono text-[11px] text-mist">
      <slot>{{ props.accounts || "Not on any current account" }}</slot>
    </p>
    <footer class="mt-3 flex justify-end">
      <button
        type="button"
        class="border border-line px-2 py-0.5 font-mono text-[11px] text-paper hover:border-amber disabled:opacity-50"
        :disabled="props.busy"
        @click="$emit('toggle')"
      >
        {{ props.model.enabled ? "Disable" : "Enable" }}
      </button>
    </footer>
  </article>
</template>
