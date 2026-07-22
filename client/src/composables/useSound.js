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

// 모바일 촉각 피드백 — 사운드와 함께 짧게 진동한다(미지원 브라우저는 무시).
// 음소거 시 진동도 끈다(하나의 '조용히' 스위치로 동작).
function buzz(pattern) {
  if (muted.value) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // 미지원/권한 문제는 조용히 무시
  }
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
  // 칩을 베팅 스팟에 "탁" 얹는 소리 — 카지노 클레이 칩 특유의 크리스프한 클링.
  // 아주 짧은 노이즈 트랜지언트(플라스틱 접촉음) + 밝은 배음 두 개로 구성, ~70-90ms.
  // 매 호출마다 아주 살짝 피치를 흔들어(랜덤 디튠) 연속 배팅 시 로봇처럼 들리지 않게 한다.
  chip: () => {
    const detune = (Math.random() - 0.5) * 160 // ±80Hz 랜덤 디튠
    noise({ duration: 0.014, volume: 0.045 })
    tone({ freq: 2150 + detune, duration: 0.07, type: 'triangle', volume: 0.12 })
    tone({ freq: 3500 + detune * 1.4, duration: 0.05, type: 'sine', volume: 0.05, when: 0.012 })
    buzz(10)
  },
  // 액면 자동 병합(예: 100칩 5개 -> 500칩 1개) 시 재생하는, chip()보다 살짝 풍성한 겹클링.
  // 칩이 "쌓이며 정착"하는 느낌을 주기 위해 짧게 두세 번 겹쳐 울리고 옅은 노이즈로 마무리한다.
  chipStack: () => {
    const base = 1700 + Math.random() * 220
    for (let i = 0; i < 3; i++) {
      tone({ freq: base + i * 260, duration: 0.06, type: 'triangle', volume: 0.09 - i * 0.02, when: i * 0.045 })
    }
    noise({ duration: 0.02, volume: 0.035, when: 0.09 })
  },
  // 승리 시 칩이 촤라라락 쏟아지는 경쾌한 캐스케이드 — 다수의 빠른 칩 클링이 음정이 오르며 반짝인다.
  // WinCascade의 시각 연출과 함께 재생된다. 총 길이 ~0.6s.
  chipWin: () => {
    const count = 14
    for (let i = 0; i < count; i++) {
      const when = i * 0.045 + Math.random() * 0.01
      const freq = 1500 + i * 90 + Math.random() * 150
      tone({ freq, duration: 0.07, type: 'triangle', volume: 0.09, when })
      if (i % 2 === 0) noise({ duration: 0.012, volume: 0.03, when })
    }
  },
  deal: () => noise({ duration: 0.08, volume: 0.12 }),
  // 카드를 테이블에 "탁" 내려놓는 소리: 짧은 필터링된 노이즈(종이 슥) + 낮은 톤의 부드러운 툭(무게감).
  cardDeal: () => {
    noise({ duration: 0.045, volume: 0.09 })
    tone({ freq: 110, duration: 0.06, type: 'sine', volume: 0.07, when: 0.012 })
  },
  // 딜러 홀카드를 펼쳐 뒤집는 소리: 빠른 스와이프(노이즈 스윕 느낌) + 살짝 올라가는 톤.
  cardFlip: () => {
    noise({ duration: 0.09, volume: 0.07 })
    tone({ freq: 500, duration: 0.1, type: 'triangle', volume: 0.06, slideTo: 900 })
  },
  // 슈 셔플 "촤라라락": 카드가 리플로 떨어지는 빠른 종이 트랜지언트 연타.
  // 간격이 점점 촘촘해졌다가 풀리는 리듬으로 실제 리플 셔플의 가속감을 흉내낸다.
  shuffle: () => {
    let when = 0
    for (let i = 0; i < 16; i++) {
      // 앞쪽은 성기게, 중반에 가장 촘촘하게, 끝에서 다시 풀리는 간격 곡선
      const dist = Math.abs(i - 9) / 9
      when += 0.022 + dist * 0.03 + Math.random() * 0.008
      noise({ duration: 0.018, volume: 0.05 + (1 - dist) * 0.03, when })
    }
    // 마지막에 덱을 "탁" 정리하는 마무리 톤
    tone({ freq: 130, duration: 0.08, type: 'sine', volume: 0.08, when: when + 0.1 })
    noise({ duration: 0.05, volume: 0.08, when: when + 0.1 })
  },
  spinStart: () => tone({ freq: 200, duration: 0.3, type: 'sawtooth', volume: 0.08, slideTo: 600 }),
  spinTick: () => tone({ freq: 900, duration: 0.03, type: 'square', volume: 0.05 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.15, type: 'triangle', volume: 0.14, when: i * 0.12 }))
    buzz([25, 50, 25])
  },
  // 빠칭코풍 슬롯 당첨: 칩 쏟아지는 캐스케이드 + 밝은 상승 팡파레 + 종 딩. big이면 화려한 플러리시 추가.
  slotWin: (big = false) => {
    sfx.chipWin()
    buzz(big ? [40, 60, 40, 60, 90] : [25, 45, 25])
    ;[784, 988, 1319].forEach((f, i) =>
      tone({ freq: f, duration: 0.16, type: 'triangle', volume: 0.15, when: i * 0.09 }))
    tone({ freq: 2637, duration: 0.28, type: 'sine', volume: 0.09, when: 0.3 }) // 종 딩
    if (big) {
      ;[1047, 1319, 1568, 2093, 2637].forEach((f, i) =>
        tone({ freq: f, duration: 0.22, type: 'triangle', volume: 0.13, when: 0.42 + i * 0.1 }))
      for (let i = 0; i < 10; i++) {
        tone({ freq: 1800 + Math.random() * 900, duration: 0.06, type: 'square', volume: 0.05, when: 0.42 + i * 0.05 })
      }
    }
  },
  lose: () => {
    tone({ freq: 330, duration: 0.2, type: 'sine', volume: 0.1 })
    tone({ freq: 220, duration: 0.35, type: 'sine', volume: 0.1, when: 0.18 })
  },
  countdown: () => tone({ freq: 1000, duration: 0.08, type: 'sine', volume: 0.1 }),
  // 승리 시 칩이 잔액으로 촤라락 쏟아지는 연출용 사운드. 더 풍성한 chipWin()으로 통일한다.
  // (레거시 호출부 호환용 별칭 — 새 코드는 chipWin()을 직접 쓴다.)
  cascade: () => sfx.chipWin(),
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
