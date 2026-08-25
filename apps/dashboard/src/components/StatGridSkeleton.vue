<script setup lang="ts">
import Skeleton from "./Skeleton.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>

<template>
  <section class="grid grid-cols-2 gap-px bg-line md:grid-cols-4" role="status" aria-label="Loading stats">
    <div v-for="i in count" :key="i" class="bg-ink px-3 py-3">
      <Skeleton class="h-2.5 w-16" />
      <Skeleton class="mt-2 h-8 w-12" />
    </div>
  </section>
</template>
