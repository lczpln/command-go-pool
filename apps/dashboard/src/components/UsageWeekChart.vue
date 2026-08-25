<script setup lang="ts">
import { computed } from "vue";
import { useChartPointer } from "../composables/useChartPointer";
import { formatHour, formatMoney, formatTokens } from "../utils/format";
import type { UsagePoint } from "../utils/chart";

const props = defineProps<{
  series: UsagePoint[];
}>();

const max = computed(() => Math.max(1, ...props.series.map((point) => point.tokens)));
const { root, index, x, onPointerDown, onPointerMove, onPointerLeave, onPointerCancel } = useChartPointer(
  () => props.series.length,
);
const active = computed(() => (index.value === null ? null : (props.series[index.value] ?? null)));

const tooltipStyle = computed(() => {
  const width = 176;
  const left = x.value - width / 2;
  return {
    width: `${width}px`,
    left: `${Math.max(8, Math.min((root.value?.clientWidth ?? width) - width - 8, left))}px`,
  };
});
</script>

<template>
  <div v-if="series.length === 0" class="flex h-32 items-center font-mono text-[12px] text-mist">No usage yet.</div>
  <div
    v-else
    ref="root"
    class="relative h-32 cursor-crosshair touch-pan-y select-none"
    role="group"
    aria-label="Tokens this week"
    @pointerdown="onPointerDown"
    @pointerenter="onPointerMove"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointercancel="onPointerCancel"
  >
    <div class="flex h-full items-end gap-px">
      <div
        v-for="(point, i) in series"
        :key="point.t"
        class="min-w-px flex-1"
        :class="index === i ? 'bg-amber' : index === null ? 'bg-amber/80' : 'bg-amber/45'"
        :style="{ height: `${(point.tokens / max) * 100}%` }"
      />
    </div>
    <div
      v-if="index !== null"
      class="pointer-events-none absolute inset-y-0 w-px bg-paper/40"
      :style="{ left: `${x}px` }"
    />
    <div
      v-if="active"
      role="tooltip"
      class="pointer-events-none absolute top-2 z-10 border border-line bg-ink/95 px-2 py-1.5 font-mono text-[11px] shadow-lg"
      :style="tooltipStyle"
    >
      <p class="text-mist">{{ formatHour(active.t) }}</p>
      <p class="mt-0.5 text-paper">{{ formatTokens(active.tokens) }} tokens</p>
      <p class="text-mist">
        {{ active.requests ?? 0 }} {{ (active.requests ?? 0) === 1 ? "request" : "requests" }}
        · {{ formatMoney(active.cost) }}
      </p>
    </div>
  </div>
</template>
