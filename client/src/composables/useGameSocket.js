import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

export function useGameSocket(gameKey) {
  const auth = useAuthStore()
  let socket = null
  const stateListeners = new Set()

  function connect(tableId) {
    socket = io(`/${gameKey}`, { auth: { token: auth.token } })
    socket.on('table:state', (s) => stateListeners.forEach((fn) => fn(s)))
    socket.on('table:closed', () => {
      alert('관리자가 테이블을 닫았습니다. 베팅은 환불되었습니다.')
      router.push('/')
    })
    return new Promise((resolve, reject) => {
      socket.on('connect', async () => {
        const res = await socket.emitWithAck('table:join', { tableId: Number(tableId) })
        if (res.error) {
          alert(res.error)
          router.push('/')
          return reject(new Error(res.error))
        }
        resolve(res.state)
      })
      socket.on('connect_error', (e) => {
        alert('테이블에 연결할 수 없습니다. 다시 로그인해 주세요.')
        router.push('/')
        reject(e)
      })
    })
  }

  function emitAck(event, payload = {}) {
    return socket.emitWithAck(event, payload)
  }

  function onState(fn) {
    stateListeners.add(fn)
    return () => stateListeners.delete(fn)
  }

  function disconnect() {
    socket?.close()
    socket = null
  }

  return { connect, emitAck, onState, disconnect }
}
