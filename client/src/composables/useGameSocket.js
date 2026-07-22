import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'
import { toast } from './useToast'

// 최초 연결(테이블 입장)이 성공하기 전 연속 실패 허용 횟수.
// 이 횟수를 넘기면 서버가 응답하지 않는 것으로 보고 로비로 안내한다.
const INITIAL_CONNECT_ERROR_LIMIT = 3

export function useGameSocket(gameKey) {
  const auth = useAuthStore()
  let socket = null
  const stateListeners = new Set()
  const chatListeners = new Set()
  const dispatchState = (s) => stateListeners.forEach((fn) => fn(s))

  function connect(tableId) {
    socket = io(`/${gameKey}`, { auth: { token: auth.token } })
    socket.on('table:state', dispatchState)
    socket.on('chat:message', (msg) => chatListeners.forEach((fn) => fn(msg)))
    socket.on('balance:update', ({ balance }) => auth.setBalance(balance))
    socket.on('table:closed', () => {
      toast.info('관리자가 테이블을 닫았습니다. 베팅은 환불되었습니다.')
      router.push('/')
    })
    return new Promise((resolve, reject) => {
      // 최초 입장(connect() 호출)의 Promise가 이미 처리(resolve/reject)됐는지 여부.
      // false인 동안은 "아직 한 번도 접속 성공하지 못한 초기 연결 단계"이고,
      // true가 된 이후의 connect_error/재연결은 세션 중 순단이므로 자동 재연결에 맡긴다.
      let settled = false
      let initialErrorCount = 0

      socket.on('connect', async () => {
        const res = await socket.emitWithAck('table:join', { tableId: Number(tableId) })
        if (res.error) {
          // 존재하지 않거나 입장할 수 없는 테이블 — 조용한 리다이렉트 대신 명확히 안내한다.
          toast.error(res.error || '존재하지 않는 테이블입니다.')
          router.push('/')
          if (!settled) {
            settled = true
            reject(new Error(res.error))
          }
          return
        }
        if (!settled) {
          settled = true
          initialErrorCount = 0
          resolve(res.state)
        } else {
          // 재연결 성공: emitWithAck로 받은 최신 스냅샷을 table:state와 동일한 경로로
          // 디스패치한다(그냥 resolve만 하면 이미 settled된 Promise라 버려지고,
          // 다음 브로드캐스트 전까지 화면이 stale 상태로 남는다).
          initialErrorCount = 0
          dispatchState(res.state)
        }
      })
      socket.on('connect_error', (e) => {
        if (settled) {
          // 세션 중 일시적인 연결 끊김 — Socket.IO 자동 재연결에 맡기고 조용히 대기한다.
          return
        }
        initialErrorCount += 1
        if (initialErrorCount >= INITIAL_CONNECT_ERROR_LIMIT) {
          settled = true
          toast.error('테이블에 연결할 수 없습니다. 다시 로그인해 주세요.')
          router.push('/')
          reject(e)
        }
      })
      socket.on('reconnect_failed', () => {
        if (!settled) {
          settled = true
          toast.error('테이블에 연결할 수 없습니다. 다시 로그인해 주세요.')
          router.push('/')
          reject(new Error('reconnect_failed'))
        }
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

  function onChat(fn) {
    chatListeners.add(fn)
    return () => chatListeners.delete(fn)
  }

  function sendChat(text) {
    return socket.emitWithAck('chat:send', { text })
  }

  function disconnect() {
    socket?.close()
    socket = null
  }

  return { connect, emitAck, onState, onChat, sendChat, disconnect }
}
