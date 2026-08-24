<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  models?: string[];
  empty?: string;
}>();

const copied = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy(id: string) {
  await navigator.clipboard.writeText(id);
  copied.value = id;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (copied.value === id) copied.value = null;
  }, 1200);
}

function tone(id: string) {
  const key = id.toLowerCase();
  if (key.startsWith("claude") || key.includes("anthropic")) return "border-amber/40 text-amber";
  if (key.startsWith("gpt") || key.startsWith("openai")) return "border-info/40 text-info";
  if (key.includes("gemini") || key.startsWith("google")) return "border-info/40 text-info";
  if (key.includes("deepseek")) return "border-ok/40 text-ok";
  if (key.includes("grok") || key.startsWith("xai")) return "border-paper/35 text-paper";
  if (key.includes("qwen")) return "border-warn/40 text-warn";
  return "border-line text-mist";
}
</script>

<template>
  <p v-if="!props.models?.length" class="font-mono text-[12px] text-mist">
    {{ props.empty ?? "Models refresh on next health tick" }}
  </p>
  <section v-else>
    <p class="mb-2 font-mono text-[11px] tracking-[0.28em] text-mist">MODELS · {{ props.models.length }}</p>
    <ul class="flex flex-wrap gap-1.5">
      <li v-for="id in props.models" :key="id">
        <button
          type="button"
          class="border bg-ink px-1.5 py-0.5 font-mono text-[11px] leading-tight transition-colors hover:bg-panel"
          :class="[tone(id), copied === id ? 'bg-panel' : '']"
          :title="copied === id ? 'Copied' : `Copy ${id}`"
          @click="copy(id)"
        >
          {{ id }}
        </button>
      </li>
    </ul>
  </section>
</template>
