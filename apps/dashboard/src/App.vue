<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { useLive } from "./composables/usePool";

useLive();

const links = [
  { to: "/", label: "Overview" },
  { to: "/accounts", label: "Accounts" },
  { to: "/models", label: "Models" },
  { to: "/sessions", label: "Sessions" },
  { to: "/usage", label: "Usage" },
  { to: "/events", label: "Events" },
  { to: "/settings", label: "Settings" },
];
</script>

<template>
  <div class="min-h-full bg-ink text-paper">
    <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 md:flex-row">
      <aside class="md:w-44 md:shrink-0">
        <img src="/favicon.svg" alt="" width="28" height="28" class="size-7" />
        <p class="mt-3 font-mono text-[11px] tracking-[0.3em] text-amber">CGP</p>
        <p class="mt-2 text-sm">Command Go Proxy</p>
        <nav class="mt-6 flex flex-row gap-3 overflow-x-auto md:flex-col md:gap-1">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="font-mono text-[12px] text-mist hover:text-paper"
            active-class="text-paper"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
      </aside>
      <main class="min-w-0 flex-1 pb-10">
        <RouterView />
      </main>
    </div>
  </div>
</template>
