<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { login } from "../composables/useAuth";

const router = useRouter();
const route = useRoute();
const password = ref("");
const busy = ref(false);
const message = ref<string | null>(null);

async function submit() {
  message.value = null;
  if (!password.value) {
    message.value = "Password is required";
    return;
  }
  busy.value = true;
  try {
    await login(password.value);
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    await router.replace(next);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Sign in failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-4">
    <section class="w-full max-w-sm border border-line bg-panel">
      <header class="border-b border-line px-4 py-3">
        <p class="font-mono text-[11px] tracking-[0.28em] text-amber">CGP</p>
        <h1 class="mt-1 text-sm">Dashboard lock</h1>
      </header>
      <form class="flex flex-col gap-3 px-4 py-4" @submit.prevent="submit">
        <p class="text-sm text-mist">This pool is exposed. Sign in with COMMAND_GO_POOL_DASHBOARD_PASSWORD.</p>
        <label class="block">
          <span class="font-mono text-[11px] uppercase tracking-wider text-mist">Password</span>
          <input
            v-model="password"
            class="mt-1 w-full border border-line bg-ink px-2 py-2 font-mono text-[13px] text-paper outline-none focus:border-amber"
            type="password"
            name="password"
            autocomplete="current-password"
            autofocus
          />
        </label>
        <button class="border border-line px-3 py-2 font-mono text-[12px] hover:border-amber disabled:opacity-50" :disabled="busy" type="submit">
          {{ busy ? "Signing in…" : "Sign in" }}
        </button>
        <p v-if="message" class="font-mono text-[12px] text-bad">{{ message }}</p>
      </form>
    </section>
  </div>
</template>
