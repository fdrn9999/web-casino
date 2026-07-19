import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

let socket = null

export function connectSocket() {
  if (socket) return socket
  const auth = useAuthStore()
  socket = io({ auth: { token: auth.token } })
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
