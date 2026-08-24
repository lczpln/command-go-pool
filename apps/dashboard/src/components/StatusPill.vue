<script setup lang="ts">
const props = defineProps<{ status: string }>();

const map: Record<string, { label: string; class: string }> = {
  available: { label: "AVAILABLE", class: "text-ok" },
  active: { label: "ACTIVE", class: "text-ok" },
  cooldown: { label: "COOLDOWN", class: "text-warn" },
  quota_exhausted: { label: "COOLDOWN", class: "text-warn" },
  auth_error: { label: "AUTH ERROR", class: "text-bad" },
  upstream_error: { label: "UPSTREAM", class: "text-bad" },
  disabled: { label: "DISABLED", class: "text-mist" },
};
</script>

<template>
  <span class="font-mono text-[11px] tracking-widest" :class="map[props.status]?.class ?? 'text-mist'">
    ● {{ map[props.status]?.label ?? props.status.toUpperCase() }}
  </span>
</template>
