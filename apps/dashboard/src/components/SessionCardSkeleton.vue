<script setup lang="ts">
import Skeleton from "./Skeleton.vue";
</script>

<template>
  <article class="border border-line bg-panel p-3">
    <header class="mb-2 flex justify-between">
      <Skeleton class="h-3 w-28" />
      <Skeleton class="h-3 w-16" />
    </header>
    <Skeleton class="h-3 w-44" />
    <div class="mt-3 grid grid-cols-2 gap-y-2 md:grid-cols-4">
      <Skeleton v-for="i in 6" :key="i" class="h-8 w-20" />
    </div>
  </article>
</template>
