import { defineStore } from 'pinia'
import { api } from '../lib/api'

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
      try {
        const { user } = await api('/me')
        this.user = user
      } catch {
        this.logout()
      }
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
