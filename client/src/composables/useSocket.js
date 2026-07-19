import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

let socket = null

const noticeListeners = new Set()
export function onNotice(fn) {
  noticeListeners.add(fn)
  return () => noticeListeners.delete(fn)
}

const jackpotPoolListeners = new Set()
const jackpotWonListeners = new Set()
export function onJackpotPool(fn) {
  jackpotPoolListeners.add(fn)
  return () => jackpotPoolListeners.delete(fn)
}
export function onJackpotWon(fn) {
  jackpotWonListeners.add(fn)
  return () => jackpotWonListeners.delete(fn)
}

const tablesListeners = new Set()
export function onTablesUpdate(fn) {
  tablesListeners.add(fn)
  return () => tablesListeners.delete(fn)
}

export function connectSocket() {
  if (socket) return socket
  const auth = useAuthStore()
  socket = io({ auth: { token: auth.token } })
  socket.on('notice:new', (notice) => noticeListeners.forEach((fn) => fn(notice)))
  socket.on('jackpot:pool', (p) => jackpotPoolListeners.forEach((fn) => fn(p)))
  socket.on('jackpot:won', (p) => jackpotWonListeners.forEach((fn) => fn(p)))
  socket.on('tables:update', (p) => tablesListeners.forEach((fn) => fn(p)))
  socket.on('balance:update', ({ balance }) => auth.setBalance(balance))
  socket.on('session:banned', () => {
    auth.logout()
    disconnectSocket()
    router.push('/login?banned=1')
  })
  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  socket?.close()
  socket = null
}
