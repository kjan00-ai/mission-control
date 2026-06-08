# C2 설계 — 위키 진행상황 on-demand 보고 (Hermes Skill) [v2 — L2 검증 반영]

> 작성: 2026-06-07 / author: claude / **v2: Codex(기술)+Gemini(UX) L2 검증 반영**
> cycle: 멀티AI 시스템 C cycle 두 번째 서브프로젝트 (C1 완료 + R6 실재부팅 검증 통과 후)
> 진입점: 위키 `[[SESSION-HANDOFF-c1-r6-c2-20260607]]` C2 섹션
> 관련 메모리: `feedback_no_inference_verify_data`, `feedback_windows_hook_command_format`, `feedback_l2_subagent_call_standard`
> L2 검증: 위키 `reviews/c2-spec-tech-review-codex-20260607.md`(조건부승인 9건) + `reviews/c2-spec-ux-review-gemini-20260607.md`(조건부승인 5건)

---

## 0. L2 검증 반영 요약 (v1 → v2)

양쪽 모두 **조건부 승인** — 큰 설계(skill + 기존 gateway 재사용 + 추가 인프라 0)는 성립, 보강 후 진행 가능.

| 출처 | 지적 | v2 반영 |
|---|---|---|
| Codex#1 + Gemini#1 | skill 자발 발동 보장 안 됨 + 트리거 부족 | **라우팅 규칙(SOUL.md/config)을 선택 → 기본안 격상** + 트리거 표현 확장 |
| Codex#2 | frontmatter YAML 형식 리스크 | `description: >` folded block + V1에 `hermes skills inspect` |
| Codex#3 | skill 캐시/gateway 재시작 누락 | **V0 신규** — skill 설치 후 reload/재시작 + registry 반영 확인 |
| Codex#4 | 읽기전용 "강제" 아님 | "설계상 read-only"로 표현 정정 + 사후 timestamp 비교(V6b) |
| Codex#5 | 프로젝트 자동발견 필터 없음 | 프로젝트 인정 기준 명시(`_index.md` + `handoffs/`·`log.md` 존재), reviews/ 제외 |
| Codex#6 | handoff status 실측 필요 | **실측 완료** — 표준값 `draft/active/superseded/todo/in-progress/done/reviewed/blocked`, 진행요약은 `active`+`todo`+`in-progress` |
| Codex#7 | gateway 실행 사용자 read 검증 | V2에 gateway 사용자 기준 접근 확인 + 경로 quote |
| Codex#8 + Gemini 전반 | V1~V6 부족 | V0/V3b(유사발화 5)/V4b(없는 프로젝트)/V6b(사후변경)/V7(실패메시지) 추가 |
| Gemini#2 | 타임스탬프(신선도) | 출력에 `(N시간 전)` / `(6/7)` 병기 |
| Gemini#3 | 모바일 볼드/리스트 | `*■ 프로젝트*` 볼드 + carry `-` 리스트 최대 3 |
| Gemini#4 | 빈 결과(Empty State) | "활성 태스크 없음" UX 라이팅 |
| Gemini#5 | 길이 제한 | 프로젝트당 핵심 3줄 내외, 전체 스크롤 2회 이내 |

---

## 1. 목적과 범위

대표님이 Telegram `@myroyalaibot`에게 한국어로 "진행 어때?" / "현황 정리해줘" / "다음에 뭐 해야 해?" 류를 물으면, Hermes gateway의 LLM(claude-sonnet via OpenRouter)이 **`wiki-progress-report` skill**을 발동해 OneDrive 위키를 읽고 **전체 프로젝트 진행 요약**(프로젝트별 최근 작업 + 다음 carry)을 한국어로 답한다. 특정 프로젝트명을 대면 그것만 상세히 답한다.

**범위 (확정):**
- ✅ on-demand 전용 — 대표가 물을 때만 발동.
- ❌ 정기 push(cron) — 범위 밖. 후속 carry (필요 시 `hermes cron` + `hermes send`로 별도 추가 가능).
- ✅ 위키 **설계상 읽기 전용** — skill은 read만 한다. (⚠️ Codex#4: SKILL.md 문구만으로 기술적 강제는 안 됨 — gateway LLM이 write tool을 가지면 실수 가능. 강제는 검증 V6b 사후 timestamp 비교 + 가능 시 gateway tool policy로 보강.)
- ✅ 추가 인프라 0 — gateway 상시구동(R6) 재사용.

---

## 2. 아키텍처 & 데이터 흐름

```
대표 Telegram "진행 어때?"
   ↓
Hermes gateway (R6 상시구동) — claude-sonnet via OpenRouter
   ↓ LLM이 skill description 매칭으로 발동 판단
wiki-progress-report skill (SKILL.md 가이드)
   ↓ skill 절차대로 파일시스템 tool(ls/read) 사용
WSL → /mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS/wiki/
   ├─ projects/*/  ← 프로젝트 자동 발견 (하드코딩 금지)
   │    ├─ _index.md         (개요)
   │    └─ handoffs/*.md     (status:active → 최근작업 + carry)
   └─ log.md                 (최근 작업 한 줄 로그 tail)
   ↓ LLM이 읽은 내용 요약
Telegram 답장 (한국어, 프로젝트별 묶음)
```

### 핵심 설계 결정 3가지

1. **추가 인프라 0** — gateway는 이미 R6로 상시 가동 중. C2는 **skill 파일 1개 + SOUL.md 라우팅 1줄** 추가가 전부. 신규 프로세스·데몬·migration 없음.

2. **프로젝트 자동 발견** — skill이 `wiki/projects/` 아래를 `ls`로 훑어 처리. 새 프로젝트(예: StarFollow) 추가 시 skill 수정 불필요. 하드코딩 금지(메모리 `feedback_no_inference_verify_data` 정신 — 실제 디렉토리를 보고 답).

3. **읽기 전용** — skill은 위키를 read만. 쓰기/수정 0. 위키 SSOT 무손상.

### 우려 지점 (실측 기반)

- LLM이 한국어 트리거에 skill을 자발 발동할지 — description에 한국어 키워드("진행", "현황", "carry", "다음 할 일")를 명시해 매칭률을 높인다. 핸드오프에 기록된 "규칙 fallback은 hook만큼 보장 아님"과 유사한 리스크지만, **skill description은 builtin skill들이 실제로 그렇게 작동하는 정식 메커니즘**이라 rules보다 신뢰도가 높다. 검증 V3에서 미발동 시 config rules로 보강.

---

## 3. Skill 파일 구조

**위치**: `~/.hermes/skills/devops/wiki-progress-report/` (WSL `bestconsulting` 홈, 기존 builtin과 동일 레이아웃 — 실측 확인: builtin skill은 `~/.hermes/skills/{category}/{name}/SKILL.md` 구조 + `references/`·`templates/` 서브폴더 지원)

```
wiki-progress-report/
├─ SKILL.md          ← frontmatter + 보고 절차 가이드
└─ references/
   └─ wiki-layout.md ← 위키 디렉토리 규약 (경로·frontmatter 키)
```

### SKILL.md frontmatter (실측한 builtin 형식 그대로)

```yaml
---
name: wiki-progress-report
description: "위키(Obsidian) 진행상황 보고. '진행 어때', '현황', '뭐 했나',
  '다음 할 일', 'carry', '미해결', 'progress', 'status' 류 질문 시 발동.
  BestConsulting_OS 위키의 프로젝트별 최근 작업 + 다음 carry를 요약해 답한다."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [wiki, progress, report, monitoring, korean]
    related_skills: []
---
```

### SKILL.md 본문 절차 (LLM이 따라갈 결정적 단계)

1. **경로 확정** — `WIKI=/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS`
2. **프로젝트 발견** — `ls $WIKI/wiki/projects/` → 디렉토리 목록 (자동, 하드코딩 금지)
3. **프로젝트 인정 필터** (Codex#5) — `wiki/projects/` 하위 디렉토리 중 **모두 만족**: ① 디렉토리이고 ② `_index.md` 존재하고 ③ `handoffs/` 또는 `log.md`(루트 공용) 참조 가능. 깨진/임시/숨김(`_`·`.` 시작) 폴더는 스킵. ⚠️ `handoffs/reviews/`는 검증보고서라 진행요약 대상에서 **제외**(handoffs 직속 `*.md`만).
4. **범위 판단** — 질문에 특정 프로젝트명 있으면 그것만 상세 / 없으면 전체 요약.
5. **프로젝트별 읽기** (status 실측 반영 — Codex#6):
   - `handoffs/*.md`(직속, reviews/ 제외) 중 frontmatter `status` ∈ **{`active`, `todo`, `in-progress`}** → 제목 + "다음 우선/carry/미해결" 섹션 추출. (`done/superseded/blocked/draft`는 진행요약서 제외 — 단 `blocked`는 막힘 표시로 별도 언급 권장.)
   - frontmatter 파싱: `---` 경계 안의 `status:` 키, 값 trim·소문자 비교(따옴표 허용).
   - `log.md`(위키 루트 공용 — 프로젝트별 분리 아님) tail 최근 줄에서 해당 프로젝트 관련 라인.
   - 각 항목에 **최신 시각** 병기(handoff `date:` 또는 log 타임스탬프) — Gemini#2.
6. **요약 출력 형식** (Telegram 친화 — 한국어, 볼드/리스트, 길이제한 — Gemini#3·#5):
   ```
   📊 진행 현황 (6/7 기준)

   *■ best-consulting-hp* (오늘)
   최근: <log tail 핵심 1줄>
   다음:
   - <carry 1>
   - <carry 2>
   - <carry 3>   ← 최대 3개

   *■ StarFollow* (3일 전)
   최근: …
   다음: - …
   ```
   - 프로젝트당 핵심 3줄 내외, 전체 스크롤 2회 이내. carry 최대 3개(초과 시 "외 N건").
7. **빈 결과(Empty State) 처리** (Gemini#4) — 활성 handoff 없으면 기계적 "없음" 대신: `"활성 태스크가 없습니다. 모든 carry가 완료됐는지 확인이 필요합니다."`
8. **없는 프로젝트 질문 처리** (Codex#8 V4b) — 질문의 프로젝트명이 `projects/`에 없으면 오류 대신 후보 목록 제시: `"'<X>' 프로젝트를 못 찾았습니다. 현재: best-consulting-hp, StarFollow"`.
9. **실패 메시지** (Codex#8 V7) — LLM/네트워크 오류(402 잔액/timeout/tool error) 시 한국어 안내: `"보고 생성 중 오류가 발생했습니다(<사유>). 잠시 후 다시 시도해 주세요."`
10. **읽기 전용 mandate** — 위키 파일 수정·생성 절대 금지를 SKILL.md 본문에 명시(설계상 read-only, §1 참조).

### SKILL.md frontmatter — description은 folded block (Codex#2)

YAML 파서 호환을 위해 multi-line이 아닌 folded block scalar(`>`) 사용:
```yaml
description: >
  위키(Obsidian) 진행상황 보고. '진행 어때', '현황', '뭐 했나', '요즘 어때',
  '다음 할 일', '밀린 일', '남은 거', 'carry', '미해결', 'progress', 'status',
  특정 프로젝트명 단독 질문('StarFollow는?') 시 발동. BestConsulting_OS 위키의
  프로젝트별 최근 작업 + 다음 carry를 요약해 한국어로 답한다.
```
- 트리거 확장(Gemini#1): "요즘 어때", "밀린 일", "남은 거", "보고해", 프로젝트명 단독.

### references/wiki-layout.md

위키 폴더 규약을 적어 LLM이 구조를 추측하지 않게 한다 (status 실측 반영):
- `wiki/projects/{name}/{decisions,errors,design,dev-tasks,handoffs}` (project > category) + 위키 루트 공용 `log.md`
- handoff frontmatter 키: `type / project / date / status / author / refs`
- status 표준값(실측): `draft / active / superseded / todo / in-progress / done / reviewed / blocked` — **진행요약 대상 = active·todo·in-progress** / blocked는 별도 표시
- `handoffs/reviews/` = 검증보고서(진행요약 제외)
- `log.md` 형식: `## [YYYY-MM-DD HH:mm] command | summary | linked files`
- 위키링크 `[[name]]` 규약 / 경로는 항상 quote(공백·한글 — Codex#7)

### 라우팅 규칙 — 기본안으로 격상 (Codex#1 + Gemini#1)

v1의 "선택"에서 **기본 포함**으로 변경. skill description만으로는 짧은 한국어 발화에 자발 발동이 보장 안 되므로, 구현 시 `~/.hermes/SOUL.md`(또는 config rule)에 처음부터 1줄 추가:
> "한국어 진행/현황/carry/다음 할 일/프로젝트명 질문은 wiki-progress-report skill을 우선 사용한다."

---

## 4. 검증 방법

**원칙**: 메모리 `feedback_no_inference_verify_data` 준수 — "skill 등록됨"으로 끝내지 않고 **실제 대표 봇 왕복으로 발동·내용 정확성을 실측**한다. gateway 검증 시 Claude의 getUpdates 직접 호출 금지(polling 409 충돌) — 대표 직접 왕복.

| 단계 | 방법 | 통과 기준 |
|---|---|---|
| **V0 reload (Codex#3)** | skill 설치 후 gateway reload/재시작 + registry 반영 | gateway가 사용하는 registry에 skill 보임 |
| V1 skill 인식 | `hermes skills list` + **`hermes skills inspect wiki-progress-report`** | enabled + frontmatter(description/metadata) 파싱 성공 |
| V2 경로 접근 (Codex#7) | **gateway 실행 사용자**(systemd service HOME 기준) `ls "$WIKI/wiki/projects/"` | best-consulting-hp, StarFollow 발견 (CLI 사용자 ≠ service 사용자 가능성 확인) |
| V3 발동 (실측) | 대표가 봇에 "진행 어때?" | skill 발동 → 위키 읽고 답장 |
| **V3b 유사발화 (Codex#8)** | "현황 정리해줘" / "다음에 뭐 해야 해?" / "StarFollow 진행상황" / "전체 carry만" 5종 | 5개 중 다수 발동 (라우팅 규칙 효과 확인) |
| V4 내용 정확성 | 답장 vs 실제 위키 대조 | 최근 작업 + carry가 위키와 일치 (status active/todo/in-progress 반영) |
| **V4b 없는 프로젝트** | 대표가 "Foo 진행상황" (없는 이름) | 오류 대신 후보 목록 제시 |
| V5 프로젝트 지정 | 대표가 "best-consulting 현황만" | 해당 프로젝트만 상세 |
| V6 읽기 전용 | 검증 후 위키 dirty 확인 | 위키 파일 변경 0 |
| **V6b 사후 변경 (Codex#4)** | skill 실행 전/후 `find "$WIKI" -type f -newermt` 또는 timestamp 비교 | 변경된 파일 0 (강제 증명) |
| **V7 실패 메시지 (Codex#8)** | OpenRouter 잔액 0 또는 timeout 유도 | 한국어 실패 안내 출력(크래시 X) |

### 실패 시 분기

- V0 미반영 → gateway 재시작 명령 확인(systemd `systemctl --user restart hermes-gateway`) 후 재시도.
- V3/V3b 발동 약함 → SOUL.md 라우팅 규칙 강화(이미 기본 포함) + description 트리거 추가.
- V4 내용 부정확 → SKILL.md 절차/출력 형식/status 필터 수정.
- ⚠️ 봇 응답엔 OpenRouter 잔액 필요(소진 시 402) — V3 전 잔액 확인.
- ⚠️ gateway 검증 시 Claude의 getUpdates 직접 호출 금지(polling 409) — 대표 직접 왕복 (Codex#9 확인).

---

## 5. 산출물

- **repo**: 본 spec (`docs/superpowers/specs/2026-06-07-c2-wiki-progress-report-design.md`) + plan (`docs/superpowers/plans/2026-06-07-c2-wiki-progress-report.md`).
- **WSL(repo 밖)**: `~/.hermes/skills/devops/wiki-progress-report/{SKILL.md, references/wiki-layout.md}`.
- **위키**: `dev-tasks/c2-wiki-progress-report-20260607.md`(완료 기록) + 핸드오프 갱신 + `log.md` 한 줄.

---

## 6. 실측 확인 사항 (설계 근거)

- `hermes send -t telegram -f PATH` — LLM 없이 파일/stdin Telegram 전송 (정기 push 후속 carry용 재료, C2 범위 밖).
- `hermes cron create` — 정기 작업 (후속 carry용).
- `hermes skills list/install` — skill 레지스트리 + 로컬 skill 관리. 로컬 skill = `~/.hermes/skills/{category}/{name}/SKILL.md`.
- builtin skill(dogfood) 구조 실측: frontmatter(`name/description/version/platforms/metadata.hermes.tags`) + 본문 + `references/`·`templates/`.
- WSL `bestconsulting` 사용자에서 OneDrive 위키 경로 `/mnt/c/.../BestConsulting_OS/wiki/` 접근 OK (C1 V8 확인).
- gateway 상시구동(R6) — 재부팅 후 `hermes-gateway = active` / `Linger=yes` 실측.

---

## 7. carry (C2 이후)

- **정기 push (cron + hermes send)** — 매일 정해진 시각 위키 요약 자동 전송. `hermes cron create` + skill 또는 LLM 없는 `hermes send`. (현재 on-demand로 충분 — 필요 시 추가.)
- **R7 고정 메뉴 버튼** / **R8 Daily Digest** (C cycle 후속).
- **C3 대시보드** (미착수).
