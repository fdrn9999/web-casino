<script setup>
import { computed } from 'vue'

// 바카라 중국점(중국매) 표.
// - 빅로드(본매): 타이를 제외한 P/B 연속 구간을 열로 쌓는 기본 표. 타이는 직전 칸에 초록 숫자로 병기.
// - 파생 로드 3종(빅아이보이/소로/커크로치): 빅로드의 열 패턴 반복 여부를 각각 1/2/3열 전 열과
//   비교해 빨강(패턴 반복)/파랑(패턴 이탈)으로 기록하는 표준 카지노 규칙을 그대로 따른다.
//   * 새 열의 첫 칸: (직전 열 길이) == (비교 대상 열 길이) 이면 빨강, 다르면 파랑
//   * 열 안의 둘째 칸부터: 비교 열의 같은 행에 칸이 있으면 빨강, 정확히 한 칸 모자라면 파랑,
//     그보다 짧으면 빨강
const props = defineProps({
  // 서버 스냅샷의 history: 최신순('player'|'banker'|'tie'). 여기서 시간순으로 뒤집어 사용한다.
  history: { type: Array, default: () => [] },
})

const MAX_ROWS = 6

// 시간순 결과 → 빅로드 논리 열(타이 병기)
const bigRoadCols = computed(() => {
  const cols = []
  let lastNonTie = null
  for (const o of [...props.history].reverse()) {
    if (o === 'tie') {
      const col = cols[cols.length - 1]
      const cell = col?.[col.length - 1]
      if (cell) cell.ties += 1
      continue
    }
    if (o === lastNonTie) {
      cols[cols.length - 1].push({ o, ties: 0 })
    } else {
      cols.push([{ o, ties: 0 }])
      lastNonTie = o
    }
  }
  return cols
})

// 파생 로드: 빅로드 각 칸을 시간순으로 훑으며 lookback k열 전과 비교한 빨강/파랑 시퀀스를 만든 뒤,
// 그 시퀀스를 다시 빅로드와 같은 방식(같은 색 연속 → 같은 열)으로 열에 쌓는다.
function derivedCols(cols, k) {
  const marks = []
  for (let c = 0; c < cols.length; c++) {
    for (let r = 0; r < cols[c].length; r++) {
      let red = null
      if (r === 0) {
        if (c >= k + 1) red = cols[c - 1].length === cols[c - 1 - k].length
      } else if (c >= k) {
        const len = cols[c - k].length
        red = len === r ? false : true
      }
      if (red !== null) marks.push(red)
    }
  }
  const dcols = []
  let last = null
  for (const red of marks) {
    if (red === last) dcols[dcols.length - 1].push(red)
    else {
      dcols.push([red])
      last = red
    }
  }
  return dcols
}

// 논리 열 → 표시 좌표. 6행을 넘는 "용꼬리"는 마지막 행을 따라 오른쪽으로 꺾고,
// 점유 충돌 시 오른쪽으로 밀어 실제 카지노 전광판과 같은 모양을 만든다.
function layout(cols, cellOf) {
  const occupied = new Set()
  const cells = []
  let maxX = 0
  for (let c = 0; c < cols.length; c++) {
    for (let r = 0; r < cols[c].length; r++) {
      let x = r < MAX_ROWS ? c : c + (r - MAX_ROWS + 1)
      const y = Math.min(r, MAX_ROWS - 1)
      while (occupied.has(`${x},${y}`)) x += 1
      occupied.add(`${x},${y}`)
      maxX = Math.max(maxX, x)
      cells.push({ x, y, ...cellOf(cols[c][r]) })
    }
  }
  return { cells, colCount: cols.length ? maxX + 1 : 0 }
}

const bigRoad = computed(() => layout(bigRoadCols.value, (cell) => ({ o: cell.o, ties: cell.ties })))
const bigEye = computed(() => layout(derivedCols(bigRoadCols.value, 1), (red) => ({ red })))
const smallRoad = computed(() => layout(derivedCols(bigRoadCols.value, 2), (red) => ({ red })))
const cockroach = computed(() => layout(derivedCols(bigRoadCols.value, 3), (red) => ({ red })))

const DERIVED = [
  { key: 'bigeye', label: '빅아이', style: 'ring', road: bigEye },
  { key: 'small', label: '소로', style: 'dot', road: smallRoad },
  { key: 'cockroach', label: '커크로치', style: 'slash', road: cockroach },
]
</script>

<template>
  <!-- 기록이 없어도 격자(빈 표)를 항상 표시한다 — 중국점 표가 화면에서 사라지지 않도록 -->
  <div class="space-y-2">
    <!-- 빅로드(본매) -->
    <div class="roads-scroll">
      <div class="road-grid" :style="{ '--cell': '16px', '--cols': Math.max(bigRoad.colCount, 12) }">
        <div v-for="(cell, i) in bigRoad.cells" :key="i"
          class="road-cell" :style="{ gridColumn: cell.x + 1, gridRow: cell.y + 1 }">
          <span class="big-mark" :class="cell.o === 'banker' ? 'mark-banker' : 'mark-player'">
            {{ cell.o === 'banker' ? 'B' : 'P' }}</span>
          <span v-if="cell.ties" class="tie-badge">{{ cell.ties }}</span>
        </div>
      </div>
    </div>

    <!-- 파생 로드 3종(중국점) -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div v-for="d in DERIVED" :key="d.key" class="min-w-0">
        <p class="mb-0.5 text-[10px] font-bold tracking-wide text-emerald-400/80">{{ d.label }}</p>
        <div class="roads-scroll">
          <div class="road-grid" :style="{ '--cell': '11px', '--cols': Math.max(d.road.value.colCount, 16) }">
            <div v-for="(cell, i) in d.road.value.cells" :key="i"
              class="road-cell" :style="{ gridColumn: cell.x + 1, gridRow: cell.y + 1 }">
              <span class="derived-mark" :class="[`style-${d.style}`, cell.red ? 'derived-red' : 'derived-blue']" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roads-scroll {
  overflow-x: auto;
  border-radius: 0.5rem;
  border: 1px solid rgba(16, 185, 129, 0.25);
  background: rgba(2, 44, 34, 0.6);
  padding: 4px;
}
.road-grid {
  display: grid;
  grid-template-rows: repeat(6, var(--cell));
  grid-template-columns: repeat(var(--cols), var(--cell));
  gap: 1px;
  /* 격자 배경선 — 전광판 느낌 */
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: calc(var(--cell) + 1px) calc(var(--cell) + 1px);
  width: max-content;
}
.road-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.big-mark {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 9px;
  font-weight: 900;
  color: #fff;
}
.mark-banker { background: #dc2626; }
.mark-player { background: #2563eb; }
.tie-badge {
  position: absolute;
  right: -2px;
  top: -3px;
  font-size: 8px;
  font-weight: 900;
  color: #34d399;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.8);
}
.derived-mark { display: block; }
.derived-red { --road-c: #ef4444; }
.derived-blue { --road-c: #3b82f6; }
/* 빅아이: 테두리 원 / 소로: 꽉 찬 원 / 커크로치: 사선 — 표준 표기 */
.style-ring {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  border: 2px solid var(--road-c);
}
.style-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--road-c);
}
.style-slash {
  width: 9px;
  height: 2px;
  border-radius: 1px;
  background: var(--road-c);
  transform: rotate(-45deg);
}
</style>
