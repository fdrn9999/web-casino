import { Rectangle } from 'pixi.js'

// 포인터/제스처 유틸 — 마우스·터치를 통합(pointertap)하고, 모바일용으로 히트영역을 넉넉히 키운다.
export function hit(node, { pad = 12 } = {}) {
  node.eventMode = 'static'
  node.cursor = 'pointer'
  const b = node.getLocalBounds()
  node.hitArea = new Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)
  return node
}

// pointertap은 마우스 클릭과 터치 탭 모두에서 발생한다.
export function onTap(node, fn) {
  node.eventMode = 'static'
  node.cursor = 'pointer'
  node.on('pointertap', fn)
  return node
}
