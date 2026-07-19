import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
  { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
  { path: '/', component: () => import('../views/LobbyView.vue'), meta: { requiresAuth: true } },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) return '/login'
  if (to.meta.guestOnly && auth.isLoggedIn) return '/'
})
