<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js/auto'

const props = defineProps({
  type: { type: String, default: 'line' },
  labels: { type: Array, required: true },
  datasets: { type: Array, required: true }, // [{ label, data, color }]
})

const canvas = ref(null)
let chart = null

function render() {
  chart?.destroy()
  chart = new Chart(canvas.value, {
    type: props.type,
    data: {
      labels: props.labels,
      datasets: props.datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color + '80',
        tension: 0.25,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a7f3d0' } } },
      scales: {
        x: { ticks: { color: '#6ee7b7' }, grid: { color: '#064e3b' } },
        y: { ticks: { color: '#6ee7b7' }, grid: { color: '#064e3b' } },
      },
    },
  })
}

watch(() => [props.labels, props.datasets], render, { deep: true })
onMounted(render)
onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="h-64 w-full"><canvas ref="canvas" /></div>
</template>
