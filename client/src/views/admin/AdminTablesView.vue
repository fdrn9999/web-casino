<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { api } from '../../lib/api'
import { onTablesUpdate } from '../../composables/useSocket'
import { GAME_RULE_FIELDS } from '../../lib/gameRules'

const tables = ref([])
const form = ref({ game: 'blackjack', name: '' })
const overrides = ref({})
const gameDefaults = ref({})
const msg = ref('')
const editingId = ref(null)
let off

function blankOverrides(game) {
  const o = {}
  for (const key of Object.keys(GAME_RULE_FIELDS[game] ?? {})) o[key] = ''
  return o
}

async function loadDefaults(game) {
  try {
    gameDefaults.value = (await api(`/admin/settings/${game}`)).settings
  } catch {
    gameDefaults.value = {}
  }
}

async function load() {
  tables.value = (await api('/tables')).tables
}

function resetForm() {
  form.value = { game: 'blackjack', name: '' }
  overrides.value = blankOverrides('blackjack')
  loadDefaults('blackjack')
}

// 오버라이드 입력값(문자열) -> 실제 저장할 부분 규칙 오브젝트로 변환.
// 빈 값은 "기본 규칙 사용"을 의미하므로 전송에서 제외한다.
function buildLimits(game) {
  const fields = GAME_RULE_FIELDS[game] ?? {}
  const limits = {}
  for (const [key, spec] of Object.entries(fields)) {
    const raw = overrides.value[key]
    if (raw === '' || raw === undefined || raw === null) continue
    if (spec.type === 'bool') {
      limits[key] = raw === 'true'
    } else {
      const n = Number(raw)
      if (!Number.isNaN(n)) limits[key] = n
    }
  }
  return Object.keys(limits).length ? limits : null
}

async function create() {
  msg.value = ''
  try {
    const body = { game: form.value.game, name: form.value.name, limits: buildLimits(form.value.game) }
    await api('/admin/tables', { method: 'POST', body })
    form.value.name = ''
    overrides.value = blankOverrides(form.value.game)
    await load()
    msg.value = '테이블이 생성되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

function startEdit(t) {
  msg.value = ''
  editingId.value = t.id
  form.value.game = t.game
  form.value.name = t.name
  const fields = GAME_RULE_FIELDS[t.game] ?? {}
  const o = {}
  for (const [key, spec] of Object.entries(fields)) {
    const v = t.limits?.[key]
    o[key] = v === undefined || v === null ? '' : spec.type === 'bool' ? String(v) : String(v)
  }
  overrides.value = o
  loadDefaults(t.game)
}

function cancelEdit() {
  editingId.value = null
  resetForm()
  msg.value = ''
}

async function save() {
  msg.value = ''
  try {
    const body = { name: form.value.name, limits: buildLimits(form.value.game) }
    await api(`/admin/tables/${editingId.value}`, { method: 'PUT', body })
    editingId.value = null
    resetForm()
    await load()
    msg.value = '테이블이 수정되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

function submitForm() {
  if (editingId.value) save()
  else create()
}

async function act(id, path, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return
  msg.value = ''
  try {
    if (path === 'delete') await api(`/admin/tables/${id}`, { method: 'DELETE' })
    else await api(`/admin/tables/${id}/${path}`, { method: 'POST' })
    await load()
  } catch (e) {
    msg.value = e.message
  }
}

function overriddenCount(t) {
  return t.limits ? Object.keys(t.limits).length : 0
}

// 생성 폼에서 게임을 바꾸면(편집 중이 아닐 때) 오버라이드 입력을 새 게임 필드로 초기화
watch(
  () => form.value.game,
  (game) => {
    if (!editingId.value) overrides.value = blankOverrides(game)
    loadDefaults(game)
  }
)

onMounted(() => {
  overrides.value = blankOverrides(form.value.game)
  loadDefaults(form.value.game)
  load()
  off = onTablesUpdate(({ tables: t }) => (tables.value = t))
})
onUnmounted(() => off?.())
</script>

<template>
  <div class="space-y-4">
    <form class="space-y-3 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="submitForm">
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="block text-xs text-emerald-300" for="game">게임</label>
          <select id="game" v-model="form.game" :disabled="!!editingId" class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm disabled:opacity-50">
            <option value="blackjack">블랙잭</option>
            <option value="roulette">룰렛</option>
            <option value="baccarat">바카라</option>
          </select>
        </div>
        <div class="grow">
          <label class="block text-xs text-emerald-300" for="name">테이블 이름</label>
          <input id="name" v-model="form.name" class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
        </div>
        <button class="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-bold text-emerald-950 hover:bg-amber-400">{{ editingId ? '수정 저장' : '생성' }}</button>
        <button v-if="editingId" type="button" class="rounded-lg border border-emerald-700 px-4 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900" @click="cancelEdit">취소</button>
      </div>

      <div class="rounded-lg border border-emerald-800/70 bg-emerald-950/40 p-3">
        <p class="mb-2 text-xs font-bold text-emerald-300">방 규칙 오버라이드 (비워두면 기본 규칙 사용)</p>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <div v-for="(spec, key) in GAME_RULE_FIELDS[form.game]" :key="key" class="flex flex-col gap-1">
            <label class="text-xs text-emerald-300" :for="`ov-${key}`">{{ spec.label }}</label>
            <select
              v-if="spec.type === 'bool'"
              :id="`ov-${key}`"
              v-model="overrides[key]"
              class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm"
            >
              <option value="">기본값 ({{ gameDefaults[key] ? '켬' : '끔' }})</option>
              <option value="true">켬</option>
              <option value="false">끔</option>
            </select>
            <input
              v-else
              :id="`ov-${key}`"
              v-model="overrides[key]"
              type="number"
              :step="spec.step ?? (spec.type === 'int' ? 1 : 'any')"
              :placeholder="`기본값 ${gameDefaults[key] ?? ''}`"
              class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>
    </form>
    <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>

    <div class="overflow-x-auto rounded-xl border border-emerald-800">
      <table class="w-full min-w-[560px] text-sm">
        <thead class="bg-emerald-900/60 text-left text-emerald-300">
          <tr><th class="p-2">게임</th><th class="p-2">이름</th><th class="p-2">인원</th><th class="p-2">한도/규칙</th><th class="p-2">상태</th><th class="p-2">동작</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tables" :key="t.id" class="border-t border-emerald-900">
            <td class="p-2">{{ t.game }}</td>
            <td class="p-2 font-bold">{{ t.name }}</td>
            <td class="p-2">{{ t.playerCount }}</td>
            <td class="p-2">
              <span v-if="t.limits && (t.limits.minBet != null || t.limits.maxBet != null)">
                {{ t.limits.minBet ?? '기본' }}~{{ t.limits.maxBet ?? '기본' }}
              </span>
              <span v-else>전역 설정</span>
              <span v-if="overriddenCount(t) > 0" class="ml-1 text-amber-300" title="이 방만의 규칙 오버라이드가 적용되어 있습니다.">
                (커스텀 {{ overriddenCount(t) }})
              </span>
            </td>
            <td class="p-2">
              <span :class="t.status === 'open' ? 'text-emerald-400' : 'text-red-400'">{{ t.status === 'open' ? '운영 중' : '닫힘' }}</span>
            </td>
            <td class="flex gap-2 p-2 text-xs">
              <button class="text-amber-300 hover:underline" @click="startEdit(t)">수정</button>
              <button v-if="t.status === 'open'" class="text-orange-400 hover:underline"
                @click="act(t.id, 'close', '테이블을 닫을까요? 진행 중 베팅은 환불됩니다.')">닫기</button>
              <button v-else class="text-emerald-300 hover:underline" @click="act(t.id, 'reopen')">열기</button>
              <button class="text-red-400 hover:underline"
                @click="act(t.id, 'delete', '테이블을 삭제할까요? 진행 중 베팅은 환불됩니다.')">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
