<script setup lang="ts">
import Skeleton from "./Skeleton.vue";
</script>

<template>
  <article class="border border-line bg-panel px-3 py-3">
    <header class="mb-3 flex items-baseline justify-between gap-3">
      <Skeleton class="h-3.5 w-24" />
      <Skeleton class="h-3 w-16" />
    </header>
    <div class="space-y-2">
      <div v-for="i in 3" :key="i" class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-2">
        <Skeleton class="h-2.5 w-8" />
        <Skeleton class="h-[7px] w-full" />
        <Skeleton class="h-2.5 w-14" />
      </div>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-y-2 md:grid-cols-4">
      <Skeleton v-for="i in 4" :key="i" class="h-2.5 w-16" />
    </div>
    <footer class="mt-3 flex items-center justify-between gap-2">
      <Skeleton class="h-5 w-20" />
      <div class="flex gap-2">
        <Skeleton class="h-5 w-14" />
        <Skeleton class="h-5 w-14" />
        <Skeleton class="h-5 w-14" />
      </div>
    </footer>
  </article>
</template>
