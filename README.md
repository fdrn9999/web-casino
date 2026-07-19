# 🎰 베가스 — 가상머니 라이브 카지노 (연습 프로젝트)

**현금 결제가 일절 없는 가상머니(칩) 전용** 한국어 라이브 카지노입니다.
도박의 위험성을 알리는 교육 목적을 겸합니다 — 파산 구제 시 누적 손실을 직면시키고,
1시간마다 휴식을 권장하며, 마이페이지에서 본인 손익을 숨김없이 보여줍니다.

## 기능
- 실시간 멀티플레이어: 블랙잭(7석) · 룰렛(유러피언) · 바카라 — 관리자가 만든 테이블에서 서버 주도 라운드
- 슬롯머신 + 전역 프로그레시브 잭팟 (당첨 시 전체 실시간 알림 + 잭팟 사운드)
- 관리자: 유저 관리(지급/몰수/차단), 테이블 CRUD, 공지 CRUD(실시간 푸시), 게임 규칙 설정, 통계 대시보드
- 이코노미: 가입 10,000칩 · 일일 보너스 · 파산 구제(쿨다운+경고)
- 사운드: 조작/딜링/승패 SE(Web Audio 합성) + 잭팟 mp3, 음소거 토글
- 모바일/PC 반응형

## 개발 실행
```
npm install && npm --prefix server install && npm --prefix client install
npm run dev      # 서버 :4000 + 클라이언트 :5173 → http://localhost:5173
```

## 프로덕션 실행
```
npm run build    # client/dist 생성
npm start        # http://localhost:4000 (정적 서빙 포함)
```

## 계정
- 기본 관리자: `admin` / `admin1234` (server/.env로 변경)

## 테스트
```
npm test         # 서버 게임 로직·API 단위/통합 테스트 (Vitest)
```

## 에셋 출처
- 카드 이미지: [playing-cards-assets](https://github.com/hayeah/playing-cards-assets) (MIT)

> 본 사이트는 가상머니 전용입니다. 실제 도박은 오락이 아닌 손실이며, 중독은 질병입니다.
