---
type: spec
project: mission-control
date: 2026-09-15
status: code-complete-owner-gated
author: claude
intent: spec
round: 5
genealogy: "v0.1 → L2(codex∥gemini, canonical 11 / settled 8 / escalate 0) → v0.2 → 구현 실측 4건 정정 → v0.3 → L2 r3(blocker1/imp5/sug4, 코드수정 2건) → v0.4 → L2 r4(blocker0/imp4, 코드수정 1건) → v0.5 동결"
artifact_ref: "docs/multiagent/specs/2026-09-15-mc-registration-transport-spec.md"
refs:
  - "[[2026-09-14-windows-scaffold-parity-spec]]"
  - "[[sqlite-db-swap-stop-service-first]]"
  - "[[mc-service-runtime-port]]"
---

# 신규 프로젝트 MC 등록 transport — Windows 경로 복구 (spec v0.5 · 동결 · 코드 완결 · 대표님 게이트 대기)

> **v0.2 = L2 반영본.** codex∥gemini 2라운드, **심화 8건 전부 수렴·에스컬레이션 0**.
> blocker 2건 중 하나(도달성 미실측)는 **실측으로 해소**했고, 다른 하나(엔드포인트 불일치)는 내 서술 누락이었다(§6).

## 0. 문제 — 실측

2026-09-14 스캐폴딩 정합화(R1~R5) 직후 ModuCare 부트스트랩에서 관측:

```
agent kit seeded: 6 agents -> D:\Projects\Ai-Insight\ModuCare/.claude/agents
MC DB 없음 — skip        ← register-mc-project.js
MC DB 없음 — skip        ← register-mc-agents.js
```

원인은 한 줄이다.

```js
const DB = HOME + "/mission-control/.data/mission-control.db";
if (!fs.existsSync(DB)) { console.log("MC DB 없음 — skip"); process.exit(0); }
```

**Windows `$HOME` 은 `C:\Users\Design`** 이고 mission-control 은 **WSL 에만** 있다
(`/home/bestconsulting/mission-control`). 그러므로 Windows 에서는 **영구히 skip** 된다.

R3/R4 가 헬퍼를 Windows 에 배포했지만, **헬퍼가 보는 DB 경로 자체가 WSL 전용 가정**이었다 —
스캐폴딩 정합화가 한 겹 벗겨내자 그 아래 있던 두 번째 env 가정이 드러난 것이다.

### 영향 — 조건부이지만 실재

ModuCare 는 **살았다**. 두 가지 우연 덕분이다.
1. 프로젝트 `#7` 이 **2026-08-29 P2 멀티프로젝트 편입 때 이미 등록**돼 있었다
2. 에이전트 6종은 **MC 스케줄러 `project_agent_sync`**(`src/lib/local-agent-sync.ts`)가
   `.claude/agents/*.md` 를 스캔해 09-14 08:44:50 에 채웠다

그러나 **MC 에 없는 진짜 신규 Windows 프로젝트**라면 프로젝트 등록이 실패하고, 스케줄러는
에이전트를 귀속시킬 프로젝트를 못 찾는다 → **프로젝트·에이전트 둘 다 누락**된다.
스케줄러는 에이전트를 채울 뿐 **프로젝트를 만들지 않는다.**

## 1. 선택지 비교

### A안 — MC REST API 폴백 (**권고**)

DB 파일이 없으면 HTTP 로 등록한다. MC 는 이미 필요한 것을 전부 갖고 있다.

- 엔드포인트(openapi.json 실측 전량): `/api/projects` **[get, post]** · `/api/projects/{id}` **[get, patch, delete]** ·
  `/api/agents` [get, post, put] · `/api/agents/register` [post]
  → 멱등에 필요한 `GET`·`PATCH` 가 **모두 존재한다**. v0.1 이 POST 만 적어 §2.2 와 충돌하는 것처럼 보였다(L2 `f479b881`).
- 인증: `x-api-key` 헤더 (또는 세션 쿠키)
- 설정 규약: **기존 것을 재사용** — `~/.mission-control/profiles/default.json`(`url`/`apiKey`/`cookie`) +
  env `MC_URL`/`MC_API_KEY`/`MC_COOKIE` 우선. `scripts/mc-mcp-server.cjs:24-34` 가 쓰는 바로 그 규약이다.
  **새 규약을 만들지 않는다.**
- 도달성: MC 는 `0.0.0.0:3005` 리슨(실측) → WSL2 localhost 포워딩으로 Windows 에서 접근 가능.
  ✅ **실측 완료(2026-09-15)**: Windows PowerShell 에서 `http://127.0.0.1:3005/health` → **STATUS=200**,
  `{"status":"ok","db":"ok"}`. A안의 전제가 성립한다(L2 `afb46411` 해소).

### B안 — Windows 에서 WSL DB 파일 직접 접근 — **기각**

`\\wsl.localhost\Ubuntu\...\mission-control.db` 를 열게 하는 방법. **기각한다.**
SQLite 는 네트워크 파일시스템에서 락이 신뢰되지 않고, 구동 중인 DB 를 외부에서 여는 것은
이미 손상 이력이 있는 패턴이다([[sqlite-db-swap-stop-service-first]] — stale-WAL 재생으로 `SQLITE_CORRUPT`).
등록 편의를 위해 운영 DB 를 위험에 놓을 이유가 없다.

### C안 — 스케줄러가 프로젝트까지 생성 — **보류**

`project_agent_sync` 를 확장해 미등록 프로젝트를 자동 생성. 그러려면 스케줄러가 **스캔할 프로젝트 루트
목록**을 알아야 하는데, 그 목록 자체가 새 설정 SSOT 가 된다(관리 비용 + 오등록 위험).
A안이 실패할 때 재검토한다.

## 2. 설계 (A안)

### 2.1 공통 transport 모듈 `mc-register-transport.js` (신규)

두 헬퍼가 같은 해석 로직을 필요로 하므로 한 곳에 둔다.

```
resolveTransport() →
  1) DB 파일 존재      → { mode:'db',  dbPath }
  2) env/프로필로 URL+키 해결 가능 → { mode:'api', baseUrl, headers }
  3) 둘 다 불가        → { mode:'none' }
```

- 기본 baseUrl 은 **`http://127.0.0.1:3005`** — 상시 systemd 서비스 포트다([[mc-service-runtime-port]]:
  dev 만 3000). `mc-mcp-server.cjs` 의 기본값 3000 을 그대로 복사하면 **평시에 연결 실패**한다.
  env·프로필이 있으면 그것이 우선이다.
- `mode:'none'` 이면 **신호 1줄(`<<AI_BOOTSTRAP_MC_UNCONFIGURED …>>`) + skip + exit 0**(v0.4, L2 f660bdf7).
  부트스트랩을 절대 막지 않는다(보조 기능) — 그러나 **조용히 넘기지도 않는다**.

### 2.2 경로 정규화 — 중복 등록 방지 (L2 `8465ee9e`)

같은 프로젝트가 환경에 따라 다른 경로 표현으로 **두 번 등록되는 것**이 실제 위험이다.
Windows 는 `D:\\Projects\\Ai-Insight\\ModuCare`, WSL 은 `/mnt/d/Projects/Ai-Insight/ModuCare` 로 같은 폴더를 부른다.

**기존 레코드가 WSL 형식이 정본이다**(실측: BC·SF·ModuCare 전부 `/mnt/d/...`). 따라서 등록 전에
**항상 WSL 형식으로 정규화**한다: `^([A-Za-z]):[\\\\/]` → `/mnt/<소문자>/`, 백슬래시는 슬래시로, 말미 슬래시 제거.
매칭 키는 **name/slug 우선, local_path 는 보조 확인용**으로 쓴다(경로가 달라도 같은 프로젝트일 수 있다).

### 2.3 실패모드 — 조용히 죽지 않는다 (L2 `20f6c9a9`·`678ce866`)

| 상황 | 처리 |
|---|---|
| connection refused / timeout(5s) | skip. MC 정지 = 정상 상황 |
| 401 / 403 | skip **+ 경고 신호** — 키가 틀렸다는 뜻이라 조용히 넘기면 영영 모른다 |
| 409 conflict | 이미 존재로 간주, 성공 처리(경합 정상 종료) |
| 5xx | 읽기는 곧바로 1회 재시도 · **쓰기는 멱등 read 로 반영 확인 후에만** 1회 재시도(§13 `b3a8a860`), 그래도 실패면 skip + 경고 |

**모든 skip 은 `exit 0`** 이다(부트스트랩 차단 금지). 다만 **조용한 실패는 금지**한다 —
2026-09-14 R1 에서 위키 누락에 적용한 것과 같은 규율을 여기에도 쓴다:
`<<AI_BOOTSTRAP_MC_REGISTER_FAILED project=.. reason=..>>` 를 stdout 으로 내보내고 마커에 `mc=failed` 를 남긴다.
(v0.1 은 R1 에서 배운 것을 여기 적용하지 않았다 — L2 가 그 불일치를 짚었다.)

### 2.4 키 관리 (L2 `85da72d7`·`45186b03`)

- **발급 주체 = 대표님.** 에이전트가 키를 만들지 않는다.
- **권한 범위**: 프로젝트 등록 `operator` / **즉시 에이전트 sync 는 `admin`**(§8.2 — admin 없으면 ≤60s 스케줄러가 대신 채운다). 가능하면 전용 키를 별도 발급해
  유출 시 그 키만 폐기한다(Cloudflare 토큰 정책과 같은 원칙 — 프로젝트별 분리).
- **파일 권한**: WSL `chmod 600` / **Windows 는 `icacls` ACL**(§11.1 — `0600` 은 Windows 에서 의미 없다). 매니페스트 `local`(동기 제외).
- **폐기**: 키 교체 시 프로필만 갈아끼우면 되고 코드 변경은 없다.
- **생성 절차를 spec 에 남긴다** — 실측상 **양 환경 모두 프로필 부재**라 이 절차가 없으면 운영자가 막힌다.

### 2.5 멱등

DB 경로의 기존 동작(SELECT → 없으면 INSERT, 있으면 UPDATE)과 **같은 결과**여야 한다.
API 경로도 `GET /api/projects` 로 동일 name/slug 를 먼저 조회하고, 있으면 `PATCH /api/projects/{id}`,
없을 때만 `POST`. 에이전트는 `source` + `name` 이 기존 멱등키이므로 그대로 쓴다.

⚠️ **GET→POST 는 원자적이지 않다**(L2 `e05c68c7`). 동시 스캐폴딩이 겹치면 중복이 날 수 있다.
완전한 해결은 서버측 unique constraint 이나 그것은 MC 스키마 변경이라 별건이다. 본 spec 범위에서는
**409 를 성공으로 처리**하고(단 §8.4 의 조건부), 등록 직후 **GET 으로 재확인해 중복이 보이면 경고 신호**를 낸다.
⇒ 따라서 **동시 스캐폴딩 하에서 멱등은 보장되지 않는다 — 탐지 + 수동 복구(§11.2)** 다. 과장하지 않는다.
다만 실사용 경로에서는 `init-project.sh` 의 `mkdir` 원자 락이 **같은 프로젝트의 동시 스캐폴딩을 직렬화**하고,
다른 프로젝트끼리는 slug 가 달라 경합이 성립하지 않는다.

### 2.6 비밀 취급

API 키가 Windows 에 놓인다. **매니페스트 `local`(동기 제외)** 로 분류한다 — 공유 대상이 아니다.
키 값은 로그·커밋·채팅에 출력하지 않는다(전역 DENY 규약).

## 3. 검증 계획

1. ✅ **도달성 실측 — 완료(2026-09-15)**. Windows PowerShell → `http://127.0.0.1:3005/health` **STATUS=200**,
   `{"status":"ok","db":"ok"}`. WSL2 localhost 포워딩이 실제로 동작한다. **A안 전제 성립.**
2. **선결: API 키 발급 + 프로필 생성** — 실측상 **양 환경 모두 프로필 부재**
   (`~/.mission-control/profiles/default.json` 없음). 키 발급 경로를 확인하고 Windows 에 프로필을 둔다.
3. **신규 프로젝트 E2E** — 샌드박스 git repo 로 Windows 스캐폴딩 → 프로젝트·에이전트가 MC 에 등록되는지.
   ⚠️ 실 DB 에 테스트 레코드가 남는다. **정리 기준을 미리 고정한다**(L2 `edd6325a`·`1721fa46`):
   프로젝트명을 `zz-e2e-<epoch>` 로 고정하고, 정리는 **그 정확한 name 과 그때 받은 id 로만** 한다
   (prefix glob 금지 — 2026-08-30 형제 디렉토리 오삭제와 같은 사고를 막는다). 정리 후 목록 육안 확인.
4. **멱등 회귀** — 같은 프로젝트로 2회 실행 → 중복 생성 0.
5. **WSL 무회귀** — WSL 경로는 `mode:'db'` 로 기존 동작 그대로. ModuCare/기존 프로젝트 레코드 무변경 대조.
6. **실패 안전** — MC 정지 상태에서 스캐폴딩 → skip, `exit 0`, 부트스트랩 나머지 정상 완료.
7. **경로 정규화 회귀** — Windows 경로로 등록 시도 → 기존 `/mnt/d/...` 레코드와 **중복 생성 0**.
8. **키 오류 가시성** — 틀린 키로 시도 → 401 경고 신호 + 마커 `mc=failed`, `exit 0`.

## 4. 롤백

신규 파일 1개 + 헬퍼 2개의 분기 추가. 헬퍼를 이전 커밋 상태로 되돌리면 끝(현재 동작 = 조용한 skip 이므로
롤백해도 **지금보다 나빠지지 않는다**).

## 5. 등급 (→ §9 에서 실측 완료)

`mc-register-transport.js` 는 신규 파일이나, 2026-09-14 R5 로 **부트스트랩 실행층이 T3**
(`gate-self-bootstrap`)가 됐다. 헬퍼 2종은 이미 T3 이고, 신규 모듈을 같은 glob 에 넣을지가 결정 지점이다.
**넣는 것을 권고** — 안 넣으면 T3 헬퍼가 T1 모듈을 실행하는 구조가 되어 R5 가 막은 우회 경로가 되살아난다.
그 경우 glob 확장(= `decision-policy.json` 편집) 이 동반되므로 **대표 `!` 1건**이 필요하다.

## 6. L2 반영 (codex ∥ gemini, 2R, settled 8 / escalate 0)

| id | 지적 | 반영 |
|---|---|---|
| `afb46411` **blocker** | A안 도달성 미실측 | **실측 수행 → STATUS=200.** 내가 "먼저 멈춘다"고 써놓고 안 했던 것을 L2 가 잡았다 |
| `f479b881` **blocker** | 멱등 설계가 실측 엔드포인트와 충돌 | **내 서술 누락**이었다 — openapi 에 GET·PATCH 가 실재한다. §1 에 전량 명시 |
| `8465ee9e` | Windows/WSL 경로 중복 등록 | §2.2 정규화 규칙 신설(WSL 형식이 정본) |
| `20f6c9a9`·`678ce866` | 실패모드 미설계 · 조용한 실패 | §2.3 신설. **R1 에서 배운 "조용한 실패 금지"를 여기 적용하지 않은 불일치**를 짚혔다 |
| `e05c68c7` | GET→POST 비원자적 | §2.5 — 409 성공 처리 + 사후 GET 재확인(탐지로 대체, 스키마 변경은 별건) |
| `85da72d7`·`45186b03` | 키 발급·권한·폐기 절차 부재 | §2.4 신설(발급 주체=대표, 최소권한, 0600, local 분류) |
| `edd6325a`·`1721fa46` | E2E 정리 기준 미정의 | §3-3 — `zz-e2e-<epoch>` 고정 + 정확매칭 삭제 |
| `e81a3128` | T3 승인 부담 | §5 에 근거 기재 — 안 넣으면 R5 우회 경로가 되살아난다. **부담을 수용한다** |

## 7. 범위 밖

- 스케줄러 `project_agent_sync` 확장(C안)
- `maia-deploy` 의 mode 미비교([[copy-sync-must-compare-mode-not-just-hash]])
- Open-Design `.claude/agents` 0개 — 마커 보유라 별건

---

## 8. v0.3 — 구현 실측이 설계를 4곳 정정했다 (2026-09-15)

구현에 들어가자 v0.2 가 **엔드포인트 목록까지만 실측하고 필드·계약을 안 본 것**이 드러났다.
네 건 모두 "코드를 읽기 전에는 몰랐을 것"이 아니라 **한 겹 더 열어보면 보이는 것**이었다.

### 8.1 ★ blocker — REST API 에 `local_path` 가 없었다 (MC 확장 필요)

v0.2 는 L2 `f479b881` 에 답하며 "멱등에 필요한 GET·PATCH 가 **모두 존재한다**"고 닫았다.
그 문장은 **메서드 단위로는 참이고 필드 단위로는 거짓**이었다. 실측:

| 지점 | v0.2 이전 상태 |
|---|---|
| `GET /api/projects` SELECT 목록 | `local_path` **없음** |
| `POST /api/projects` INSERT | `local_path` **없음**(body 파싱조차 안 함) |
| `PATCH /api/projects/{id}` | `local_path` **없음** |

그런데 repo-less 프로젝트의 **에이전트 귀속 키가 바로 그 컬럼**이다
(`src/lib/local-agent-sync.ts:370-383` — `github_repo` 없으면 `source=claude-project-id:{id}`,
`dir=<local_path>/.claude/agents`). GitHub remote 없는 신규 프로젝트(ModuCare 도 remote 미설정)에서
API 로 등록하면 **프로젝트만 생기고 에이전트는 영구 미귀속** — 고치려던 증상의 절반이 그대로 남는다.

**조치**: MC src 확장(가산적, 3지점). `POST`/`PATCH` 가 `local_path`(camelCase `localPath` 허용)를 받고,
`GET` 목록·단건이 되돌려준다. `PATCH local_path: null` 은 비운다(가역).
시험 `src/lib/__tests__/b1-projects-local-path-route.test.ts` **5/5** — 마지막 케이스가
**API 로 등록한 프로젝트의 에이전트가 `syncProjectAgents` 로 실제 귀속되는 것까지** 사슬 끝까지 증명한다.

> 교훈: **"엔드포인트가 있다"는 계약 충족이 아니다.** 필요한 필드를 그 엔드포인트가 읽고 쓰는지까지 봐야 한다.
> v0.2 의 자신감("내 서술 누락이었다")이 바로 그 지점에서 검증을 멈추게 했다.

### 8.2 에이전트 등록은 HTTP 로 재현하지 않는다 — 서버 sync 를 발동한다

v0.2 는 에이전트도 `source`+`name` 멱등키로 "그대로 쓴다"고만 적었다. 실측하니 쓸 수 있는 엔드포인트가 없다:

- `POST /api/agents/register` — 멱등키가 `(name, workspace_id)`이고 `source`·`content_hash`·
  `workspace_path`·`config` 를 **받지 않는다**. 이걸로 등록하면 스케줄러 계약과 **다른 모양의 row** 가 생겨
  C4B-2 가 맞춰둔 "즉시↔주기 upsert 수렴"이 깨진다.
- `POST /api/agents` — operator 권한이나 openclaw 워크스페이스 경로 계약이 섞여 있어 목적과 다르다.

**대신 `POST /api/agents/sync?source=projects`**(`src/app/api/agents/sync/route.ts`)를 발동한다.
서버가 자기 `syncProjectAgents()` 를 돌리므로 **스케줄러와 같은 함수**다 — 수렴이 계약 미러링이 아니라
**구조로** 보장된다. 서버가 `<local_path>/.claude/agents` 를 읽기 때문에 §2.2 경로 정규화는
중복 방지용이 아니라 **기능 요건**이 된다(WSL 서버가 `D:\...` 를 열 수 없다).

- 권한: 이 엔드포인트는 **admin**. 전역 API 키는 admin 으로 승격되지만(`src/lib/auth.ts:492`),
  agent-scoped 키는 scope 에서 role 을 유도하므로 **`admin` scope 가 없으면 403**이다.
  403 은 조용히 넘기지 않고 경고 신호를 낸다(`reason=sync-auth-403`).

### 8.3 경로 정규화에 Git Bash/MSYS 형태를 추가

`init-project.sh` 실측 로그의 `PROJECT_ROOT` 는 `D:\Projects\Ai-Insight\ModuCare` 였으나,
Windows 측 호출은 Git Bash 경유라 `/d/Projects/...` 형태도 나올 수 있다. 그 형태를 변환하지 않으면
**local_path 가 서버에서 열리지 않는 경로로 저장되고, 아무 오류 없이 에이전트만 안 붙는다**(조용한 실패).

`^/([A-Za-z])/` → `/mnt/<소문자>/` 를 추가하되 **`process.platform === 'win32'` 에서만** 적용한다 —
리눅스의 실제 `/d` 디렉토리를 오변환하지 않기 위해서다. 대조군 시험으로 고정(`linux` 에서는 불변).

### 8.4 409 를 무조건 성공으로 처리하면 안 된다

v0.2 §2.3 은 `409 conflict → 이미 존재로 간주, 성공 처리`였다. 실측하니 서버의 409 는
**slug 또는 ticket_prefix** 충돌이다(`src/app/api/projects/route.ts` — `WHERE slug = ? OR ticket_prefix = ?`).
`ticket_prefix` 는 이니셜 약자라 충돌이 흔하다(`ModuCare`→`M`, `Moducare-B`→`MB`… 한 글자짜리는 특히).
**다른 프로젝트의 prefix 와 부딪힌 409 를 성공으로 처리하면 등록이 안 된 채 조용히 넘어간다.**

수정: 409 뒤에 **GET 으로 내 slug/name 이 실제로 있는지 확인**한다. 있으면 경합 정상 종료(무경고),
없으면 `reason=conflict-prefix` 경고. ※ DB 경로는 prefix 충돌을 검사하지 않으므로 이 지점은
두 transport 의 **의도된 거동 차이**다(API 가 더 엄격) — spec 에 명시해 다음 세션이 버그로 오인하지 않게 한다.

## 9. 구현 산출물 · 검증 실측 (2026-09-15)

### MC repo (자율 — src/docs/test)
- `src/app/api/projects/route.ts` · `src/app/api/projects/[id]/route.ts` — `local_path` 지원(가산적)
- `src/lib/__tests__/b1-projects-local-path-route.test.ts` — **5/5**
- `openapi.json` — `Project` 스키마 + create/update 본문에 `local_path`

### ai-bootstrap (T3 — 대표님 `!` 대기)
`~/p1c/candidates/b1-mc-transport/`
- `mc-register-transport.js` — transport 해석 + 등록/정규화/실패모드 (의존성 0, node 내장만)
- `mc-register-transport.test.js` — **24/24** (스텁 서버, 라이브 MC·실자격증명 불사용)
- `e2e-helpers.js` — 패치된 헬퍼를 실제 실행, **10/10** (api·db·none 3모드)
- `apply-b1.js` — `--check` / `--apply` / `--rollback`. 적용 시 구문검사→시험→E2E→등급→게이트회귀→
  `maia-deploy`→**양 환경 재봉인**까지 한 번에. 백업은 staging 에.

### 검증 실측

| 항목 | 결과 |
|---|---|
| MC API 시험 | **5/5** (POST 저장·GET 노출·PATCH 보강·null 비움·**syncProjectAgents 귀속**) |
| transport 단위 | **24/24** |
| 헬퍼 E2E (api/db/none) | **10/10** — api 는 스텁서버, db 는 라이브 DB 의 `VACUUM INTO` 스냅샷 |
| 라이브 DB 오염 | **0** (`ZzB1%` 프로젝트 0 · `zz-b1-agent` 0 — 사후 실측) |
| 등급 | `mc-register-transport.js`·헬퍼 2종 **T3** / 대조군 `maia-deploy.js`·`c6-trust.js` **T1** |
| 게이트 회귀 | risk-classify **241/241** · gate-destructive **127/127** · ledger **25/25** |
| typecheck | **exit 0** |
| 샌드박스 apply | `.ai-bootstrap` 전량 복제본에 `--apply` 완주(배포·봉인은 자동 생략) |

⚠️ **하네스 함정 1건**(제품 결함 아님): api 모드 E2E 를 `execFileSync` 로 돌리면 부모 이벤트루프가 막혀
같은 프로세스의 스텁 서버가 accept 를 못 하고 자식이 timeout→`offline` 로 끝난다. 처음 4건 실패가 이것이었다.
**비동기 `execFile` 로 교체**하니 전건 통과. "실패를 제품 탓으로 돌리기 전에 하네스를 의심한다."

### 남은 선결 (대표님)

1. **`!node ~/p1c/candidates/b1-mc-transport/apply-b1.js --check` → `--apply`** (T3 4파일)
2. **API 키 발급 + Windows 프로필 배치** — `%USERPROFILE%\.mission-control\profiles\default.json`
   `{ "url": "http://127.0.0.1:3005", "apiKey": "<발급값>" }` · 권한 0600 · 매니페스트 `local`(동기 제외)
   - 키가 없으면 `mode:'none'` — **`mc=unconfigured` 신호 1줄을 내고** skip 되며 부트스트랩은 정상 진행된다(오늘보다 나빠지지 않음)
   - 에이전트 sync 는 **admin** 권한이 필요하다(§8.2) — agent-scoped 키를 쓸 경우 `admin` scope 필요
3. 키 배치 후 **실 Windows 신규 프로젝트 1건 E2E**(`zz-e2e-<epoch>` 명명, 정확매칭 정리)

### 부수 발견 (별건)

- ⚠️ **`PATCH /api/projects/{id}` 는 기본 프로젝트(`slug='general'`)에서 항상 500** — 선재 결함.
  `src/app/api/projects/[id]/route.ts:115` 가 `general` 분기에서 body 를 한 번 읽고 `:121` 이 또 읽는다.
  Request body 는 1회 소비라 두 번째 읽기가 `TypeError: Body is unusable` 를 던지고 catch 가 500 으로 바꾼다
  (실측: `new Request(...).json()` 2회 호출 → 같은 TypeError). 본 변경과 무관하며(같은 함수에 필드만 추가)
  B1 경로는 General 을 PATCH 하지 않는다. 수정은 body 를 위에서 한 번 읽어 재사용하면 되는 3줄 — 별건으로 둔다.
- `pnpm api:parity` 가 **사전에 이미 실패** — OpenAPI 미등재 5건
  (`GET/POST /api/decision-proposals` · `GET /api/l2-reviews` · `GET /api/l2-reviews/{id}` · `PATCH /api/agents/{id}`).
  MAIA 가 추가한 라우트들이고 ignore 목록에도 없다. 본 변경과 무관(라우트 추가 0)이며
  `api-contract-parity.test.ts` 5/5 는 통과한다. 스펙 보강은 별건.

---

## 10. v0.4 — L2 round 3 반영 (codex ∥ gemini, blocker 1 / important 5 / suggest 4)

집계 [[2026-09-15-mc-registration-transport-spec-l2-aggregation-20260915-085749]] · `evidenceEligible=false`(폴백 transport 포함 → 자동신뢰 부적격, 검토 자체는 수행됨).
**코드가 바뀐 반영 2건**(`f660bdf7`·`80653856`)이 있다 — 문서만 고친 게 아니다.

| id | 지적 | 반영 |
|---|---|---|
| `6c73022c` **blocker** | `status: implemented` 인데 실 Windows E2E·키 배치가 선결로 남아 구현완료 판정이 성립 안 됨 | **정당하다.** frontmatter `status: code-complete-owner-gated` 로 정정. 코드트랙은 닫혔고 **라이브 승인·키가 대표님 게이트**임을 상태값 자체로 표시 |
| `f660bdf7` **important** | `mode:'none'` 의 조용한 skip 이 **원래 결함(신규 Windows 프로젝트 미등록)을 무신호로 재현**한다 | **코드 수정.** `signalUnconfigured()` 신설 → `<<AI_BOOTSTRAP_MC_UNCONFIGURED project=.. hint=mission-control-profile>>`. 설정 부재는 실패가 아니지만 **보이지 않아선 안 된다**. 시험 25/25 · 스캐폴딩 E2E 로 stdout 도달 확인 |
| `80653856` **important** | 실패 시에도 `exit 0` 이라 운영자가 즉시 인지 못 하고 stdout 마커를 따로 봐야 한다 | **★진짜 결함을 짚었다.** 실측하니 `init-project.sh` 가 헬퍼를 `>> "$LOG" 2>&1` 로 부르고 있어 **마커가 로그에 삼켜져 세션에 도달조차 못 했다**(R1 의 wiki 신호는 init-project.sh 가 직접 echo 해서 살아 있었다 — 그 차이를 내가 못 봤다). 수정: 헬퍼 출력을 캡처→로그 기록→**신호 라인만 stdout 재발신**, 그리고 마커 파일에 `mc=db\|api\|unconfigured\|failed\|skip` 기록. `exit 0` 은 유지한다(부트스트랩 차단 금지가 상위 규율) |
| `62b77f6a` **important** | admin 권한 광범위 sync 를 bootstrap 키에 요구하는데 영향범위·감사·롤백 기준이 없다 | **실측으로 답한다**: `project_agent_sync` 는 `scheduler.ts` 에서 **60초 주기로 기본 활성**이다(`intervalMs: TICK_MS`). 즉 API 호출은 **1분 뒤 어차피 돌 같은 함수를 앞당기는 것**이라 추가 영향범위가 0이고, upsert 멱등이라 롤백 대상도 없다. 감사는 이미 `logAuditEvent({action:'project_agent_sync'})`. ⇒ 이 호출은 **요건이 아니라 즉시성 최적화**다. 그래서 403 은 실패가 아니라 **지연**으로 재분류(`action:'deferred'`, 신호 문구 `sync-auth-403-degraded-scheduler60s`) — admin 키가 없으면 ≤60s 뒤 스케줄러가 채운다 |
| `f127b6f3` **important** | Windows 에서 `0600` 은 적용·검증 절차가 없어 측정 불가능한 요구사항 | §11 에 **Windows ACL 절차와 검증 명령**을 명시(`icacls` 상속 제거 + 소유자 단독). WSL 은 `chmod 600`. "0600" 단독 문구는 삭제 |
| `62695dfc` **important** | GET→POST 비원자성에 탐지만 있고 복구·차단 기준이 없어 멱등 보장이 과장 | 문구를 내린다: **"동시 스캐폴딩 하에서는 멱등이 보장되지 않는다 — 탐지 + 수동 복구"**. 복구 절차를 §11 에 명시(낮은 id 유지, 중복 id 는 `DELETE /api/projects/{id}`, 이후 sync 재발동). 실사용 경로는 `init-project.sh` 의 `mkdir` 원자 락으로 **같은 프로젝트 동시 스캐폴딩이 애초에 직렬화**된다(다른 프로젝트끼리는 slug 가 달라 경합 불가) |
| `8cce52a2` suggest | §2.3 번호 중복(실패모드 / 비밀 취급) | 비밀 취급을 **§2.6** 으로 재번호 |
| `7970622a` suggest | DB·API 의 409 처리 차이가 유지보수 혼란 | §8.4 에 **의도된 차이**임을 명시해 둔 채로, "API 가 더 엄격(prefix 충돌 탐지)" 를 표로 고정. DB 경로에 prefix 검사를 넣는 것은 별건(스키마·기존 레코드 영향) |
| `5075a6dd` suggest | "최소 권한"과 admin 요구가 상충해 운영자 혼란 | §2.4 를 정정: **프로젝트 등록은 operator, 즉시 에이전트 sync 는 admin**. admin 없이도 동작하며(≤60s 지연) 그 트레이드오프를 운영자가 고르게 한다 |
| `579ceb79` suggest | OpenAPI 계약 불일치(별건)가 신뢰도 저하 | §9 부수 발견에 이미 기록. 5건 목록·ignore 미등재 사실 포함. 본 변경은 라우트 추가 0 |

## 11. 운영 절차 (대표님 실행분)

### 11.1 키 발급 · 프로필 배치

- **프로젝트 등록만** 쓰려면 `operator` 이상, **즉시 에이전트 귀속**까지 쓰려면 `admin` scope 가 필요하다.
  admin 이 부담이면 operator 로 두고 에이전트는 스케줄러(≤60s)에 맡길 수 있다 — **단 그 폴백은 `general.project_agent_sync` 가 활성일 때만 성립한다**(§13 `fad8d41e`, 현 라이브 활성). 표는 §13 말미.
- Windows: `%USERPROFILE%\.mission-control\profiles\default.json`
  ```json
  { "url": "http://127.0.0.1:3005", "apiKey": "<발급값>" }
  ```
- **권한 잠금(Windows)** — `0600` 은 의미가 없으므로 ACL 로 한다:
  ```
  icacls "%USERPROFILE%\.mission-control\profiles\default.json" /inheritance:r /grant:r "%USERNAME%:F"
  icacls "%USERPROFILE%\.mission-control\profiles\default.json"        ← 검증: 소유자 F 한 줄만 남아야 한다
  ```
  WSL 쪽에 둘 경우는 `chmod 600 ~/.mission-control/profiles/default.json`.
- 매니페스트 `local`(동기 제외) — 프로필은 환경별 비밀이라 배포 대상이 아니다. 값은 로그·커밋·채팅에 출력 금지.

### 11.2 중복 등록이 탐지됐을 때(복구)

`<<AI_BOOTSTRAP_MC_REGISTER_FAILED ... reason=duplicate-detected>>` 를 보면:
1. `GET /api/projects` 로 같은 slug 두 건의 id 확인
2. **낮은 id 를 유지**(태스크·배정이 붙어 있을 쪽), 높은 id 는 `DELETE /api/projects/{id}`
3. `POST /api/agents/sync?source=projects` 재발동 또는 60초 대기

### 11.3 상태 확인 지점

- 프로젝트 마커 `<project>/.ai-scaffold-done` → `mc=db|api|unconfigured|failed|skip`
- 스캐폴딩 로그 `~/.ai-bootstrap/last-run.log` (헬퍼 전체 출력 보존)
- 세션 컨텍스트 → `<<AI_BOOTSTRAP_MC_*>>` 신호 라인

## 12. v0.4 검증 실측 추가분

| 항목 | 결과 |
|---|---|
| transport 단위 | **25/25** (+signalUnconfigured) |
| 헬퍼 E2E (api/db/none) | **10/10** |
| **스캐폴딩 E2E** (신규) | **9/9** — 미설정→`UNCONFIGURED` stdout 도달 + `mc=unconfigured` · api→`mc=api`·sync 발동 · 401→`REGISTER_FAILED` stdout + `mc=failed`, 3케이스 모두 **스캐폴딩 완주(exit 0)** |
| 자격증명 누출 | stdout·마커·`last-run.log` 전부 **0** (사후 문자열 검사) |
| 등급 | 모듈·헬퍼 2종·`init-project.sh` **T3** / 대조군 2종 **T1** |
| 게이트 회귀 | 241/241 · 127/127 · 25/25 |
| 샌드박스 apply | `.ai-bootstrap` 복제본에 `--apply` 완주(배포·봉인 자동 생략) |

⚠️ **패치 범위가 3파일 → 4파일로 늘었다**: `init-project.sh` 가 추가됐다(이미 `gate-self-bootstrap` T3 이므로 glob 변경은 없다).

---

## 13. v0.5 — L2 round 4 반영 (blocker 0 / important 4 / suggest 2)

집계 [[2026-09-15-mc-registration-transport-spec-l2-aggregation-20260915-090331]].
**round 3 과 달리 blocker 가 0** 이고, 남은 것은 구현 불일치 1건·과장 보장 2건·확장성 의견 1건이었다.
이번에도 **코드가 바뀐 반영 1건**과 **Windows 에서 실제로 돌려본 검증 1건**이 있다.

| id | 지적 | 반영 |
|---|---|---|
| `b3a8a860` **important** | §2.3 은 "5xx 1회 재시도(멱등 read 후)"인데 구현은 첫 5xx 에서 즉시 포기 — **문서와 코드 불일치** | **정확한 지적. 코드를 문서에 맞췄다.** ①읽기(GET)는 부작용이 없으니 곧바로 1회 재시도 ②**쓰기는 5xx 후 먼저 멱등 read 로 실제 반영을 확인**하고 없을 때만 1회 재시도 — 5xx 는 쓰기 성공 후에도 나므로 무조건 재시도는 중복을 만든다 ③PATCH(고정값)·sync(upsert)는 멱등이라 곧바로 1회. 시험 5건 신설(**30/30**), 그중 `★5xx 쓰기: 실제로는 반영된 경우` 가 중복 POST 0 을 고정 |
| `fad8d41e` **important** | "admin 없으면 ≤60s 뒤 스케줄러가 채운다"는 설정으로 끌 수 있어 **과장된 보장** | **맞다. 실측해서 문구를 내렸다.** `scheduler.ts:464,470` — `general.project_agent_sync` 설정을 보고 `isSettingEnabled(key, true)` 로 판정한다. **현재 라이브는 설정행이 없어 기본값 true = 활성**(DB 실측: 해당 키 0건). 그러나 끄면 스케줄러 경로가 사라지고 **즉시 sync 가 유일 경로**가 된다 → §11.1 을 "조건부 보장"으로 정정하고 조건을 명시 |
| `2f03b9eb` **important** | `/inheritance:r /grant:r` 는 다른 **explicit ACE** 제거를 보장하지 않아 "소유자 한 줄" 검증 기준이 불충분 | **Windows 에서 실제로 돌려 재현했다.** ①갓 만든 파일의 ACE 는 전부 상속(`(I)`)이라 `/inheritance:r` 로 사라지고 결과는 정확히 한 줄(`LOTTORIA\Design:(F)`) — 우리 케이스(운영자가 새로 만드는 프로필)는 이 경로다 ②그러나 explicit ACE(`BUILTIN\Users:(R)`)를 일부러 넣고 재적용하면 **그 줄이 살아남는 것을 확인**했다 ③`/remove:g "BUILTIN\Users"` 로 제거되는 것까지 확인. → §11.1 절차에 **검증 후 잔존 줄 제거 단계**를 추가. (프로브 파일은 생성·검사 후 삭제) |
| `1a23dfb0` **important** | 단일 `default.json` 프로필 의존은 다중 환경·다중 사용자에서 확장성 제한 | **의견을 수용하되 변경하지 않는다(근거 기재).** ①env `MC_URL`/`MC_API_KEY`/`MC_COOKIE` 가 프로필을 덮으므로 호출 단위 다중 환경은 **이미 가능**하다 ②`default.json` 은 `mc-mcp-server.cjs`·`mc-cli.cjs` 가 쓰는 **MC 기존 규약**이고, v0.2 가 명시적으로 "새 규약을 만들지 않는다"를 원칙으로 세웠다 ③named profile 은 MC 전역 기능 요청이라 본 spec 범위 밖(별건) |
| `6e755f04` suggest | §2.1·§9 에 아직 "조용히 skip" 이 남아 v0.4 서술과 충돌 | 두 곳 문구 정정 — `mode:'none'` = **"신호 1줄 + skip + exit 0"** |
| `1ffa0607` suggest | 신호 4종(미설정·지연·충돌·실패)이 경고 피로를 늘린다 | 설계 근거 기재: 신호는 **프로젝트 생성 1건당 최대 1줄**이고 마커의 `mc=` 는 **단일 상태값**이라 상호배타다(누적 알림 아님). 스캐폴딩은 신규 프로젝트에서만 돌아 빈도가 극히 낮다 |

### v0.5 검증 실측 추가분

| 항목 | 결과 |
|---|---|
| transport 단위 | **30/30** (+5xx 재시도 5건) |
| 헬퍼 E2E · 스캐폴딩 E2E | **10/10** · **9/9** (재확인) |
| Windows ACL 절차 | **실측 검증** — 상속 ACE 는 제거됨 / explicit ACE 는 잔존(재현) / `/remove:g` 로 제거 |
| 스케줄러 폴백 전제 | **DB 실측** — `general.project_agent_sync` 설정행 0건 → 기본값 true(활성). 끌 수 있음도 코드로 확인 |
| 게이트 회귀 | 241/241 · 127/127 · 25/25 |

### 수렴 판정

round 3 blocker 1 → round 4 blocker 0 · important 4(전건 반영) → **설계 blocker 소진**.
남은 축은 구현 디테일·운영 의견으로 점근하고 있어([[l2-on-design-specs-asymptotes-to-impl-contracts]]) **여기서 spec 을 동결**한다.
이후 검증은 문서 리뷰가 아니라 **대표님 `!` 적용 후의 실 Windows E2E** 가 담당한다.

### 11.1 정정 — 권한 잠금 절차(실측본)

```
icacls "%USERPROFILE%\.mission-control\profiles\default.json" /inheritance:r /grant:r "%USERNAME%:F"
icacls "%USERPROFILE%\.mission-control\profiles\default.json"
        ↑ 검증: 사용자 한 줄만 남아야 한다. 다른 줄이 남았다면 그것은 explicit ACE 다:
icacls "%USERPROFILE%\.mission-control\profiles\default.json" /remove:g "<그 principal>"
        ↑ 제거 후 다시 검증
```
WSL 에 둘 경우는 `chmod 600 ~/.mission-control/profiles/default.json`.

### 11.1 정정 — 에이전트 귀속 경로(조건부)

| 키 권한 | 즉시 귀속 | 폴백 |
|---|---|---|
| `admin` | ✅ 등록 직후 sync | — |
| `operator` | ❌ (403 → `deferred` 신호) | 스케줄러 `project_agent_sync` **≤60s** — **단 `general.project_agent_sync` 가 활성일 때만**(현 라이브: 활성) |
| 그 설정이 꺼진 경우 | ❌ | **폴백 없음** — 이 경우 admin 키가 유일 경로다 |
