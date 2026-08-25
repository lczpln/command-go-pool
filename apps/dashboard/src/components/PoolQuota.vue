<script setup lang="ts">
import { computed } from "vue";
import { formatQuotaView, segments } from "../utils/quota";
import type { QuotaWindow } from "../composables/usePool";

const props = defineProps<{
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  credits?: number;
}>();

const rows = computed(() =>
  [
    { label: "5H", window: props.fiveHour },
    { label: "Weekly", window: props.weekly },
    { label: "Monthly", window: props.monthly },
  ].map((row) => {
    const view = formatQuotaView(row.window);
    return { ...row, view, cells: segments(view.filled) };
  }),
);

function cellClass(tone: string, on: boolean, empty: boolean) {
  if (empty) return "bg-transparent border border-dashed border-line";
  if (!on) return "bg-[#1b2029]";
  if (tone === "bad") return "bg-bad";
  if (tone === "warn") return "bg-warn";
  return "bg-amber";
}
</script>

<template>
  <section class="border border-line bg-panel">
    <header class="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <p class="font-mono text-[11px] tracking-[0.28em] text-mist">POOL CAPACITY</p>
        <h2 class="mt-1 text-sm tracking-tight">Remaining across the account pool</h2>
      </div>
      <p v-if="credits !== undefined" class="font-mono text-[12px] text-amber">~${{ credits.toFixed(2) }}</p>
    </header>
    <div class="grid gap-px bg-line md:grid-cols-3">
      <article v-for="row in rows" :key="row.label" class="bg-panel px-4 py-4">
        <p class="font-mono text-[11px] uppercase tracking-[0.22em] text-mist">{{ row.label }}</p>
        <p
          class="mt-2 font-mono text-[2rem] leading-none tracking-tight tabular-nums"
          :class="row.view.tone === 'bad' ? 'text-bad' : row.view.tone === 'warn' ? 'text-warn' : row.view.tone === 'empty' ? 'text-mist' : 'text-amber'"
        >
          {{ row.view.text }}
        </p>
        <div class="mt-4 flex h-5 gap-[3px]" role="meter" :aria-valuenow="row.view.remaining ?? 0" aria-valuemin="0" aria-valuemax="100" :aria-label="`${row.label} remaining`">
          <span
            v-for="(on, i) in row.cells"
            :key="i"
            class="min-w-0 flex-1 rounded-[1px]"
            :class="cellClass(row.view.tone, on, row.view.tone === 'empty')"
          />
        </div>
        <p class="mt-2 min-h-[1rem] font-mono text-[11px] text-mist">
          {{ row.view.tone === "empty" ? "Unavailable" : [row.view.note, row.view.reset ? `resets ${row.view.reset}` : row.view.tone === "bad" ? "exhausted" : "available"].filter(Boolean).join(" · ") }}
        </p>
      </article>
    </div>
  </section>
</template>
