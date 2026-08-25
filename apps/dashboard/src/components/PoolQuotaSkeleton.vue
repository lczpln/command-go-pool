<script setup lang="ts">
import Skeleton from "./Skeleton.vue";
</script>

<template>
  <section class="border border-line bg-panel" role="status" aria-label="Loading pool quota">
    <header class="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <Skeleton class="h-2.5 w-28" />
        <Skeleton class="mt-2 h-3.5 w-52" />
      </div>
      <Skeleton class="h-3 w-24" />
    </header>
    <div class="grid gap-px bg-line md:grid-cols-3">
      <article v-for="i in 3" :key="i" class="bg-panel px-4 py-4">
        <Skeleton class="h-2.5 w-14" />
        <Skeleton class="mt-3 h-8 w-20" />
        <Skeleton class="mt-4 h-5 w-full" />
        <Skeleton class="mt-2 h-2.5 w-32" />
      </article>
    </div>
  </section>
</template>
