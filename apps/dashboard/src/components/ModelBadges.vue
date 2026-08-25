<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  models?: string[];
  empty?: string;
}>();

const open = ref(false);
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
    <button
      type="button"
      class="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.28em] text-mist hover:text-paper"
      :aria-expanded="open"
      aria-controls="account-models"
      @click="open = !open"
    >
      <span class="inline-block text-[10px] leading-none transition-transform duration-150" :class="open ? 'rotate-90' : ''" aria-hidden="true">▸</span>
      MODELS · {{ props.models.length }}
    </button>
    <ul v-if="open" id="account-models" class="mt-2 flex flex-wrap gap-1.5">
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
