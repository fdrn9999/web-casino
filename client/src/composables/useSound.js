import { ref } from 'vue'

const muted = ref(localStorage.getItem('muted') === '1')
let audioCtx = null

function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function tone({ freq = 440, duration = 0.1, type = 'sine', volume = 0.15, when = 0, slideTo = null }) {
  if (muted.value) return
  const c = ctx()
  const osc = c.createOscillator()
  const gain = c.createGain()
  const t0 = c.currentTime + when
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration)
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

function noise({ duration = 0.06, volume = 0.1, when = 0 }) {
  if (muted.value) return
  const c = ctx()
  const buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  const gain = c.createGain()
  const t0 = c.currentTime + when
  src.buffer = buffer
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  src.connect(gain).connect(c.destination)
  src.start(t0)
}

export const sfx = {
  click: () => tone({ freq: 700, duration: 0.05, type: 'square', volume: 0.06 }),
  chip: () => {
    tone({ freq: 1800, duration: 0.04, type: 'triangle', volume: 0.12 })
    tone({ freq: 2400, duration: 0.05, type: 'triangle', volume: 0.08, when: 0.05 })
  },
  deal: () => noise({ duration: 0.08, volume: 0.12 }),
  spinStart: () => tone({ freq: 200, duration: 0.3, type: 'sawtooth', volume: 0.08, slideTo: 600 }),
  spinTick: () => tone({ freq: 900, duration: 0.03, type: 'square', volume: 0.05 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.15, type: 'triangle', volume: 0.14, when: i * 0.12 }))
  },
  lose: () => {
    tone({ freq: 330, duration: 0.2, type: 'sine', volume: 0.1 })
    tone({ freq: 220, duration: 0.35, type: 'sine', volume: 0.1, when: 0.18 })
  },
  countdown: () => tone({ freq: 1000, duration: 0.08, type: 'sine', volume: 0.1 }),
}

let jackpotAudio = null
export function playJackpot() {
  if (muted.value) return
  if (!jackpotAudio) jackpotAudio = new Audio('/sounds/jackpot.mp3')
  jackpotAudio.currentTime = 0
  jackpotAudio.play().catch(() => {})
}

export function useSound() {
  function toggleMute() {
    muted.value = !muted.value
    localStorage.setItem('muted', muted.value ? '1' : '0')
  }
  return { muted, toggleMute, sfx, playJackpot }
}
