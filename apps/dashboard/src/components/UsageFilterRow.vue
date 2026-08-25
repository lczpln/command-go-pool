<script setup lang="ts">
import { formatMoney, formatTokens } from "../utils/format";

defineProps<{
  name: string;
  selected: boolean;
  requests?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <li class="group relative">
    <button
      class="flex w-full items-baseline justify-between gap-2 border-b py-1 text-left font-mono text-[11px]"
      :class="selected ? 'border-amber text-amber' : 'border-line/60 text-paper hover:border-amber'"
      :aria-label="`${name}, ${requests ?? 0} requests`"
      :aria-pressed="selected"
      type="button"
      @click="$emit('click')"
    >
      <span class="truncate pr-2">{{ name }}</span>
      <span :class="selected ? 'text-amber' : 'text-mist'">{{ requests ?? 0 }} · {{ formatMoney(estimatedCost) }}</span>
    </button>
    <div
      role="tooltip"
      class="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1 border border-line bg-ink/95 px-2 py-1.5 font-mono text-[11px] text-paper shadow-lg group-hover:visible group-focus-within:visible"
    >
      {{ formatTokens(inputTokens) }} in · {{ formatTokens(cacheReadTokens) }} cache · {{ formatTokens(outputTokens) }} out
    </div>
    <p v-if="selected" class="pb-1 font-mono text-[10px] text-mist">
      {{ formatTokens(inputTokens) }} in · {{ formatTokens(cacheReadTokens) }} cache · {{ formatTokens(outputTokens) }} out
    </p>
  </li>
</template>
