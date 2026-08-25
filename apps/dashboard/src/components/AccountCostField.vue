<script setup lang="ts">
import { ref, watch } from "vue";
import { patchAccount } from "../composables/usePool";

const props = defineProps<{
  accountId: string;
  label: string;
  value?: number;
}>();

const draft = ref(format(props.value));
const busy = ref(false);
const focused = ref(false);

function format(n?: number) {
  return n === undefined ? "" : String(n);
}

watch(
  () => props.value,
  (n) => {
    if (!focused.value && !busy.value) draft.value = format(n);
  },
);

async function commit() {
  const next = draft.value.trim() === "" ? 0 : Number(draft.value);
  if (!Number.isFinite(next) || next < 0) {
    draft.value = format(props.value);
    return;
  }
  if (next === (props.value ?? 0)) {
    draft.value = format(props.value);
    return;
  }
  busy.value = true;
  try {
    await patchAccount(props.accountId, { monthlySubscriptionCost: next });
  } catch {
    draft.value = format(props.value);
  } finally {
    busy.value = false;
  }
}

function onBlur() {
  focused.value = false;
  void commit();
}

function onEnter(event: KeyboardEvent) {
  (event.target as HTMLInputElement).blur();
}
</script>

<template>
  <label class="inline-flex items-center gap-1.5">
    <span class="font-mono text-[11px] uppercase tracking-wider text-mist">$/mo</span>
    <input
      v-model="draft"
      class="w-[4.5rem] border border-line bg-ink px-1.5 py-0.5 font-mono text-[12px] text-paper outline-none focus:border-amber disabled:opacity-50"
      inputmode="decimal"
      :aria-label="`${label} monthly subscription cost`"
      :disabled="busy"
      @focus="focused = true"
      @blur="onBlur"
      @keydown.enter.prevent="onEnter"
    />
  </label>
</template>
