import { createRouter, createWebHistory } from "vue-router";
import OverviewPage from "./pages/OverviewPage.vue";
import AccountsPage from "./pages/AccountsPage.vue";
import AccountDetailPage from "./pages/AccountDetailPage.vue";
import ModelsPage from "./pages/ModelsPage.vue";
import SessionsPage from "./pages/SessionsPage.vue";
import SessionDetailPage from "./pages/SessionDetailPage.vue";
import UsagePage from "./pages/UsagePage.vue";
import EventsPage from "./pages/EventsPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: OverviewPage },
    { path: "/accounts", component: AccountsPage },
    { path: "/accounts/:id", component: AccountDetailPage },
    { path: "/models", component: ModelsPage },
    { path: "/sessions", component: SessionsPage },
    { path: "/sessions/:id", component: SessionDetailPage },
    { path: "/usage", component: UsagePage },
    { path: "/events", component: EventsPage },
    { path: "/settings", component: SettingsPage },
  ],
});
