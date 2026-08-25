<script setup lang="ts">
import { computed } from "vue";
import { formatQuotaView, segments } from "../utils/quota";
import type { QuotaWindow } from "../composables/usePool";

const props = defineProps<{
  label: string;
  window?: QuotaWindow;
}>();

const view = computed(() => formatQuotaView(props.window));
const cells = computed(() => segments(view.value.filled));

function cellClass(tone: string, on: boolean, empty: boolean) {
  if (empty) return "bg-transparent border border-dashed border-line";
  if (!on) return "bg-[#1b2029]";
  if (tone === "bad") return "bg-bad";
  if (tone === "warn") return "bg-warn";
  return "bg-amber";
}
</script>

<template>
  <div>
    <div class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-2 text-[11px] font-mono">
      <span class="text-mist uppercase tracking-wider">{{ label }}</span>
      <div class="flex h-[10px] gap-[2px]">
        <span
          v-for="(on, i) in cells"
          :key="i"
          class="min-w-0 flex-1 rounded-[1px]"
          :class="cellClass(view.tone, on, view.tone === 'empty')"
        />
      </div>
      <span class="text-mist whitespace-nowrap">{{ view.tone === "empty" ? "Unavailable" : [view.text, view.reset].filter(Boolean).join(" · ") }}</span>
    </div>
    <p v-if="view.estimated" class="pl-[3.7rem] font-mono text-[10px] text-mist">Estimated from local usage</p>
  </div>
</template>
