<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <span class="skeleton rounded-[1px]" v-bind="$attrs" aria-hidden="true" />
</template>
