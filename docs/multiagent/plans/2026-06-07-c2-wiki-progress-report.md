# C2 위키 진행상황 on-demand 보고 (Hermes Skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대표가 Telegram 봇(@myroyalaibot)에게 한국어로 "진행 어때?"라 물으면 Hermes가 OneDrive 위키를 읽어 프로젝트별 진행 요약을 답하는 on-demand 보고 기능을 구축한다.

**Architecture:** 추가 인프라 0 — R6로 상시구동 중인 Hermes gateway(claude-sonnet via OpenRouter)에 로컬 skill 1개(`wiki-progress-report`) + SOUL.md 라우팅 1줄을 추가. skill은 WSL `/mnt/c/.../BestConsulting_OS/wiki/`를 read-only로 읽어 요약. 산출물은 repo 코드가 아닌 **WSL 파일 + 위키 문서**.

**Tech Stack:** Hermes Agent v0.16.0 (WSL2 Ubuntu, 사용자 `bestconsulting`), SKILL.md(Claude-style frontmatter), Telegram gateway, OpenRouter.

> ⚠️ **이 plan의 특수성**: 산출물이 WSL 파일이고 검증이 **봇 왕복 실측**이라, 단위 테스트(TDD) 대신 **단계별 실측 검증(V0~V7, spec §4)**을 사용한다. 각 Task의 "검증" 단계가 TDD의 test 역할.
> ⚠️ **메모리 준수**: `feedback_no_inference_verify_data`(실측), `feedback_windows_hook_command_format`(WSL 명령 형식), `feedback_commit_includes_push`(commit=push).
> ⚠️ **WSL 명령 형식**: `wsl.exe -d Ubuntu -u bestconsulting -- sh -c '...'`. 위키 경로는 항상 quote(공백 포함).
> ⚠️ **secret 출력 금지**(§15-7.5) — 이 작업엔 secret 미관여(읽기 전용 위키만).

**기준 사실 (실측):**
- skill 경로: `/home/bestconsulting/.hermes/skills/{category}/{name}/SKILL.md` + `references/`
- 위키 경로(WSL): `/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS/wiki/`
- gateway 서비스: `hermes-gateway` (systemd --user, R6 active)
- SOUL.md: `/home/bestconsulting/.hermes/SOUL.md` (기본 페르소나만 — append 대상, 덮어쓰기 금지)
- handoff status 표준값: `draft/active/superseded/todo/in-progress/done/reviewed/blocked` — 진행요약 = `active`+`todo`+`in-progress`
- 현재 프로젝트: best-consulting-hp, StarFollow

---

## File Structure

| 파일 | 위치 | 책임 |
|---|---|---|
| `SKILL.md` | WSL `~/.hermes/skills/devops/wiki-progress-report/` | frontmatter(트리거 description) + 보고 절차 가이드 |
| `wiki-layout.md` | WSL 동 폴더 `references/` | 위키 디렉토리 규약·status 값·경로 (LLM 추측 방지) |
| `SOUL.md` (append) | WSL `~/.hermes/` | 라우팅 1줄 (한국어 진행질문 → skill 우선) |
| `c2-wiki-progress-report-20260607.md` | 위키 `dev-tasks/` | 완료 기록 |
| 핸드오프 갱신 + `log.md` | 위키 | C2 완료 반영 |

repo 변경은 spec/plan 문서뿐 (이미 commit). WSL 파일은 repo 밖이라 git 추적 안 됨 — 내용을 plan과 완료 기록에 보존.

---

## Task 1: SKILL.md 작성 (트리거 description + 보고 절차)

**Files:**
- Create: WSL `/home/bestconsulting/.hermes/skills/devops/wiki-progress-report/SKILL.md`

- [ ] **Step 1: skill 디렉토리 생성**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'mkdir -p /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/references && echo CREATED'
```
Expected: `CREATED`

- [ ] **Step 2: SKILL.md 작성**

Windows 측에서 작성해 WSL 경로로 직접 쓴다(`/mnt/c` 우회 — WSL 홈은 `\\wsl$` 또는 `wsl ... tee`). 안전하게 heredoc + tee 사용:

```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'cat > /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/SKILL.md << "SKILLEOF"
---
name: wiki-progress-report
description: >
  위키(Obsidian) 진행상황 보고. "진행 어때", "현황", "뭐 했나", "요즘 어때",
  "다음 할 일", "밀린 일", "남은 거", "보고해", "carry", "미해결", "progress",
  "status", 특정 프로젝트명 단독 질문("StarFollow는?") 시 발동. BestConsulting_OS
  위키의 프로젝트별 최근 작업과 다음 carry를 요약해 한국어로 답한다.
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [wiki, progress, report, monitoring, korean]
    related_skills: []
---

# 위키 진행상황 보고 (wiki-progress-report)

## 목적
대표가 한국어로 진행/현황/carry를 물으면, OneDrive 위키를 **읽기 전용**으로 읽어
프로젝트별 최근 작업 + 다음 할 일(carry)을 Telegram 친화 한국어로 요약한다.

## 절대 규칙
- 위키 파일을 **수정·생성·삭제하지 않는다** (read만).
- 경로는 항상 큰따옴표로 감싼다 (공백·한글 포함).
- 추측 금지 — 실제 디렉토리/파일을 ls·read 한 결과로만 답한다.

## 절차
1. WIKI="/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS"
2. 프로젝트 발견: ls "$WIKI/wiki/projects/" 의 디렉토리 목록.
   - 프로젝트 인정 기준(모두 만족): 디렉토리이고, "$WIKI/wiki/projects/<p>/_index.md" 존재하고,
     "handoffs/" 폴더 또는 위키 루트 "log.md" 참조 가능.
   - "_" 또는 "." 로 시작하는 폴더, 깨진 폴더는 스킵.
3. 범위 판단: 질문에 특정 프로젝트명이 있으면 그 프로젝트만 상세, 없으면 전체 요약.
4. 프로젝트별로 읽기:
   - "$WIKI/wiki/projects/<p>/handoffs/" 직속 *.md (reviews/ 하위는 검증보고서이므로 제외).
   - 각 파일 앞부분 frontmatter("---" 경계 안)의 status: 값을 본다.
     진행요약 대상 = status 가 active / todo / in-progress 중 하나.
     (done/superseded/draft/reviewed 는 제외. blocked 는 "막힘"으로 별도 표시.)
   - 대상 핸드오프에서 "다음 우선 / carry / 미해결 / Next / TODO" 류 섹션의 핵심 항목 추출.
   - 위키 루트 "$WIKI/log.md" 마지막 줄들에서 해당 프로젝트 관련 최근 작업 1줄.
   - 최신 시각 병기: 핸드오프 frontmatter 의 date: 또는 log 타임스탬프로 "(오늘)/(N일 전)/(M/D)".
5. 출력 형식 (Telegram, 한국어, 볼드+리스트, 짧게):

   📊 진행 현황 (M/D 기준)

   *■ best-consulting-hp* (오늘)
   최근: <log 핵심 1줄>
   다음:
   - <carry 1>
   - <carry 2>
   - <carry 3>

   *■ StarFollow* (N일 전)
   최근: ...
   다음: - ...

   - 프로젝트당 핵심 3줄 내외. carry 최대 3개(초과 시 "외 N건"). 전체 스크롤 2회 이내.
6. 빈 결과: 활성(active/todo/in-progress) 핸드오프가 없으면 →
   "현재 활성화된 태스크가 없습니다. 모든 carry가 완료됐는지 확인이 필요합니다."
7. 없는 프로젝트: 질문의 이름이 projects/ 에 없으면 오류 대신 →
   "<이름> 프로젝트를 못 찾았습니다. 현재: <발견된 프로젝트 목록>"
8. 실패(파일 접근/네트워크): 크래시 대신 →
   "보고 생성 중 오류가 발생했습니다(<사유>). 잠시 후 다시 시도해 주세요."
SKILLEOF
echo WROTE'
```
Expected: `WROTE`

- [ ] **Step 3: 작성 검증 (frontmatter + 절차 존재)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'head -16 /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/SKILL.md; echo "---LINES---"; wc -l /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/SKILL.md'
```
Expected: frontmatter(name/description/version/platforms/metadata) 출력 + 50줄 이상.

- [ ] **Step 4: 위키 핸드오프에 진행 기록 (commit 대신 위키 log)**

이 단계는 repo commit이 아니라 위키 `log.md`에 한 줄. (WSL 파일은 git 밖이므로 commit 없음 — Task 5에서 위키 일괄 기록.)
→ 본 Task는 파일 작성만, 기록은 Task 5에 통합. 다음 Task로 진행.

---

## Task 2: references/wiki-layout.md 작성 (위키 규약 — LLM 추측 방지)

**Files:**
- Create: WSL `~/.hermes/skills/devops/wiki-progress-report/references/wiki-layout.md`

- [ ] **Step 1: wiki-layout.md 작성**

```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'cat > /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/references/wiki-layout.md << "LAYOUTEOF"
# 위키 디렉토리 규약 (wiki-progress-report 참조)

WIKI 루트: /mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS

## 구조
- wiki/projects/{프로젝트명}/{decisions,errors,design,dev-tasks,handoffs}/
- wiki/projects/{프로젝트명}/_index.md   (프로젝트 개요)
- log.md   (위키 루트 공용 작업 로그 — 프로젝트별 분리 아님)

## handoff frontmatter
- 키: type / project / date / status / author / refs
- status 표준값: draft, active, superseded, todo, in-progress, done, reviewed, blocked
- 진행요약 대상: active, todo, in-progress (done/superseded/draft/reviewed 제외, blocked 별도 표시)
- handoffs/reviews/ 는 AI 검증보고서 — 진행요약에서 제외

## log.md 형식
## [YYYY-MM-DD HH:mm] command | summary | linked files

## 표기
- 위키링크: [[name]]
- 경로는 항상 큰따옴표 (공백·한글 포함)
LAYOUTEOF
echo WROTE'
```
Expected: `WROTE`

- [ ] **Step 2: 검증**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'cat /home/bestconsulting/.hermes/skills/devops/wiki-progress-report/references/wiki-layout.md | grep -c "status\|projects\|log.md"'
```
Expected: 3 이상 (키워드 존재 확인).

---

## Task 3: SOUL.md 라우팅 규칙 append (발동 신뢰성 — Codex#1)

**Files:**
- Modify: WSL `~/.hermes/SOUL.md` (append only — 기존 페르소나 보존)

- [ ] **Step 1: 현재 SOUL.md 백업**

```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'cp /home/bestconsulting/.hermes/SOUL.md /home/bestconsulting/.hermes/SOUL.md.bak-c2 && echo BACKED'
```
Expected: `BACKED`

- [ ] **Step 2: 라우팅 1줄 append (덮어쓰기 아님)**

```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'printf "\n\n## 위키 진행 보고 라우팅\n한국어로 진행/현황/carry/다음 할 일/밀린 일/프로젝트명 질문을 받으면 wiki-progress-report skill 을 우선 사용한다.\n" >> /home/bestconsulting/.hermes/SOUL.md && echo APPENDED'
```
Expected: `APPENDED`

- [ ] **Step 3: 검증 (기존 페르소나 보존 + 라우팅 추가 둘 다)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'grep -c "Hermes Agent" /home/bestconsulting/.hermes/SOUL.md; grep -c "wiki-progress-report" /home/bestconsulting/.hermes/SOUL.md'
```
Expected: 각각 `1` (페르소나 1 + 라우팅 1 — 둘 다 존재).

---

## Task 4: skill 로딩 + gateway 재시작 검증 (V0·V1·V2 — Codex#3·#7)

**Files:** (없음 — 검증 단계)

- [ ] **Step 1: skill 인식 (V1)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes skills list 2>&1 | grep -i wiki-progress-report'
```
Expected: `wiki-progress-report` 행 출력 (enabled). 안 보이면 → Step 2 reload.

- [ ] **Step 2: frontmatter 파싱 확인 (V1 — Codex#2)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes skills inspect wiki-progress-report 2>&1 | head -12'
```
Expected: description/tags 정상 출력 (YAML 파싱 성공). 오류 시 → SKILL.md frontmatter 수정.

- [ ] **Step 3: gateway 재시작 (V0 — skill 반영)**

```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'systemctl --user restart hermes-gateway && sleep 5 && systemctl --user is-active hermes-gateway'
```
Expected: `active` (재시작 후 살아있음 — skill registry 갱신).

- [ ] **Step 4: gateway 사용자 기준 위키 read 확인 (V2 — Codex#7)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'ls "/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS/wiki/projects/" 2>&1'
```
Expected: `best-consulting-hp`, `StarFollow` 디렉토리 출력 (gateway 사용자 = `bestconsulting` 동일).

---

## Task 5: 위키 완료 기록 (dev-tasks + 핸드오프 + log)

**Files:**
- Create: 위키 `wiki/projects/best-consulting-hp/dev-tasks/c2-wiki-progress-report-20260607.md`
- Modify: 위키 핸드오프 `SESSION-HANDOFF-c1-r6-c2-20260607.md` (C2 상태 갱신)
- Modify: 위키 `log.md` (한 줄)

- [ ] **Step 1: dev-task 완료 기록 작성**

Windows Write 도구로 `C:\Users\user\OneDrive\Documents\BestConsulting_OS\wiki\projects\best-consulting-hp\dev-tasks\c2-wiki-progress-report-20260607.md` 생성. frontmatter(type: dev-task / status: done / date / refs) + 결과(skill 경로·SOUL 라우팅·검증 V0~V7 결과) + SKILL.md 전문 보존(WSL은 git 밖이라 위키가 백업).

- [ ] **Step 2: 핸드오프 C2 섹션 갱신**

`SESSION-HANDOFF-c1-r6-c2-20260607.md`의 "### C2 ... ◐ 착수" → "✅ 완료"로, 구현 결과 1줄 + carry(정기 push) 갱신.

- [ ] **Step 3: log.md 한 줄 추가**

`## [2026-06-07] save | C2 위키 진행보고 skill 구축 (wiki-progress-report + SOUL 라우팅) | [[c2-wiki-progress-report-20260607]]`

- [ ] **Step 4: 검증 (3 파일 반영)**

Run:
```bash
ls "C:/Users/user/OneDrive/Documents/BestConsulting_OS/wiki/projects/best-consulting-hp/dev-tasks/c2-wiki-progress-report-20260607.md" && grep -c "C2.*완료\|wiki-progress-report" "C:/Users/user/OneDrive/Documents/BestConsulting_OS/wiki/projects/best-consulting-hp/handoffs/SESSION-HANDOFF-c1-r6-c2-20260607.md"
```
Expected: 파일 경로 출력 + grep ≥ 1.

---

## Task 6: 봇 왕복 실측 (V3·V3b·V4·V4b·V5·V6·V6b·V7 — 대표 직접)

**Files:** (없음 — 대표 실측 검증)

> ⚠️ gateway 검증 시 Claude의 getUpdates 직접 호출 금지(polling 409, Codex#9). **대표가 Telegram에서 직접 왕복**. OpenRouter 잔액 필요(소진 시 402) — 사전 확인.

- [ ] **Step 1: V6b 사전 timestamp 스냅샷 (읽기전용 증명 준비)**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'find "/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS/wiki" -type f -name "*.md" -printf "%T@ %p\n" 2>/dev/null | sort > /tmp/wiki_before.txt; wc -l /tmp/wiki_before.txt'
```
Expected: 파일 수 출력 (사후 비교용 baseline).

- [ ] **Step 2: V3 발동 (대표) — "진행 어때?"**

대표가 봇에 "진행 어때?" 전송.
Expected: 📊 진행 현황 형식 + best-consulting-hp/StarFollow 요약 답장.

- [ ] **Step 3: V3b 유사발화 5종 (대표)**

"현황 정리해줘" / "다음에 뭐 해야 해?" / "StarFollow 진행상황" / "전체 carry만" / "요즘 어때?"
Expected: 다수(≥4/5) skill 발동. 미발동 多 → Task 3 라우팅/description 강화 후 재시도.

- [ ] **Step 4: V4 내용 정확성 (대표+Claude 대조)**

답장 내용 vs 실제 위키(handoff active carry) 대조.
Expected: 최근 작업 + carry가 위키와 일치. 타임스탬프 표시됨.

- [ ] **Step 5: V4b 없는 프로젝트 (대표) — "Foo 진행상황"**

Expected: 오류 대신 "Foo 못 찾음, 현재: best-consulting-hp, StarFollow".

- [ ] **Step 6: V5 프로젝트 지정 (대표) — "best-consulting 현황만"**

Expected: best-consulting-hp만 상세.

- [ ] **Step 7: V6+V6b 읽기전용 사후 검증**

Run:
```bash
wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'find "/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS/wiki" -type f -name "*.md" -printf "%T@ %p\n" 2>/dev/null | sort > /tmp/wiki_after.txt; diff /tmp/wiki_before.txt /tmp/wiki_after.txt && echo "NO_CHANGE" || echo "CHANGED!"'
```
Expected: `NO_CHANGE` (Task 5 위키 기록은 이 스냅샷 전에 완료됨 — skill 실행만으로는 위키 무변경 증명).

- [ ] **Step 8: V7 실패 메시지 (선택, 잔액 0/timeout 유도 시)**

Expected: 한국어 실패 안내 출력, 크래시 없음. (잔액 충분 시 생략 가능 — carry.)

---

## Self-Review (작성 후 점검)

- **Spec 커버리지**: spec §3 절차 1~10 → Task1 SKILL.md / §3 references → Task2 / §3 라우팅 → Task3 / §4 V0·V1·V2 → Task4 / §4 V3~V7 → Task6 / §5 산출물 → Task5. ✅ 전부 매핑.
- **Placeholder**: 모든 Step에 실제 명령·내용 포함. SKILL.md/wiki-layout.md/SOUL append 전문 박음. ✅
- **타입/이름 일관성**: skill명 `wiki-progress-report` 전 Task 동일 / 경로 `~/.hermes/skills/devops/wiki-progress-report/` 동일 / status 값 `active/todo/in-progress` 동일. ✅
- **검증 매핑**: V0(Task4-3) V1(Task4-1,2) V2(Task4-4) V3(Task6-2) V3b(Task6-3) V4(Task6-4) V4b(Task6-5) V5(Task6-6) V6/V6b(Task6-7) V7(Task6-8). ✅

---

## Execution 주의

- **WSL 파일은 git 밖** — commit 없음. 대신 위키 dev-task에 SKILL.md 전문 백업(Task 5).
- **봇 실측(Task 6)은 대표 직접** — Claude는 getUpdates 호출 금지.
- **메모리 준수**: 실측(추측 금지), WSL 명령 형식, 경로 quote.
- carry: 정기 push(cron+hermes send) / V7 잔액테스트 / Obsidian deep link(Gemini#5 선택).
