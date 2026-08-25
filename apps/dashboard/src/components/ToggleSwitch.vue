<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    on: boolean;
    busy?: boolean;
    label?: string;
  }>(),
  { busy: false },
);

defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    class="group inline-flex items-center gap-2 font-mono text-[11px] tracking-widest disabled:opacity-50"
    :class="props.on ? 'text-ok' : 'text-mist'"
    :aria-checked="props.on"
    :aria-busy="props.busy || undefined"
    :aria-label="props.label"
    :disabled="props.busy"
    @click="$emit('toggle')"
  >
    <span
      class="relative inline-flex h-[18px] w-[32px] items-center border px-[3px] transition-colors group-hover:border-amber group-focus-visible:border-amber"
      :class="props.on ? 'justify-end border-ok bg-ok/10' : 'justify-start border-line bg-ink'"
    >
      <span class="inline-block size-[10px]" :class="props.on ? 'bg-ok' : 'bg-mist'" />
    </span>
    {{ props.on ? "ENABLED" : "DISABLED" }}
  </button>
</template>
