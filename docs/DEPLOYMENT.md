# 🚀 배포 가이드 (로컬 → 웹)

베가스 카지노를 실제 웹에 올리기 위한 전환 가이드입니다. 이 앱의 구조상 **주의할 제약이 몇 가지** 있으니
먼저 그 부분을 이해하고 배포 방식을 고르는 것이 중요합니다.

---

## 0. 이 앱의 배포 특성 (먼저 읽기)

| 특성 | 의미 | 결론 |
|---|---|---|
| **단일 Node 프로세스** | 프로덕션에선 Express 하나가 API + WebSocket + 빌드된 Vue 정적파일을 모두 서빙(`npm start`). 클라·API가 같은 오리진 → CORS 설정 불필요. | 서비스 1개만 띄우면 됨 |
| **WebSocket(Socket.IO) 상시 연결** | 라이브 테이블·채팅·실시간 잔액이 WebSocket 기반. | **상시 구동 Node 호스트 필요.** Vercel/Netlify 같은 **서버리스는 부적합** |
| **SQLite(better-sqlite3) 파일 DB** | 데이터가 `server/data/casino.db` 파일에 저장됨. | **영속 디스크 필요.** 컨테이너/서버리스의 휘발성 파일시스템이면 데이터 소실 |
| **better-sqlite3 = 네이티브 모듈** | 배포 서버(Linux)에서 컴파일/프리빌드 필요. | 배포 시 `npm install`이 서버에서 실행돼야 함(로컬 node_modules 그대로 올리지 말 것) |
| **JWT 인증** | `JWT_SECRET` 환경변수로 토큰 서명. | **프로덕션에선 강한 시크릿을 반드시 설정** |

> **한 줄 요약:** "상시 켜져 있는 Node 서버 + 영속 디스크 + HTTPS(wss)"를 제공하는 호스트가 필요합니다.
> 후보: **VPS(직접 구성)**, **Render / Railway / Fly.io(PaaS)**, **자체 Docker 호스트**. 서버리스(Vercel/Netlify Functions)는 이 앱엔 맞지 않습니다.

---

## 1. 배포 전 공통 준비

### 1-1. 프로덕션 환경변수
`server/.env`(또는 호스트의 환경변수 설정)에 아래를 지정합니다. **`JWT_SECRET`과 관리자 비밀번호는 반드시 바꾸세요.**
```env
PORT=4000                         # 호스트가 PORT를 주입하면 그 값을 자동 사용(코드가 process.env.PORT를 읽음)
JWT_SECRET=<길고-무작위한-시크릿>   # 예: openssl rand -hex 32 결과
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<강한-비밀번호>
DB_PATH=data/casino.db            # 영속 디스크 경로로 지정(아래 참고)
```
- 시크릿 생성: `openssl rand -hex 32`
- `DB_PATH`는 **영속 볼륨 안**을 가리켜야 합니다(예: `/data/casino.db`). 재배포·재시작에도 살아남는 경로.

### 1-2. 빌드 확인(로컬)
```bash
npm run build     # client/dist 생성
npm start         # http://localhost:4000 에서 API+정적+소켓이 한 프로세스로 뜨는지 확인
npm test          # 서버 테스트 통과 확인
```
프로덕션에선 `npm run build` → `npm start` 흐름을 그대로 씁니다.

### 1-3. 최초 관리자
서버 최초 기동 시 `ADMIN_USERNAME/ADMIN_PASSWORD`로 관리자 계정이 자동 생성됩니다. 배포 후 **즉시 로그인해 비밀번호를 안전하게** 관리하세요.

---

## 2. 방법 A — PaaS (가장 쉬움: Render / Railway / Fly.io)

상시 Node + 영속 디스크를 클릭 몇 번으로 제공합니다. **Render** 기준 예시:

1. GitHub 저장소(`fdrn9999/web-casino`)를 연결해 새 **Web Service** 생성.
2. 빌드/시작 명령:
   - **Build Command:** `npm install && npm --prefix server install && npm --prefix client install && npm run build`
   - **Start Command:** `npm start`
   - (better-sqlite3가 서버에서 빌드되므로 `npm install`이 반드시 배포 시 실행돼야 함)
3. **환경변수**: 위 1-1의 값 등록(`JWT_SECRET`, `ADMIN_PASSWORD` 등). `PORT`는 플랫폼이 주입하므로 코드가 자동 사용.
4. **영속 디스크 추가**: 예를 들어 마운트 경로 `/data` 디스크를 붙이고 `DB_PATH=/data/casino.db`로 지정. (디스크 없이 배포하면 재배포마다 DB가 초기화됩니다.)
5. 배포하면 플랫폼이 HTTPS 도메인을 발급 → WebSocket도 자동으로 `wss://`로 동작(같은 오리진).

> Railway/Fly.io도 개념은 동일합니다: 빌드 시 `npm install`(네이티브 빌드) + `npm run build`, 시작 `npm start`, **볼륨을 붙여 `DB_PATH`를 그 안으로**, `JWT_SECRET` 설정.

---

## 3. 방법 B — VPS 직접 구성 (DigitalOcean / Linode / EC2 등)

가장 통제력이 크고 저렴합니다. Ubuntu 기준 예시.

### 3-1. 서버 준비
```bash
# Node 20+ 설치 (nvm 권장)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20

# 코드 가져오기
git clone https://github.com/fdrn9999/web-casino.git
cd web-casino
npm install && npm --prefix server install && npm --prefix client install   # better-sqlite3가 여기서 컴파일됨
npm run build
```

### 3-2. 환경변수 + 영속 DB
```bash
# 영속 경로 마련 (예: 홈 하위 data 디렉터리)
mkdir -p /var/lib/vegas
cat > server/.env <<'EOF'
PORT=4000
JWT_SECRET=<openssl rand -hex 32 결과>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<강한 비밀번호>
DB_PATH=/var/lib/vegas/casino.db
EOF
```

### 3-3. 프로세스 상시 구동 (PM2 또는 systemd)
```bash
# PM2 방식
npm i -g pm2
pm2 start "npm start" --name vegas
pm2 save && pm2 startup     # 재부팅 시 자동 시작
```
또는 systemd 유닛(`/etc/systemd/system/vegas.service`)으로 `WorkingDirectory=/path/web-casino`, `ExecStart=/path/node ...` 지정.

### 3-4. HTTPS 리버스 프록시 (Caddy = 가장 간단, 자동 TLS)
```
# /etc/caddy/Caddyfile
your-domain.com {
    reverse_proxy localhost:4000
}
```
Caddy는 자동으로 Let's Encrypt 인증서를 발급하고 **WebSocket 업그레이드도 그대로 통과**시킵니다. (Nginx를 쓴다면 `proxy_set_header Upgrade`/`Connection "upgrade"`를 반드시 추가해야 소켓이 동작합니다.)

이후 접속: `https://your-domain.com` — 클라·API·소켓이 모두 이 도메인 한 곳에서 서빙됩니다.

---

## 4. 방법 C — Docker (이식성 최고)

`Dockerfile`을 리포 루트에 추가하면 어떤 컨테이너 호스트에도 올릴 수 있습니다.

```dockerfile
# Dockerfile (예시 — 리포에 없으면 추가)
FROM node:20-bookworm-slim
WORKDIR /app
# 네이티브 빌드 도구(better-sqlite3용)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm install && npm --prefix server install && npm --prefix client install
COPY . .
RUN npm run build
ENV PORT=4000
ENV DB_PATH=/data/casino.db
VOLUME /data
EXPOSE 4000
CMD ["npm", "start"]
```
```bash
docker build -t vegas .
docker run -d -p 4000:4000 -v vegas-data:/data \
  -e JWT_SECRET=$(openssl rand -hex 32) -e ADMIN_PASSWORD='강한비번' \
  --name vegas vegas
```
`-v vegas-data:/data`로 **DB를 볼륨에 영속화**하는 것이 핵심입니다. 앞단에 Caddy/Traefik으로 HTTPS를 붙입니다.

---

## 5. 프로덕션 체크리스트 ✅

- [ ] `JWT_SECRET`을 강한 무작위 값으로 설정(기본값 절대 사용 금지)
- [ ] 관리자 비밀번호를 강한 값으로 변경(`ADMIN_PASSWORD`), 배포 후 로그인 확인
- [ ] `DB_PATH`가 **영속 디스크/볼륨** 안을 가리키는지(재배포·재시작 후 데이터 유지 확인)
- [ ] HTTPS 적용 → 소켓이 `wss://`로 붙는지 확인(브라우저 개발자도구 Network → WS 101)
- [ ] 배포 서버에서 `npm install` 실행되어 **better-sqlite3가 그 OS에 맞게 빌드**됐는지(로컬 node_modules 업로드 금지)
- [ ] `npm run build` 후 `npm start`로 정적+API+소켓이 한 오리진에서 뜨는지 확인
- [ ] DB 파일 정기 **백업**(SQLite는 파일 복사로 백업 가능; WAL 사용 중이므로 `.backup` 권장)
- [ ] 로그 수집(PM2 logs / 플랫폼 로그)과 프로세스 자동 재시작 설정
- [ ] (선택) 도메인·방화벽·rate limit·모니터링

---

## 6. 데이터베이스: 지금 그대로 vs 나중에 이전

- **지금(SQLite):** 단일 인스턴스 + 영속 디스크면 충분합니다. 이 앱은 동기 better-sqlite3를 단일 프로세스에서 쓰도록 설계됐습니다.
- **트래픽이 커지거나 여러 인스턴스로 확장할 때:** SQLite는 단일 노드 전제이므로, PostgreSQL 등으로 이전을 고려하세요.
  이전 시 `server/src/db`와 각 서비스/라우터의 쿼리를 PG 드라이버로 교체하고, `applyTransaction`의 트랜잭션 경계를 유지하면 됩니다(잔액 단일 경로 구조라 교체 지점이 명확).

---

## 7. 스케일 아웃(다중 인스턴스) 시 주의

이 앱은 **단일 인스턴스**를 전제로 만들어졌습니다. 인스턴스를 여러 개로 늘리려면 세 가지가 필요합니다.
1. **공유 DB** — SQLite 대신 PostgreSQL 등(6번 참고). 게임 러너의 라운드 상태도 인스턴스 간 공유/조정 필요.
2. **Socket.IO 어댑터** — Redis 어댑터로 인스턴스 간 브로드캐스트 공유(`jackpot:won`, `notice:new`, `table:state` 등).
3. **스티키 세션** — 로드밸런서에서 WebSocket이 같은 인스턴스로 붙도록.

> 연습/데모·소규모 운영이라면 **단일 인스턴스로 충분**하며 위 작업은 필요 없습니다.

---

## 8. (선택) GitHub Actions 자동 배포

`main`에 푸시하면 자동 빌드·배포되도록 CI를 붙일 수 있습니다. 최소 형태:
```yaml
# .github/workflows/deploy.yml (예시 골격)
name: deploy
on: { push: { branches: [main] } }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install && npm --prefix server install && npm --prefix client install
      - run: npm test
      - run: npm run build
      # 이후: 배포 대상에 맞는 배포 스텝(Render deploy hook / SSH rsync + pm2 reload / docker push 등)
```
대부분의 PaaS(Render/Railway)는 저장소 연결만 하면 **푸시 시 자동 배포**를 제공하므로 별도 워크플로 없이도 됩니다.

---

## 요약 추천

- **가장 빠르게:** Render/Railway에 저장소 연결 → 빌드 `npm install ... && npm run build`, 시작 `npm start`, **볼륨 붙여 `DB_PATH` 지정**, `JWT_SECRET` 설정. 끝.
- **직접 서버:** VPS + PM2 + Caddy(자동 HTTPS·WebSocket 통과) + 영속 `DB_PATH`.
- **어디서든:** Docker 이미지 + 볼륨.

세 방법 모두 공통 핵심은 **① 상시 Node 프로세스, ② 영속 디스크의 SQLite, ③ HTTPS(wss), ④ 강한 JWT_SECRET/관리자 비번** 입니다.
