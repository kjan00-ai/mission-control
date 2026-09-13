---
type: spec
project: mission-control
date: 2026-09-14
status: draft
author: claude
intent: spec
round: 3
artifact_ref: "docs/multiagent/specs/2026-09-14-windows-scaffold-parity-spec.md"
genealogy: "v0.1 → L2(codex∥gemini, canonical 8/settled 5/escalate 1) → v0.2 → 실측 재검증으로 핵심 진단 정정 → v0.3"
refs:
  - "[[2026-09-14-windows-scaffold-parity-spec-l2-aggregation-20260914-080619]]"
  - "[[spec-status-text-is-not-evidence]]"
  - "[[maia-always-global-immutable-law]]"
---

# Windows 신규 프로젝트 스캐폴딩 정합화 — spec v0.3

> **v0.3 = 자체 실측으로 v0.1/v0.2 의 핵심 진단을 정정한 판.** L2 가 요구한 "실제 훅 실행환경 검증"(`cc630056`)을
> 실제로 수행했더니 **내 1번 진단이 틀렸다**는 것이 드러났다(§6-0). 역설적으로 수리안은 **가벼워졌다** —
> 대표 결재가 2건에서 **1건**으로 줄었다.

## 0. 실제 호출 사슬 (실측 — 양 환경 동일 구조)

```
SessionStart 훅 = claude-session-wrapper.sh          ← settings.json 실측, 양 환경 동일
   ├─(1) legacy: ~/.claude/hooks/session-start-scaffold.sh
   │        WSL     → ~/.ai-bootstrap/init-project.sh   (신본, 중복호출·멱등)
   │        Windows → ~/.claude/scripts/init-project.sh (구본 v1.1.0, 06-03)
   └─(2) 신규 : ~/.ai-bootstrap/init-project.sh          ← stdout 캡처 → 배너 신호
```

**`session-start-scaffold.sh` 는 SessionStart 훅으로 등록돼 있지 않다.** wrapper 가 legacy 로 부를 뿐이다.
그러므로 **신본은 Windows 에서도 정상 실행되고 있다** — `last-run.log` 에 신본 로그 포맷
(`[2026-09-13T11:26:15] [220] skip (done): best-consulting-hp`)이 계속 쌓이는 것이 증거다.

## 1. 진짜 결함 (정정판)

| # | 결함 | 상태 |
|---|---|---|
| ~~1~~ | ~~훅이 구본만 호출~~ | **✗ 반증** — 신본도 정상 호출됨(§0) |
| 2 | **Windows 신본이 06-07 구버전** — 에이전트 킷 시딩 블록 부재 | ✅ 실측(`seed-agent-kit` 매칭 0) |
| 3 | **헬퍼 3종이 Windows 에 없음** (`wslOnly` 분류) | ✅ 실측(3개 전부 부재) |
| 4 | **Windows 신본 `WIKI_ROOT` 가 죽은 경로** | ✅ 실측(`C:/Users/user/OneDrive/...` 부재) |
| 5 | Windows legacy 가 구본을 호출 — 레거시 마커 생성 | 무해하나 정리 대상 |
| 6 | (부수) Windows wrapper 에 audit prune 한 줄 없음 | **범위 밖**, §5 |

결함 3 이 결함 2 를 가린다: 신본이 `[ -f "$MC_HELPER" ]` 가드로 헬퍼를 찾지만 **없으니 조용히 skip** 한다.
그래서 Windows 신규 프로젝트는 md 3종·settings 만 얻고 **에이전트 킷·MC 등록·위키를 못 받는다.**

### 왜 탐지에 안 걸렸나 (근본원인 — v0.1 과 동일, 유효)

매니페스트가 `init-project.sh` 를 **`env` 클래스**(*내용 동기 안 함, 존재만 확인*)로, 헬퍼 3종을 **`wslOnly`** 로
분류한다. 그래서 `maia-deploy --check` 는 **84 identical, 0 drifted** 로 무음이다.
전역 `CLAUDE.md` 가 env-class 라 Windows 수동 반영인 것과 **같은 뿌리**다([[global-claudemd-is-not-auto-apply]]).

### 영향 범위 (실측으로 한정)

BC·SF·Open-Design 전부 **신형 마커 보유** → 마커 가드로 **재발화 0**. 영향은 **앞으로 만드는 Windows 신규
프로젝트**에만 있고 첫 사례가 ModuCare 다.

## 2. 수리안

### R1 — `WIKI_ROOT` 자동감지 + **조용한 실패 금지** (`init-project.sh` canonical, T1)

```sh
WIKI_ROOT="${MAIA_WIKI_ROOT:-}"
if [ -z "$WIKI_ROOT" ]; then
  for c in "/mnt/d/BestConsulting_OS" "D:/BestConsulting_OS"; do
    [ -d "$c" ] && { WIKI_ROOT="$c"; break; }
  done
fi
```

- `MAIA_WIKI_ROOT` 우선 — [[desktop-migration-decision]] 이 정한 보정 변수 재사용.
- **존재하는 후보만** 채택 → 죽은 경로가 조용히 박히는 재발 차단.
- **L2 `4bcac08d`+`17383593` 반영**: 못 찾으면 ① `<<AI_BOOTSTRAP_WIKI_MISSING tried=...>>` 경고를 stdout 으로
  (wrapper 가 캡처해 세션 컨텍스트로 올림) ② 마커에 `wiki=skipped` 기록 ③ `exit 0` 유지.

### R2 — Windows 구본을 **no-op 스텁**으로 (`~/.claude/scripts/init-project.sh`, T1)

**훅을 고치지 않는다.** 구본 파일 자체를 `exit 0` 스텁으로 바꾸면 legacy 체인이 조용히 끝나고,
신본은 wrapper 가 직접 부른다. **T3 훅 편집이 불필요해진다** — v0.2 의 R2(훅 경로 수정)는 **폐기**.
원본은 `.superseded` 로 보존(가역).

> 파일 삭제가 아니라 스텁인 이유: legacy 훅이 `bash <경로>` 로 직접 호출하므로 파일이 없으면 매 세션
> 로그에 에러가 쌓인다. 스텁이면 조용하고, 되돌리기도 파일 복구 한 번이다.

### R3 — 매니페스트 재분류 (`maia-manifest.json`, T2)

| 대상 | 현재 | 변경 | 근거 |
|---|---|---|---|
| `init-project.sh` | `env.boot` | **`shared.boot`** | R1 후 실질 차이 0 → 동기·탐지 대상 |
| 헬퍼 3종 | `wslOnly.boot` | **`shared.boot`** | 결함 3 의 직접 해소 |
| `session-start-scaffold.sh` | `env.hooks` | **`env` 유지** | 양 환경이 다른 것을 부르는 게 실제 구조 |
| `claude-session-wrapper.sh` | `env.boot` | **`env` 유지** | 배너 문구 한/영 + audit prune 차이(의도) |

**shared 84 → 88.**

### R4 — 배포·봉인: 깨져도 안전한 순서 (T1)

L2 `656d14df` 반영. 파일시스템 경계를 넘는 원자성은 불가능하므로 **순서와 멱등**으로 대체한다.

1. **백업 먼저** (전 대상 `.bak-scaffold-parity`)
2. `node maia-deploy.js` — 실패 시 **중단**. 이 시점까지는 Windows 가 이전 상태 그대로라 **더 나빠지지 않는다**
3. `--check` 0 drifted 확인 **후에만** R2 스텁 적용 → "신본이 없는데 구본만 사라진" 상태를 원천 차단
4. **마지막에 양 환경 재봉인**. 봉인 실패는 기능 무영향(탐지층) → 재실행으로 복구, health 가 알린다
5. **재실행 안전**: 백업은 내용해시 기반, deploy 는 md5 동일 시 no-op, 스텁은 이미 스텁이면 skip

### R5 — 부트스트랩 실행층 T3 격상 (`decision-policy.json`, **T3 대표 `!`**)

**L2 `d16d213f` 가 옳다.** `.claude/hooks/**` 는 T3 인데 **훅 사슬이 실행하는 `init-project.sh` 는 T1** 이다.
훅을 못 고치게 막아도 **그 훅이 부르는 스크립트를 고치면 같은 효과** — A2 자기보호의 우회 경로다.
2026-09-14 에 `gate-ssot-ledger.js`(탐지 주체)에서 찾은 것과 **같은 패턴**이고, 본 수리는 헬퍼 3종을
Windows 에도 배포하므로 **그 표면을 넓힌다**. 넓히면서 방치할 수 없다.

```json
{"id":"gate-self-bootstrap","class":"T3","nonOverridable":true,
 "glob":"**/.ai-bootstrap/{init-project.sh,claude-session-wrapper.sh,seed-agent-kit.js,register-mc-project.js,register-mc-agents.js}"}
```

- **`claude-session-wrapper.sh` 포함** — §0 실측으로 **이것이 실제 SessionStart 진입점**임이 확인됐다.
  진입점을 빼고 그 하위만 보호하면 09-14 와 같은 실수(탐지 주체 무보호)를 반복한다.
- **순서상 마지막**에 적용 — 먼저 격상하면 R1 수리 자체가 T3 가 되어 자기참조로 막힌다.
- 빈도 근거: 대상 전부 6월 이후 무변경. 마찰 증가 실질 0.
- ⚠️ **범위 확대 안 함**: `**/.claude/scripts/**` 는 넣지 않는다 — R2 스텁으로 해소되고, 실이득 없는 확대는
  오탐만 늘린다(09-14 Bash DENY 보류와 같은 판단).

## 3. 등급 실측 (실제 호출 형태 + 대조군)

| 대상 | 등급 | ruleId | 결재 |
|---|---|---|---|
| `~/.ai-bootstrap/init-project.sh` · 헬퍼 3종 | **T1** | default-write | 자율 |
| `claude-session-wrapper.sh` (양 환경) | **T1** | default-write | 자율 |
| Windows `~/.claude/scripts/init-project.sh` (R2 스텁) | **T1** | default-write | 자율 |
| `~/.ai-bootstrap/maia-manifest.json` | **T2** | maia-policy | ask |
| **`~/.ai-bootstrap/decision-policy.json` (R5)** | **T3** | gate-self-policy | **대표 `!`** |
| `node maia-deploy.js` / `gate-ssot-ledger.js --seal` | **T1** | default-cmd | 자율 |

**대조군**: `risk-classify.js`=T3 · `decision-policy.json`=T3 · `gate-ssot-ledger.js`=T3 · `src/lib/db.ts`=T1 ·
`docs/**.md`=T0 — 제 등급으로 갈라지므로 시험군 값은 신뢰 가능([[gate-probe-must-mirror-real-call-shape]]).

**⇒ 대표 결재 1건(R5)뿐.** v0.1 "훅 1종" → v0.2 "훅+정책 2건" → **v0.3 "정책 1건"**.

## 4. 검증 계획

1. **byte-identical**: `init-project.sh` WSL↔Windows md5 일치 · 헬퍼 3종 일치
2. **탐지 작동**: `maia-deploy --check` 0 drifted · **shared 84 → 88**
3. **실 훅 환경**(L2 `cc630056`): ✅ **이미 수행** — settings.json 훅 등록 실측 + `last-run.log` 실행 이력으로
   `$HOME` 정상 해석 및 신본 실제 실행 확인(§0). 이 검증이 v0.1 의 오진을 잡았다.
4. **기능 실증**: 샌드박스 임시 git repo 에서 스캐폴딩 → md 3종 + settings 2종 + agents 킷 6종 + 위키/`_index.md`.
   ⚠️ **MC 등록은 실 DB 를 건드리므로** 샌드박스 `HOME` 격리로 헬퍼 미발견 skip 시키거나 사후 정리
5. **재발화 0 (측정)**(L2 `9a1971ad`): BC·SF·Open-Design 적용 전/후 파일목록+해시 스냅샷 대조로 0 diff 증명.
   "마커가 있으니 안 돈다"는 추론이 아니라 대조로 보인다
6. **죽은 경로 회귀**: 후보 부재 시 경고 + 마커 `wiki=skipped` + `exit 0`
7. **봉인**: 양 환경 대장 항목 일치(현 19 → R5 후 24) + `maia-health.js` 무음

## 5. 범위 밖 (정직)

- **Windows wrapper 에 audit prune 한 줄이 없다** — WSL 만 `maia-audit.js --prune 14` 를 돈다.
  그래서 Windows audit 은 06-12 이후 **94일치 54,419건이 무삭제 누적**(WSL 은 14일치 3,727건).
  ⚠️ 이 누적 덕에 월별 ask 추세(21.2%→10.5%)를 낼 수 있었다 — **정리는 손실이 될 수 있으니 별건 판정**.
- **`maia-deploy.js` 가 md5만 비교하고 mode 를 안 본다** — [[copy-sync-must-compare-mode-not-just-hash]] 를
  `hermes-scripts-sync` 에만 적용. 본 건은 `bash <파일>` 호출이라 실행권한 불요 → 이번 범위 제외, 별건.
- Open-Design `.claude/agents` 0개 — 마커 보유라 본 수리로 안 채워진다. 별건.

## 6. ★ 틀린 것 (정직)

### 6-0. 내 진단 1번이 틀렸다 — 파일을 읽고 사슬을 추정했다

v0.1/v0.2 는 *"Windows 훅이 `~/.claude/scripts/` 구본을 부른다"* 고 단정했다. 근거는
`session-start-scaffold.sh` **파일 내용**이었다. 그러나 **그 훅은 SessionStart 로 등록돼 있지 않았다.**
실제 진입점은 `claude-session-wrapper.sh` 였고 그것이 신본을 직접 부른다.

⇒ [[spec-status-text-is-not-evidence]] 의 재현이다. 이번엔 spec 문구가 아니라 **스크립트 본문**을 증거로 삼았는데,
등록 여부를 안 본 순간 같은 오류가 났다. **"무엇이 그것을 부르는가"를 실측하기 전에는 호출 사슬을 주장하지 않는다.**
잡아준 것은 L2 `cc630056`("실 훅 환경 미검증")이었다 — 지적을 형식적으로 반영하지 않고 **실제로 수행**했더니
내 전제가 무너졌다.

### 6-1. `17383593` (blocker) — 근거 오귀속, 실질은 채택
- 주장: *"AGENTS.md 에 WIKI_ROOT 가 `/mnt/c/Users/user/OneDrive/...` 로 지정돼 충돌"*
- **실측**: `~/AGENTS.md`·`~/GEMINI.md`·`~/mission-control/AGENTS.md`·`~/.ai-bootstrap/AGENTS.md` 전부 언급 없음.
  전역 `~/.claude/CLAUDE.md:229` 는 `/mnt/d/BestConsulting_OS` 로 **정확**. codex 가 **본 spec 이 인용한 죽은
  경로를 AGENTS.md 지정으로 오귀속**했고 gemini 는 그 문장만 보고 동의했다.
- **판정**: 근거 반증, **결론은 채택**(조용한 skip 은 실재 위험) → R1 에 경고+마커 반영.

### 6-2. `897f4d9d` (escalate) — 실측으로 해소, codex 가 옳다
- 쟁점: *"'양 환경 대장 일치' ↔ '대장은 환경별' 상충"*
- **실측**: `gate-ssot-ledger.js --verify` → `대장 일치 — 19개 파일`. WSL **19** · Windows **19**.
  대장 **파일은 환경별**(각자 자기 환경 실파일 해시를 봉인)이되 **항목 집합은 일치**해야 한다. 두 층위다.
- **판정**: codex 반박이 정확. **대표 판정 불요**([[verify-decision-options-before-asking-owner]]).

### 6-3. 반영한 합의 4건
`cc630056` → §4-3(수행, 오진 발견) · `656d14df` → R4 순서·멱등 · `d16d213f` → **R5 신설** ·
`4bcac08d` → R1 경고+마커. suggest 2건(`9a1971ad`·`63802efe`) → §4-5 · §2-R3.

> ⚠️ 본 L2 는 `evidenceEligible=false`(비-primary transport 포함) — 검토는 수행됐으나
> 자동신뢰 증거 자격은 없다([[a1-4b-evidence-eligibility-contract]]).
