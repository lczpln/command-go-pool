<script setup lang="ts">
import type { CatalogModel } from "../composables/usePool";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{
  model: CatalogModel;
  accounts: string;
  busy?: boolean;
}>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <article class="border border-line bg-panel px-3 py-3">
    <header class="mb-2 flex items-center justify-between gap-3">
      <h2 class="font-mono text-[13px] tracking-wide">{{ props.model.id }}</h2>
      <ToggleSwitch
        :on="props.model.enabled"
        :busy="props.busy"
        :label="`${props.model.enabled ? 'Disable' : 'Enable'} ${props.model.id}`"
        @toggle="$emit('toggle')"
      />
    </header>
    <p class="font-mono text-[11px] text-mist">
      <slot>{{ props.accounts || "Not on any current account" }}</slot>
    </p>
  </article>
</template>
