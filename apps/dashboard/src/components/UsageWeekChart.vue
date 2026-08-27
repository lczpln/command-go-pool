<script setup lang="ts">
import { computed } from "vue";
import { useChartPointer } from "../composables/useChartPointer";
import { formatHour, formatMoney, formatTokens } from "../utils/format";
import { TOKEN_LAYERS, hasBreakdown, pointTotal, type UsagePoint } from "../utils/chart";

const props = defineProps<{
  series: UsagePoint[];
}>();

const max = computed(() => Math.max(1, ...props.series.map(pointTotal)));
const { root, index, x, onPointerDown, onPointerMove, onPointerLeave, onPointerCancel } = useChartPointer(
  () => props.series.length,
);
const active = computed(() => (index.value === null ? null : (props.series[index.value] ?? null)));
const activeLayers = computed(() => (active.value && hasBreakdown(active.value) ? TOKEN_LAYERS : []));

function barTone(i: number): string {
  if (index.value === i) return "opacity-100";
  if (index.value === null) return "opacity-80";
  return "opacity-45";
}

const tooltipStyle = computed(() => {
  const width = 196;
  const left = x.value - width / 2;
  return {
    width: `${width}px`,
    left: `${Math.max(8, Math.min((root.value?.clientWidth ?? width) - width - 8, left))}px`,
  };
});
</script>

<template>
  <div v-if="series.length === 0" class="flex h-32 items-center font-mono text-[12px] text-mist">No usage yet.</div>
  <div v-else class="space-y-2">
    <div
      ref="root"
      class="relative h-32 cursor-crosshair touch-pan-y select-none"
      role="group"
      aria-label="Tokens this week by cache, input, and output"
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
          class="flex min-w-px flex-1 flex-col-reverse"
          :class="barTone(i)"
          :style="{ height: `${(pointTotal(point) / max) * 100}%` }"
        >
          <template v-if="hasBreakdown(point)">
            <div
              v-for="layer in TOKEN_LAYERS"
              :key="layer.key"
              class="min-h-0 w-full"
              :class="layer.bar"
              :style="{ flexGrow: point[layer.key] ?? 0, flexBasis: 0 }"
            />
          </template>
          <div v-else class="h-full w-full bg-amber" />
        </div>
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
        <p class="mt-0.5 text-paper">{{ formatTokens(pointTotal(active)) }} tokens</p>
        <p class="text-mist">
          {{ active.requests ?? 0 }} {{ (active.requests ?? 0) === 1 ? "request" : "requests" }}
          · {{ formatMoney(active.cost) }}
        </p>
        <ul v-if="activeLayers.length" class="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
          <li v-for="layer in activeLayers" :key="layer.key" class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-1.5 text-mist">
              <span class="h-1.5 w-1.5 shrink-0" :class="layer.swatch" />
              {{ layer.label }}
            </span>
            <span class="text-paper">{{ formatTokens(active[layer.key]) }}</span>
          </li>
        </ul>
      </div>
    </div>
    <ul class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-mist" aria-label="Token types">
      <li v-for="layer in TOKEN_LAYERS" :key="layer.key" class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-1.5" :class="layer.swatch" />
        {{ layer.label }}
      </li>
    </ul>
  </div>
</template>
