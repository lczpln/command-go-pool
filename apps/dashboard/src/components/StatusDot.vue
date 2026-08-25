<script setup lang="ts">
withDefaults(defineProps<{ pulse?: boolean }>(), { pulse: true });
</script>

<template>
  <span class="relative inline-flex h-[6px] w-[6px] shrink-0" aria-hidden="true">
    <span
      v-if="pulse"
      class="status-ping absolute inline-flex h-full w-full rounded-full bg-current"
    />
    <span class="relative inline-flex h-[6px] w-[6px] rounded-full bg-current" />
  </span>
</template>
