import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
  { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
  { path: '/', component: () => import('../views/LobbyView.vue'), meta: { requiresAuth: true } },
  { path: '/slots', component: () => import('../views/SlotsView.vue'), meta: { requiresAuth: true } },
  { path: '/blackjack/:tableId', component: () => import('../views/BlackjackView.vue'), meta: { requiresAuth: true } },
  { path: '/roulette/:tableId', component: () => import('../views/RouletteView.vue'), meta: { requiresAuth: true } },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
    children: [
      { path: '', redirect: '/admin/users' },
      { path: 'users', component: () => import('../views/admin/AdminUsersView.vue') },
      { path: 'notices', component: () => import('../views/admin/AdminNoticesView.vue') },
      { path: 'tables', component: () => import('../views/admin/AdminTablesView.vue') },
      { path: 'settings', component: () => import('../views/admin/AdminSettingsView.vue') },
    ],
  },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (auth.isLoggedIn && !auth.user) await auth.fetchMe()
  if (to.meta.requiresAuth && !auth.isLoggedIn) return '/login'
  if (to.meta.guestOnly && auth.isLoggedIn) return '/'
  if (to.meta.requiresAdmin && !auth.isAdmin) return '/'
})
