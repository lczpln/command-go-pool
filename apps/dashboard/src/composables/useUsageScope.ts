import { computed, reactive, ref, watch } from "vue";
import { fetchUsage, store } from "./usePool";

export type UsageDimension = "accountId" | "model" | "sessionId";

export function useUsageScope() {
  const filters = reactive({ accountId: "", model: "", sessionId: "" });
  const scoped = ref<Record<string, unknown> | null>(null);
  let request = 0;

  const hasFilter = computed(() => Boolean(filters.accountId || filters.model || filters.sessionId));
  const usage = computed(() => scoped.value ?? store.usage ?? {});

  watch(
    [() => filters.accountId, () => filters.model, () => filters.sessionId, () => store.usage],
    async () => {
      const n = ++request;
      if (!hasFilter.value) {
        scoped.value = null;
        return;
      }
      const next = await fetchUsage({
        accountId: filters.accountId || undefined,
        model: filters.model || undefined,
        sessionId: filters.sessionId || undefined,
      });
      if (n === request) scoped.value = next;
    },
  );

  function toggle(dimension: UsageDimension, key?: string) {
    if (!key) return;
    filters[dimension] = filters[dimension] === key ? "" : key;
  }

  function clear() {
    filters.accountId = "";
    filters.model = "";
    filters.sessionId = "";
  }

  return { filters, usage, hasFilter, toggle, clear };
}
