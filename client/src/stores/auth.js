import { defineStore } from 'pinia'
import { api } from '../lib/api'

// Module-level (not store state): dedupes concurrent fetchMe() calls, e.g.
// the unawaited boot-time call in main.js racing the router guard's await.
let fetchMePromise = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token'),
    user: null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
  },
  actions: {
    _apply({ token, user }) {
      this.token = token
      this.user = user
      localStorage.setItem('token', token)
    },
    async signup(form) {
      this._apply(await api('/auth/signup', { method: 'POST', body: form }))
    },
    async login(form) {
      this._apply(await api('/auth/login', { method: 'POST', body: form }))
    },
    async fetchMe() {
      if (fetchMePromise) return fetchMePromise
      fetchMePromise = (async () => {
        try {
          const { user } = await api('/me')
          this.user = user
        } catch {
          this.logout()
        } finally {
          fetchMePromise = null
        }
      })()
      return fetchMePromise
    },
    logout() {
      this.token = null
      this.user = null
      localStorage.removeItem('token')
    },
    setBalance(balance) {
      if (this.user) this.user.balance = balance
    },
  },
})
