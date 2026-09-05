# MAIA 시스템 자율화 개편 기획 (Autonomy Overhaul)

> 멀티AI(MAIA) 시스템을 **"Assisted Autonomy"(AI 보조 + 인간 게이트)** 에서 **"Verified Autonomy"(MAIA 합의·근거 기반 자율 + 위험임계점에서만 인간)** 로 전환하는 전략 개편 설계.
>
> - 날짜: 2026-06-11 / 작성: claude / 버전: v1 (현황 3축 실측 조사 기반)
> - 범위: 글로벌 `~/.claude/CLAUDE.md` + `~/.ai-bootstrap` + `~/.claude/settings.json`·hooks + mission-control repo(relay/scheduler) + 위키 핸드오프 프로토콜
> - SSOT: 코드/spec=이 repo, 지식/결정=위키 + 위키링크
> - 대표 결재 대기: §5 (자율 임계점 / L2 트리거 범위 / cycle 우선순위)

---

## 0. 현황 검증 결과 (실측 gap analysis)

3축 병렬 실측(L2·협업 / 서브에이전트·부트스트랩 / 권한·자율) 종합. 출처는 각 항목 file:line.

| 비전 축 | 목표 | 현재 | 구현률 | 핵심 근거 / 격차 |
|---|---|---|---|---|
| **① MAI 협업** (기획/검증/테스트/판단) | 3 AI가 공동으로 기획·검증·판단 | L2 리뷰 존재(StarFollow에 spec→plan→code 3~5회). 그러나 **Claude 허브 중심**, 트리거는 Claude 재량. 실행 시엔 Codex/Gemini가 relay에서 **독립 one-shot**(상호검증 없음) | **~30%** | `c3_mc_to_hermes.js:228-246` 각 AI 독립 실행. L2는 입력만 제공, Claude/인간이 결정 |
| **② 서브에이전트 기본값** (모든 프로젝트, skill/plugin 포함) | 신규 프로젝트마다 역할별 서브에이전트 자동 시딩+등록 | C4B-0(agent_id 라우팅) ✅. `syncProjectAgents()` 코드 ready. 그러나 **킷 템플릿 0개, `register-mc-agents.js` 없음, init-project.sh §3.6 시딩 미구현, scheduler 미배선**. 실제 `.claude/agents` 보유 프로젝트 **0개** | **~22%** | `~/.ai-bootstrap/templates/agents/` 부재, `scheduler.ts`에 `project_agent_sync` task 없음 |
| **③ 소통표준 + 자율판단** | 표준 프로토콜로 인간 없이 자율결정, 고위험만 게이트 | 파일/CLI 포맷 표준화(wiki frontmatter `type:handoff`, L2 구문 `codex exec`/`gemini -p`). 그러나 **모든 주요 결정 = "사용자 결재"** | **~40%** | 비동기 메시지큐 없음, AI 거부권/에스컬레이션 없음, 모든 게이트가 인간으로 수렴 |
| **④ ask해소 + 자동 L2 loop** | bash ask 등 상시개입 해소, 근거 기반 자동 재검증 loop | read-only 사전승인 ✅(설정 50패턴 + 글로벌 §7). 그러나 **쓰기/commit/push 0%**(exact-match 2건만), **자동결정엔진 0%**, **자동 재검증 loop 0%** | **~5-20%** | 실패 시 자동 L2 진단 없음, 위험도 계층화 없음, 수렴 검출 없음. L2 depth ≤1 고정 |

**종합: 비전 대비 ~25-30% 구현.** 인프라(relay·cron·wiki·C4B-0·sync 코드)는 견고하나, **자율 의사결정·자동 검증 loop·서브에이전트 기본화**가 비어 있음.

### 0.1 현재 강점 (보존할 것)
- 위키 기반 세션 연속성(handoff/reference SSOT), cron relay(every 1m, status 멱등), 역할분리(Claude 기획 / Codex 기술 / Gemini UX), 버전핀 CLI, read-only 사전승인.

---

## 1. 목표 아키텍처

```
현재: Assisted Autonomy
  대표 ──지시──> Claude(허브) ──선택적 L2──> Codex/Gemini(리뷰)
                    │                              │
                    └──모든 주요결정──> 대표 결재 ←─┘   (인간이 병목)

목표: Verified Autonomy
  대표 ──목표/제약──> MAIA 시스템
                       ├ 자율 결정 게이트(위험도 분류)
                       ├ 자동 L2 loop(합의·수렴까지 반복)
                       ├ 근거 자동수집(테스트/diff/실측)
                       └ 위험임계점 초과 시에만 ──> 대표 (소수 게이트)
```

핵심 전환: **인간을 "모든 중간결정"에서 "위험임계점 결정"으로 후퇴**시키고, 그 빈자리를 **근거(테스트·실측) + MAIA 합의**가 채운다.

### 1.1 ★ 핵심 원칙 — 문서 강제 (Document-Mandate) (대표 확정 2026-06-11)

> 모든 자율성과 합의는 **문서 근거(audit trail)** 위에서만 성립한다. 이것이 Verified Autonomy의 토대.

- **산출물 = wiki SSOT**: 모든 프로젝트의 모든 산출물(**src/코드 제외**)은 **Obsidian wiki 폴더 안에 저장·참조·소통**된다. 지식·결정·기획·핸드오프·L2 판정은 전부 wiki md. (코드/spec만 repo 원본 + 위키링크.)
- **AI 간 소통 = md 강제**: 각 AI(Claude/Codex/Gemini/Hermes agents)가 상호 소통할 때는 **무조건 md 문서로 전달**한다. 구두/인메모리 전달 금지 — 모든 캐치볼은 wiki md로 남겨 **문서 근거를 영구 보존**한다. L2 round·핸드오프·판정·결정이 전부 추적·재현 가능해진다.
- **Obsidian + Hermes 결합**: Obsidian(인간 가독·지식 SSOT) + Hermes agents(실행 엔진)를 함께 활용. wiki md가 두 세계의 공통 인터페이스.
- 적용: §2.B(L2 loop는 매 round md 산출) / §2.E(프로토콜 = wiki md 버스) / 모든 핸드오프가 이 원칙을 따른다.

---

## 2. 6대 개편 축 (mechanisms)

각 축 = 현재 → 목표 → 구체 산출물.

### A. 자율 결정 게이트 (Decision Gate Framework) — 비전 ③④

- **현재**: 모든 비자명 결정에 `AskUserQuestion` 모달 → 대표 개입.
- **목표**: 결정을 **가역성·위험도**로 4분류하고, 각 클래스별 자율/게이트를 규약화.

| 클래스 | 정의 | 처리 | 예 |
|---|---|---|---|
| **T0 자명·가역** | 되돌리기 쉬움, 영향 국소 | **즉시 자율** (근거만 로그) | 파일편집, 테스트작성, 리팩터 |
| **T1 검증필요·가역** | 설계·접근 선택, 되돌릴 수 있음 | **자동 L2 loop → 합의 시 자율** | spec/plan 선택, 버그 수정 접근 |
| **T2 위험·준가역** | 되돌리기 비용 큼 | **자동 L2 + 강한 근거 → 자율, 사후 보고** | migration(dev), feat 브랜치 push, 의존성 bump |
| **T3 비가역·외부** | 되돌릴 수 없거나 외부 영향 | **항상 대표 게이트** | main merge, prod DB write/삭제, secret 등록, 외부발신(메일/SNS/배포), prod migration |
| - 산출물: 글로벌 CLAUDE.md에 "Decision Gate" 섹션 + `decision-policy.md`(분류표·예시·에스컬레이션 규칙). 기존 §7(read-only 사전승인)을 T0로 흡수·확장.

### B. L2 자동검증 Loop 엔진 — 비전 ①④ (★ 핵심)

- **현재**: L2 = Claude가 재량으로 CLI one-shot 호출(`codex exec`/`gemini -p`), depth≤1, 5왕복, **반복·수렴 없음**.
- **목표**: **결정 산출물이 생기는 순간 자동 트리거**되어 합의/수렴까지 반복하는 loop.

```
산출물(spec/plan/design/fix) 생성
   → 자동 L2 발동: Codex(기술) ∥ Gemini(UX/운영) 독립 검증
   → 판정 집계: 항목별 BLOCKER / 중요 / 제안 + AI별 입장
   → if BLOCKER>0: 반영 → 재검증 (round++)
   → 항목별 합의 판정:
        · 만장일치 항목        → 확정(settled)
        · 합의점 없는 항목(이견 지속) → ★ 심화 L2(아래 deepen) 추가 발동, settled 아님
   → until (모든 항목 settled) OR deepen-budget 소진
   → 전부 settled: 자율 진행(T0/T1/T2) | 심화 후에도 미합의/T3: 대표 에스컬레이션(쟁점만 요약+각 AI 입장)
```

- **수렴 목표 = 만장일치(항목 단위).** 만장일치된 항목은 확정. **합의점이 없는 항목만 분리**하여 다음 단계로.
- **★ 비만장일치 항목 → 심화 L2 (대표 요건 2026-06-11)**: 합의 안 된 쟁점은 곧장 인간에 넘기지 않고, **그 쟁점만 떼어 더 구체적·심화된 L2를 추가 진행**한다.
  - **심화(deepen) 수단(누적 적용)**: ① 쟁점 범위 축소(해당 항목만 정밀 재질의) → ② 근거 강화(실측 테스트·코드 대조·재현 요구) → ③ **depth 상향**(현 depth≤1 → 쟁점 한정 depth=2 허용, 각 AI가 상대 논거를 직접 반박) → ④ 필요 시 **3자 동시 대질**(Codex↔Gemini 교차반박 + Claude 중재) → ⑤ 그래도 미합의면 **추가 검증자/관점** 투입.
  - **deepen-budget**: 쟁점당 심화 라운드 cap(권고 2~3) + 토큰/시간 가드. 소진 시에만 대표 에스컬레이션.
  - **2/3 다수결은 "통과"가 아니라 "심화 트리거"**: 2:1로 갈리면 소수의견이 틀렸는지 심화로 입증해야 settled. 다수결만으로 자율 진행 금지(R3 함께-틀림 방어).
  - 모든 심화 round도 §1.1대로 wiki md 산출 → 쟁점이 어떻게 좁혀졌는지 문서로 남음.
- **★ 매 round = wiki md (문서 강제, §1.1)**: 각 검증 round의 요청·각 AI 판정·집계·반영을 **wiki `reviews/`(또는 프로젝트 카테고리)에 md로 산출**. genealogy(AA→AA-1)도 md frontmatter로. 인메모리 전달 금지 — loop 전체가 문서로 재현 가능.
- **구현 방식 = 단계적 a→b (대표 확정)**:
  - **(a) C5-1 — 경량 드라이버** `~/.ai-bootstrap/l2-loop.js`: Claude가 산출물 md 경로+컨텍스트를 넘기면 Codex/Gemini 병렬호출·집계·반복을 오케스트레이션(CLI 래퍼). **각 round 결과를 wiki md로 기록**. 토큰/시간 cap, 백그라운드.
  - **(b) C5-2 승격 — MC task durable 버스**: 산출물을 MC task로 등록, relay가 Codex/Gemini dispatch, comment에 **wiki md 링크 누적**(본문은 wiki, MC는 기계 인덱스), scheduler가 수렴 판정. 감사·재현 강화.
- 산출물: l2-loop 엔진(a) + 글로벌 CLAUDE.md "Auto-L2" 규약(언제 발동/수렴/에스컬레이션/md 산출 위치) + 비용 가드(복잡도 임계·round cap).

### C. ask 해소 (Permission Autonomy) — 비전 ④

- **현재**: settings allow에 read-only 50패턴 + exact-match commit 2건. **쓰기/push/Edit 없음** → 매 쓰기마다 ask. WSL credential 미설정(이번에 해소됨).
- **목표**: T0/T1/T2를 settings + hooks로 **사전승인 + 근거게이트**.
  - **allow 확장**: `Edit(src/**)`, `Bash(git add/commit/push)` (단 **feat/* 브랜치 한정, main 보호**), dev DB write 한정.
  - **PreToolUse 검증 훅**: 위험 op(commit/push/migration) 전 자동으로 테스트·diff·foreign_key_check 수집 → 통과 시에만 진행(근거 자동확보).
  - **PostToolUse 훅**: push 후 `git ls-remote` 자동 검증(현 수동 규약 자동화), 실패 시 알림.
  - **유지(T3 게이트)**: main merge, secret, 외부발신, prod 데이터.
- 산출물: `~/.claude/settings.json`·프로젝트 settings allow 확장 + `~/.claude/hooks/{pre-risk-verify,post-push-verify}.sh` + 글로벌 §7 → Decision Gate 통합.

### D. 서브에이전트 기본화 (Sub-agent Defaults) — 비전 ② (= C4B 완수)

- **현재**: C4B-0 완료. C4B-1/2/3 미착수. 실제 시딩 0.
- **목표**: 신규 프로젝트 부트스트랩 시 역할별 서브에이전트 + 기본 skill/plugin 자동 적용·MC 등록.
  - **C4B-1**: repo path SSOT(B-2) + sync 공유모듈(B-3) + github_repo fallback.
  - **C4B-2**: 킷 템플릿 3종(ai-engineer/code-reviewer/doc-manager, JSON tools, default_display_name) + atomic 시딩 + `register-mc-agents.js`.
  - **C4B-3**: scheduler `project_agent_sync` 배선 + 지연형 고용 팝업 UX + 카드 배지/유령 처리.
  - **+ 신규**: **글로벌 서브에이전트**(`~/.claude/agents/`, 모든 프로젝트 공통) + **기본 skill/plugin 킷** 정의(이 개편으로 추가). 예: 모든 프로젝트에 code-review/verify/L2-loop skill 기본 탑재.
- 산출물: C4B-1/2/3 plan(별도) + 글로벌 agent/skill 킷 정의.

### E. 소통 프로토콜 표준화 (Inter-AI Protocol) — 비전 ①③

- **현재**: HANDOFF_SEND/RECV 화면마커 + 위키 handoff frontmatter. CLI one-shot. 비동기 채널·감사 없음.
- **목표 (= §1.1 문서 강제 구현)**: 핸드오프를 **md 스키마화**하고 **wiki md를 단일 메시지 버스**로.
  - **md 메시지 스키마(frontmatter)**: `{from, to, intent(review/handoff/escalate), artifact_ref(wiki 경로), round, verdict(blocker/important/suggest), genealogy(AA→AA-1), status}`. 본문 = 근거·이견·반영.
  - **채널 = wiki md (1급)**: 모든 AI 캐치볼은 wiki `handoffs/`·`reviews/` md로 전달(문서 강제). **MC task comments는 wiki md 링크의 기계 인덱스**(본문 중복금지, SSOT는 wiki). Obsidian에서 인간이 동일 문서 열람·개입 가능.
  - **합의·거부권**: 각 AI가 md verdict로 BLOCKER 제기 가능(거부권), 2/3 합의로 진행(B 엔진과 연동). 합의/이견이 전부 문서로 남음.

#### E.1 ★ 문서 규약 (구체) — 저장경로·파일명·Obsidian 연결 (대표 요건 2026-06-11)

> AI 간 모든 md 소통이 **기계적으로 같은 위치·같은 이름·같은 링크 표기**를 따라야 자동 오케스트레이션(L2 loop)과 Obsidian 그래프가 성립. 이 규약은 §2.F로 글로벌 표준에 박는다.

**(1) 저장 폴더 경로** (`WIKI_ROOT` = Obsidian vault `…/BestConsulting_OS`):
```
WIKI_ROOT/wiki/projects/{project}/
  ├ handoffs/    ← AI↔AI 캐치볼·세션 핸드오프 (상호 소통 1급 채널)
  ├ reviews/     ← L2 검증 round·판정·심화 (Auto-L2 산출 위치)
  ├ decisions/   ← 확정 결정
  ├ dev-tasks/   ← 작업 지시·진행
  ├ errors/      ← 오류·진단
  └ references/  ← 지식·교훈·고정좌표
```
- 상호 소통 문서 = **handoffs/**(캐치볼) + **reviews/**(L2). 산출물 카테고리는 5필터(spec/plan/결정/보고서/지시서) 따름. **src/코드만 repo**(위키엔 절대경로 링크).

**(2) 파일명 규약** (소문자-kebab, 날짜 절대값 `YYYYMMDD`, 상대날짜 금지):
| 유형 | 패턴 | 예 |
|---|---|---|
| 세션 핸드오프 | `SESSION-HANDOFF-{topic}-{YYYYMMDD}.md` | `SESSION-HANDOFF-c5-0-20260611.md` |
| AI 캐치볼 | `HANDOFF-{from}_{to}-{topic}-{YYYYMMDD}[-{seq}].md` | `HANDOFF-claude_codex-l2loop-20260611-1.md` |
| L2 검증 | `{artifact}-l2-{ai}-{YYYYMMDD}[-r{round}].md` | `c5-0-plan-l2-gemini-20260611-r2.md` |
| 심화 L2(쟁점) | 위 + `-r{n}` / genealogy 접미 | `c5-0-plan-l2-codex-20260611-r3.md` |
| 결정 | `{YYYYMMDD}-{topic}.md` | `20260611-maia-autonomy-overhaul.md` |
| 리뷰/오류/지시 | `{YYYYMMDD}-{topic}.md` (해당 폴더) | — |

**(3) Obsidian 연결정보 표기** (모든 md 필수):
- **frontmatter**: `type / project / date(절대) / status / author / refs: ["[[관련문서]]", …]` + L2면 `intent / round / verdict / genealogy / artifact_ref`.
- **본문 위키링크**: `[[문서명]]`, 섹션 `[[문서명#섹션]]`, 별칭 `[[문서명|표시명]]` — 관련 문서·근거를 인라인 링크.
- **genealogy(심화 계보)**: frontmatter `parent: "[[원본-r1]]"` + `genealogy: AA-1`(AA→AA-1). 쟁점이 어느 round에서 파생됐는지 추적.
- **artifact_ref**: 검증 대상 위치 — 위키면 `[[…]]`, repo 코드면 절대경로+설명(예: `~/mission-control/src/lib/x.ts:42`).
- **tags**: `#l2 #handoff #decision` 등 — Obsidian 검색·그래프 분류.
- **backlink**: refs로 상호연결 → Obsidian 자동 역링크로 캐치볼·검증 계보가 그래프로 가시화. 고립 문서(링크 0) 금지.

- 산출물: **md 프로토콜 스키마 doc(위키, E.1 전문)** + 글로벌 CLAUDE.md 핸드오프 규약 강화(경로·파일명·링크 표기 명문화) + relay/scheduler 확장(wiki md 링크 기반 round 누적) + (권고) 파일명/frontmatter **린터**(규약 위반 자동검출).

### F. 글로벌 규약 표준화 (Global Standardization) — 전(全) 비전축 횡단 (★ 대표 요건 2026-06-11)

> A~E가 글로벌 CLAUDE.md를 조각조각 건드리므로, 이를 **하나의 일관된 표준으로 재편**하는 것을 독립 산출물로 격상. 글로벌 규약 = **모든 프로젝트 공통 행동규범**이라, 여기에 표준화돼야 비전이 "모든 프로젝트 기본값"으로 성립한다.

- **현재**: 글로벌 `~/.claude/CLAUDE.md`는 워크플로·subagent·§7 read-only·위키연동·L2 인라인을 **서술형**으로 담음. Decision Gate(T0~T3)·Auto-L2 loop·문서강제·md소통 같은 **새 레짐이 미반영**, 규약 간 상호참조·우선순위 불명.
- **목표**: A~E의 규약을 글로벌 CLAUDE.md에 **단일 표준 체계로 통합**(모든 프로젝트 자동 적용). 항목:
  - **Decision Gate 표준**(§2.A T0~T3 분류·에스컬레이션) — 기존 §7을 T0로 흡수.
  - **Auto-L2 표준**(§2.B 발동조건·만장일치 목표·심화 L2·deepen-budget·md 산출 위치).
  - **문서 강제 표준**(§1.1: 산출물 wiki SSOT, AI소통 md 강제) — 기존 위키연동 규약 강화·명문화.
  - **소통 프로토콜 표준**(§2.E md 메시지 스키마·거부권·합의 + **§2.E.1 저장경로·파일명·Obsidian 링크 규약** — 모든 프로젝트가 동일 경로/이름/링크 표기 강제).
  - **서브에이전트·skill 기본킷 표준**(§2.D 모든 프로젝트 공통 적용 규약).
  - **규약 간 우선순위·충돌해소 규칙** 명시(글로벌 ↔ 프로젝트 CLAUDE.md merge 규칙 재정비).
- **검증**: 이 표준화 산출물 자체를 **Auto-L2(만장일치+심화)에 통과**시켜 근거를 남긴다(문서강제 원칙의 자기적용·dogfooding).
- 산출물: 재편된 `~/.claude/CLAUDE.md`(표준화 버전) + 변경 근거 wiki md + 각 cycle(C5-0/1, C4B) 종료 시 해당 규약 글로벌 반영(점진 통합).

---

## 3. 단계별 로드맵 (C5 cycle — ★ L2 round1 반영 재배열, 대표 승인 2026-06-11)

C4B(서브에이전트)와 병행/후속하는 **C5 "자율화" cycle**. **검증엔진·안전 스키마가 위험권한 개방보다 선행**(L2 만장일치 반영) — 단일 AI 환각이 R1으로 직결되는 것을 차단.

| Cycle | 내용 | 비전축 | 효과 | 선행 |
|---|---|---|---|---|
| **C5-0a** | Decision Gate 정책(T0~T3 + denylist) + 검증 훅 **dry-run** + CLAUDE.md 규약 + **T0/T1(가역) allow만** (commit/push 제외, read-only audit) | ③④ | **일상 개입 격감(가역 op ask 제거)**, 위험권한은 미개방 | 없음 |
| **C5-1a** | **schema 기반** L2 자동검증 loop 엔진(verdict frontmatter/JSON 강제 + 린터 필수 + PreWrite hook) + Auto-L2 규약 | ①④ | 기계 가독 수렴판정·근거 기반 자율 | C5-0a |
| **C5-0b** | non-main **commit** allow (feat/* 한정, risk classifier, Pre-차단형 게이트) | ④ | 커밋 자율(검증엔진 가동 후) | C5-1a |
| **C4B-1~3** | 서브에이전트 기본화 완수(킷/시딩/scheduler) + 글로벌 agent·skill 킷 | ② | 모든 프로젝트 전문 서브에이전트 | C4B-0 ✅ |
| **C5-1b/C5-2** | MC durable bus(별도 `l2_reviews/l2_rounds` 테이블·metadata schema) + 소통 프로토콜 스키마화 + 합의/거부권 | ①③ | 감사가능·재현 durable 버스 | C5-1a, C4B-3 |
| **C5-0c** | **push** allow (마지막, GitHub branch protection 병행) | ④ | push 자율(전 안전장치 확보 후) | C5-1b |

> ★ 재배열 원칙(대표 승인 2026-06-11): **정책·검증엔진·스키마 선행 → 권한은 가역(T0/T1)부터 단계적 → push는 마지막.** 기존 "C5-0 먼저(권한확장 포함)"를 폐기.

---

## 4. 리스크 / 완화

- **R1 과대권한 → 손상**: allow 확장이 prod/main까지 새면 치명. → **가역성 우선·위험클래스 게이팅**(T3 절대 게이트), main 브랜치 보호, 모든 자율행위 audit 로그.
- **R2 L2 loop 비용 폭증**: 토큰·시간. → 복잡도 임계 이하는 loop 생략, round cap=3, 백그라운드, 일일 quota(현 relay quota 재사용).
- **R3 잘못된 합의(2/3가 함께 틀림)**: → T2/T3는 합의+강한 근거(실측 테스트) 동시 요구, T3는 인간 유지. 사후 보고로 조기 발견.
- **R4 자율판단 오라우팅/머지충돌**: → C4B-0 agent_id 라우팅 기반, golden 테스트, feat 브랜치 격리.
- **R5 프로토콜 drift(JS↔TS)**: → C4B B-3 공유모듈/golden fixture 재사용.

---

## 5. 대표 결재 결과 (2026-06-11 확정)

1. **자율 임계점** = **T2까지 자율 + 사후보고**. main merge·prod 데이터·secret·외부발신(T3)만 대표 게이트. → 일상 개입 최대 격감.
2. **L2 엔진 구현 방식** = **단계적 a→b**. C5-1은 경량 드라이버(`l2-loop.js`)로 빠르게, C5-2에서 MC task durable 버스로 승격.
3. **★ 문서 강제(§1.1)** = 확정. 모든 산출물(src 제외) wiki 저장, AI 간 모든 소통 md 강제, Obsidian+Hermes 결합. → §2.B/§2.E에 반영됨.
4. **cycle 우선순위** = ~~C5-0(ask해소·게이트) 먼저~~ → **★ L2 round1 반영 개정(2026-06-11)**: 검증엔진·스키마 선행. **C5-0a(정책+가역권한)→C5-1a(schema l2-loop)→C5-0b(commit)→C4B→C5-1b/C5-2(durable bus)→C5-0c(push)**. §3·§7 참조.

### 5.2 L2 round1 개정 (2026-06-11, 대표 승인)
§2.F dogfooding L2(Codex∥Gemini 만장일치 "수정필요")의 로드맵 재배열안을 대표 승인. 권한확장(commit/push·T2 자율)은 L2 검증엔진(C5-1a)·verdict 스키마·린터 필수·PreWrite hook 배포 **이후** 단계적 개방. 비전(T2 자율)은 유지, 순서·안전 선행조건만 조정. 근거: [[maia-autonomy-l2-aggregation-20260611]].

### 5.1 잔여 세부 결재 (각 cycle plan 작성 시)
- L2 자동발동 **복잡도 임계** 구체값(어떤 산출물부터 강제? 권고: spec/plan/design/위험수정).
- C5-0 allow 확장의 **정확한 패턴·브랜치 범위**(feat/* 한정, main 보호 — plan에서 확정).
- 글로벌 vs 프로젝트 서브에이전트·skill 기본킷 구성(C4B-2와 통합).

---

## 6. 관련
- 현황 출처: `~/.claude/CLAUDE.md`(§7, L2/wiki), `c3_mc_to_hermes.js`, `src/lib/local-agent-sync.ts`, `src/lib/scheduler.ts`, 위키 handoffs/decisions.
- 선행: [[2026-06-11-c4b-bootstrap-agent-auto-registration-design]] (서브에이전트=비전②), C4B-0 완료(commit eeba2d6).
- 후속: C5-0/1 plan, C4B-1~3 plan.

---

## 7. L2 검증 결과 (§2.F dogfooding, round 1 — 2026-06-11)

이 기획서 자체를 Auto-L2(Codex 기술 ∥ Gemini 운영)에 통과시킨 round 1 결과. 산출물: 위키 `reviews/maia-autonomy-l2-{codex,gemini,aggregation}-20260611.md`.

- **판정: 만장일치 "수정필요"** (Codex BLOCKER 6 / Gemini BLOCKER 2). 비전·아키텍처 방향은 타당하나 그대로 PASS 불가.
- **두 AI 충돌항목 0건 → 심화 L2(deepen) 불필요.** deepen-budget 미소진.

### 7.1 만장일치 BLOCKER (반영 확정 방향)
1. **로드맵 순서 역전 — 검증엔진 선행.** 상호검증(C5-1 L2 loop) 없이 권한·T2 자율(C5-0)을 먼저 열면 단일 AI 환각이 R1으로 직결. → C5-0 분할: **C5-0a**(정책+훅 dry-run+T0/T1 가역+read-only audit, *commit/push 없음*) → **C5-1a**(schema l2-loop) → **C5-0b**(non-main commit) → **C5-1b/C5-2**(MC durable bus) → **push allow**(마지막).
2. **L2 판정 = 기계 스키마 강제 + 린터 필수.** free-form md만으론 수렴판정 신뢰불가·loop crash. → verdict frontmatter/JSON 스키마(`artifact_id/round/item_id/severity/claim/evidence_refs/status/hash`) + 파일명/frontmatter 린터 **(권고→필수)** + PreWrite 검증 hook.

### 7.2 settled 보강 (단독·무반박, 채택)
- **기술**: Pre-차단형 push 게이트(PostToolUse 사후 부적합) · 항상금지 **denylist**(force push/secret 출력/prod write/destructive fs/paid API) · **risk classifier**(path allow 대신) · MC durable bus 별도 `l2_reviews/l2_rounds` 테이블 선설계 · relay 완료-회수 경로(`async_state/dispatch_run_id` 정합) · T2 세분(migration/dep bump/feat push) · 누락 위험 op 반영 · main 보호 GitHub branch protection 병행 · syncProjectAgents repo path 통일(`repoName` vs `owner__repo`).
- **운영**: T2 사후보고 **Daily Digest + UI 배지**(alert fatigue) + "근거 3줄 + 롤백 커맨드" · 중간문서 생애주기(settled 시 squash/archive + backlink 강제) · `escalation-summary.md` 포맷.

### 7.3 대표 에스컬레이션 → **승인 (2026-06-11)**
수렴 verdict가 §5 대표 결재와 충돌(AI 이견 아님, *기결재 변경*):
- #4 "C5-0 먼저" ↔ "C5-0(권한)을 C5-1(검증) 뒤로" / #1 "T2 자율" ↔ "T2 자율은 L2 엔진 배포 후".
- **비전(Verified Autonomy, T2 자율 목표)은 유지, 순서·안전 선행조건만 수정.**
- **★ 대표 결재 결과: 재배열 승인.** §3 로드맵을 C5-0a→C5-1a→C5-0b→C4B→C5-1b/C5-2→C5-0c(push)로 확정 반영. §5.2 참조. 차기 = **C5-0a plan 착수**(정책+Decision Gate+훅 dry-run, 권한확장 제외).
