<script setup lang="ts">
import StatusDot from "./StatusDot.vue";

const props = defineProps<{ status: string }>();

const map: Record<string, { label: string; class: string; pulse: boolean }> = {
  available: { label: "AVAILABLE", class: "text-ok", pulse: true },
  active: { label: "ACTIVE", class: "text-amber", pulse: true },
  cooldown: { label: "COOLDOWN", class: "text-warn", pulse: true },
  quota_exhausted: { label: "COOLDOWN", class: "text-warn", pulse: true },
  auth_error: { label: "AUTH ERROR", class: "text-bad", pulse: true },
  upstream_error: { label: "UPSTREAM", class: "text-bad", pulse: true },
  disabled: { label: "DISABLED", class: "text-mist", pulse: false },
};
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-widest"
    :class="map[props.status]?.class ?? 'text-mist'"
  >
    <StatusDot :pulse="map[props.status]?.pulse ?? false" />
    {{ map[props.status]?.label ?? props.status.toUpperCase() }}
  </span>
</template>
