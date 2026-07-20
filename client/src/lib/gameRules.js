// 게임별로 "방(테이블)"에서 재정의 가능한 규칙 필드 메타데이터.
// server/src/services/tables.js 의 GAME_RULE_FIELDS 와 대응된다.
// 여기 없는 필드는 오버라이드 UI에 노출되지 않고, 비워두면 전역 기본 규칙(설정 화면 값)을 그대로 따른다.
export const GAME_RULE_FIELDS = {
  blackjack: {
    minBet: { type: 'int', label: '최소 베팅' },
    maxBet: { type: 'int', label: '최대 베팅' },
    decks: { type: 'int', label: '슈 덱 수(1~8)', min: 1, max: 8, step: 1 },
    hitSoft17: { type: 'bool', label: '딜러 소프트17 히트' },
    surrenderAllowed: { type: 'bool', label: '서렌더 허용' },
    doubleAllowed: { type: 'bool', label: '더블 허용' },
    splitAllowed: { type: 'bool', label: '스플릿 허용' },
    blackjackPayout: { type: 'number', label: '블랙잭 배당(1.5=3:2, 1.2=6:5)', min: 1, max: 2, step: 0.1 },
    betSeconds: { type: 'int', label: '베팅 시간(초)', min: 5, max: 120, step: 1 },
    turnSeconds: { type: 'int', label: '턴 시간(초)', min: 5, max: 120, step: 1 },
  },
  roulette: {
    minBet: { type: 'int', label: '최소 베팅' },
    maxBet: { type: 'int', label: '최대 베팅' },
    betSeconds: { type: 'int', label: '베팅 시간(초)', min: 5, max: 120, step: 1 },
    spinSeconds: { type: 'int', label: '스핀 연출 시간(초)', min: 5, max: 120, step: 1 },
  },
  baccarat: {
    minBet: { type: 'int', label: '최소 베팅' },
    maxBet: { type: 'int', label: '최대 베팅' },
    betSeconds: { type: 'int', label: '베팅 시간(초)', min: 5, max: 120, step: 1 },
    revealSeconds: { type: 'int', label: '공개 연출 시간(초)', min: 5, max: 120, step: 1 },
    tiePayout: { type: 'number', label: '타이 배당', min: 0.01, max: 1000, step: 1 },
    pairPayout: { type: 'number', label: '페어 배당', min: 0.01, max: 1000, step: 1 },
  },
}
