---
type: spec
project: mission-control
date: 2026-09-15
status: draft
author: claude
intent: spec
round: 2
genealogy: "v0.1 → L2(codex∥gemini, canonical 11 / settled 8 / escalate 0) → v0.2"
artifact_ref: "docs/multiagent/specs/2026-09-15-mc-registration-transport-spec.md"
refs:
  - "[[2026-09-14-windows-scaffold-parity-spec]]"
  - "[[sqlite-db-swap-stop-service-first]]"
  - "[[mc-service-runtime-port]]"
---

# 신규 프로젝트 MC 등록 transport — Windows 경로 복구 (spec v0.2)

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
- `mode:'none'` 이면 **기존과 동일하게 조용히 skip + exit 0**. 부트스트랩을 절대 막지 않는다(보조 기능).

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
| 5xx | 1회만 재시도(멱등 read 후), 그래도 실패면 skip + 경고 |

**모든 skip 은 `exit 0`** 이다(부트스트랩 차단 금지). 다만 **조용한 실패는 금지**한다 —
2026-09-14 R1 에서 위키 누락에 적용한 것과 같은 규율을 여기에도 쓴다:
`<<AI_BOOTSTRAP_MC_REGISTER_FAILED project=.. reason=..>>` 를 stdout 으로 내보내고 마커에 `mc=failed` 를 남긴다.
(v0.1 은 R1 에서 배운 것을 여기 적용하지 않았다 — L2 가 그 불일치를 짚었다.)

### 2.4 키 관리 (L2 `85da72d7`·`45186b03`)

- **발급 주체 = 대표님.** 에이전트가 키를 만들지 않는다.
- **권한 범위**: 프로젝트·에이전트 등록에 필요한 최소 권한. 가능하면 전용 키를 별도 발급해
  유출 시 그 키만 폐기한다(Cloudflare 토큰 정책과 같은 원칙 — 프로젝트별 분리).
- **파일 권한**: 프로필 `0600`. 매니페스트 `local`(동기 제외).
- **폐기**: 키 교체 시 프로필만 갈아끼우면 되고 코드 변경은 없다.
- **생성 절차를 spec 에 남긴다** — 실측상 **양 환경 모두 프로필 부재**라 이 절차가 없으면 운영자가 막힌다.

### 2.5 멱등

DB 경로의 기존 동작(SELECT → 없으면 INSERT, 있으면 UPDATE)과 **같은 결과**여야 한다.
API 경로도 `GET /api/projects` 로 동일 name/slug 를 먼저 조회하고, 있으면 `PATCH /api/projects/{id}`,
없을 때만 `POST`. 에이전트는 `source` + `name` 이 기존 멱등키이므로 그대로 쓴다.

⚠️ **GET→POST 는 원자적이지 않다**(L2 `e05c68c7`). 동시 스캐폴딩이 겹치면 중복이 날 수 있다.
완전한 해결은 서버측 unique constraint 이나 그것은 MC 스키마 변경이라 별건이다. 본 spec 범위에서는
**409 를 성공으로 처리**하고, 등록 직후 **GET 으로 재확인해 중복이 보이면 경고 신호**를 낸다(탐지로 대체).
실사용 빈도(신규 프로젝트 생성)가 극히 낮아 경합 확률은 사실상 0 이지만, 가정하지 않고 탐지를 둔다.

### 2.3 비밀 취급

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

## 5. 등급 (실측 예정)

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
