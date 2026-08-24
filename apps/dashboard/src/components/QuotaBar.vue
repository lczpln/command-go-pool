<script setup lang="ts">
import { computed } from "vue";
import { formatQuotaView } from "../utils/quota";
import type { QuotaWindow } from "../composables/usePool";

const props = defineProps<{
  label: string;
  window?: QuotaWindow;
}>();

const view = computed(() => formatQuotaView(props.window));
</script>

<template>
  <div>
    <div class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-2 text-[11px] font-mono">
      <span class="text-mist uppercase tracking-wider">{{ label }}</span>
      <div class="h-[7px] overflow-hidden rounded-[1px] bg-[#1b2029]">
        <div
          v-if="view.tone !== 'empty'"
          class="h-full"
          :class="view.tone === 'bad' ? 'bg-bad' : view.tone === 'warn' ? 'bg-warn' : 'bg-amber'"
          :style="{ width: `${view.filled}%` }"
        />
        <div v-else class="h-full w-full border-b border-dashed border-line" />
      </div>
      <span class="text-mist whitespace-nowrap">{{ view.tone === "empty" ? "Unavailable" : [view.text, view.reset].filter(Boolean).join(" · ") }}</span>
    </div>
    <p v-if="view.estimated" class="pl-[3.7rem] font-mono text-[10px] text-mist">Estimated from local usage</p>
  </div>
</template>
