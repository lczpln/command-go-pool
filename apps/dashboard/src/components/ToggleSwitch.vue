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
    class="group inline-flex shrink-0 items-center gap-2.5 font-mono text-[11px] tracking-widest disabled:opacity-50"
    :class="props.on ? 'text-ok' : 'text-mist'"
    :aria-checked="props.on"
    :aria-busy="props.busy || undefined"
    :aria-label="props.label"
    :disabled="props.busy"
    @click="$emit('toggle')"
  >
    <span
      class="relative block h-6 w-12 border bg-ink transition-colors group-hover:border-amber group-focus-visible:border-amber"
      :class="props.on ? 'border-ok' : 'border-mist/55'"
    >
      <span
        class="absolute top-[4px] size-4 transition-[left] duration-150 ease-out"
        :class="props.on ? 'left-[28px] bg-ok' : 'left-[4px] bg-mist'"
      />
    </span>
    {{ props.on ? "ENABLED" : "DISABLED" }}
  </button>
</template>
