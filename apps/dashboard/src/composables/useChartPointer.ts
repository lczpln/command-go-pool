import { onMounted, onUnmounted, ref, toValue, type MaybeRefOrGetter } from "vue";
import { pointIndexFromX } from "../utils/chart";

export function useChartPointer(count: MaybeRefOrGetter<number>) {
  const root = ref<HTMLElement | null>(null);
  const index = ref<number | null>(null);
  const x = ref(0);
  const sticky = ref(false);

  function read(event: PointerEvent) {
    const el = root.value;
    const n = toValue(count);
    if (!el || n <= 0) return;
    const rect = el.getBoundingClientRect();
    index.value = pointIndexFromX(event.clientX, rect, n);
    x.value = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  }

  function onPointerDown(event: PointerEvent) {
    sticky.value = event.pointerType !== "mouse";
    read(event);
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerType === "mouse" || event.buttons > 0 || sticky.value) read(event);
  }

  function onPointerLeave() {
    if (!sticky.value) index.value = null;
  }

  function onPointerCancel() {
    sticky.value = false;
    index.value = null;
  }

  function onDocPointerDown(event: PointerEvent) {
    if (!sticky.value) return;
    if (root.value?.contains(event.target as Node)) return;
    sticky.value = false;
    index.value = null;
  }

  onMounted(() => document.addEventListener("pointerdown", onDocPointerDown, true));
  onUnmounted(() => document.removeEventListener("pointerdown", onDocPointerDown, true));

  return { root, index, x, onPointerDown, onPointerMove, onPointerLeave, onPointerCancel };
}
