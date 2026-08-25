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
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="font-mono text-[13px] tracking-wide">{{ props.model.id }}</h2>
        <span
          v-if="props.model.locked"
          class="border border-amber/40 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.18em] text-amber"
        >
          VISION
        </span>
      </div>
      <ToggleSwitch
        :on="props.model.enabled"
        :busy="props.busy"
        :locked="props.model.locked"
        :hint="props.model.lockReason"
        :label="`${props.model.enabled ? 'Disable' : 'Enable'} ${props.model.id}`"
        @toggle="$emit('toggle')"
      />
    </header>
    <p v-if="props.model.locked" class="mb-1 font-mono text-[11px] text-amber/80">
      {{ props.model.lockReason }}
    </p>
    <p class="font-mono text-[11px] text-mist">
      <slot>{{ props.accounts || "Not on any current account" }}</slot>
    </p>
  </article>
</template>
