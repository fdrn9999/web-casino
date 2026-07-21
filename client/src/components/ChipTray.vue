<script setup>
import CasinoChip from './CasinoChip.vue'
import { CHIP_VALUES } from '../lib/chips'
import { sfx } from '../composables/useSound'

const props = defineProps({
  modelValue: { type: Number, required: true },
  disabled: { type: Boolean, default: false },
  size: { type: Number, default: 48 },
})
const emit = defineEmits(['update:modelValue'])

function select(v) {
  if (props.disabled || v === props.modelValue) return
  sfx.click()
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="flex flex-wrap items-end gap-2" role="radiogroup" aria-label="베팅 칩 선택">
    <button
      v-for="v in CHIP_VALUES" :key="v" type="button" :disabled="disabled"
      role="radio" :aria-checked="modelValue === v"
      class="chip-tray-btn rounded-full disabled:cursor-not-allowed disabled:opacity-40"
      :class="modelValue === v ? '-translate-y-1.5' : 'hover:-translate-y-0.5'"
      @click="select(v)"
    >
      <CasinoChip :value="v" :size="size" :selected="modelValue === v" />
    </button>
  </div>
</template>

<style scoped>
.chip-tray-btn {
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
