# C5-0a-ext 실행계획 — Bash T0/T1 자율 실행 (비전 ④ "ask 상시개입 해소")

> MAIA 자율화의 핵심 목적: 대표가 PC 앞 상시 모니터링 없이 자율작업. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.C/비전④ + 대표 승인 2026-06-11(옵션 A: 균형 자율 + denylist 강화).
> - 날짜: 2026-06-11 / 작성: claude / 버전: **v3 (L2 2라운드 반영 — download-exec·tee/sed rc·대화형 교착 차단) · 라이브 가동**
> - 선행: C5-0a(Decision Gate)·C5-1a(L2 엔진)·C5-0b(commit allow). SSOT: `~/.ai-bootstrap/decision-policy.json` + `~/.claude/hooks/pre-risk-classify.js`.

## 0. 문제 (진단)
- 현 hook: 쓰기(Edit/Write) T0/T1=allow(자율) / **Bash T0/T1=passthrough**(결정 안 함) → settings allowlist(prefix 매칭 13패턴)로 위임.
- prefix 매칭은 **복합명령(`&&`/`;`/파이프)을 못 잡음**(글로벌 §7 한계 명시) → 실측 오늘 Bash passthrough 72건 중 **51건이 복합 → 모달**.
- 결과: 정책표는 "T1=자율"인데 **Bash만 자율이 아님** → 수시 모달 → 자율작업 불성립(MAIA 존재이유 훼손).

## 1. 목표 / 비목표
- **목표**: hook이 **Bash T0/T1도 `allow` 방출** → 비위험 Bash(복합·신규 포함) 전부 자율, 모달은 T2(ask)·T3/DENY에만. 쓰기와 동일 정책으로 통일.
- **안전 전제(필수)**: T1 자율 허용 시 분류 안 된 위험명령이 무프롬프트 실행되는 footgun → denylist/T2 강화로 차단(가산적·먼저 라이브).
- **비목표**: T2(commit-비feat/install/migration/mv/sudo/kill/eval/npx) 자율화(유지=ask) / push allow(C5-0c) / 임의 로컬 인터프리터(`node -e`,`python -c`) 차단(에이전트 자기 도구사용이라 허용, footgun은 외부코드 벡터에 한정).

## 2. 메커니즘
### 훅 (`pre-risk-classify.js`)
- T3/DENY→deny / T2→ask / **그 외(T0/T1, 쓰기·Bash 공통)→allow**. (종전 `else if(isWrite)allow; else passthrough` → `else allow`.)
### 정책 강화 (`decision-policy.json`) — 가산적, 먼저 라이브
- **denylist 추가(DENY)**: `pipe-to-shell`(curl/wget/fetch | sh|bash|python|perl|ruby|node|php — 중간 `tee`/`base64 -d` 체인도 greedy 매칭으로 포함), `shell-procsubst`(`sh <(…)`/`source <(…)`), `shell-rc-write`(`>>~/.bashrc`·`/etc/`·`~/.ssh/`·authorized_keys), `forkbomb`, **`curl-subst`(`$(curl …)`/백틱 — 명령치환 RCE 벡터, L2 지적 반영)**.
- **commandRules 추가(T2 ask)**: `sudo`/`doas`, `kill`/`pkill`/`killall`, `eval`, `npx`/`bunx`/**`pnpm dlx`/`yarn dlx`**(L2 지적)/`pipx run`.
- 기존 DENY(rm-rf·secret·force-push·external-send·fs-destructive)·T2(commit/install/migration/infra/bulk-edit/mv)·T3(push/merge) 불변.

## 3. 안전 분석
- **★ default-allow = blocklist 모델 (L2 BLOCKER `36131b8e`, 대표 수용)**: `else allow`는 미분류 명령을 자율 실행하므로 안전성이 **denylist 완전성에 의존**(본질적 한계). 대표가 옵션 A(균형 자율)를 명시 선택 — 자율성 우선, 위험은 denylist+T2로 차단, 잔여는 audit 측정으로 보완. 완전 default-deny(옵션 C)는 복합명령 모달 잔존으로 자율 목적 훼손이라 기각. **본 모델은 "에이전트의 양성 자기 도구사용"을 신뢰하고, 외부 유입 코드·파괴·영속화·권한 벡터만 차단**하는 전제.
- **남는 자율 footgun(수용)**: 로컬 인터프리터(`node -e`/`python -c`)·임의 바이너리는 T1 자율 — 에이전트 자기 도구사용 신뢰. 외부코드 유입(pipe-to-shell/procsubst/`$(curl)`)·영속화(shell-rc)·권한(sudo)·파괴(rm-rf/fs)·종료(kill)는 차단/ask.
- **측정-우선**: 모든 결정 audit(`risk-*.jsonl`). 자율 allow 비율·위험 allow 오탐을 `maia-audit --summary`로 사후 점검 → 필요 시 denylist 추가(json 1줄).
- **롤백 + OOB 복구 (L2 `f7f66f5e`)**: 정상 롤백 = hook `else allow`→`else if(isWrite)allow; else passthrough` 1줄 환원(loadPolicy 캐시 없음, 즉시). **환경 훼손으로 에이전트가 롤백조차 못 할 때 OOB(Out-of-Band) 수동복구**: 인간이 외부 에디터로 ① `~/.claude/settings.json`의 PreToolUse 항목 제거(게이트 무력화) 또는 ② `~/.claude/hooks/pre-risk-classify.js` 직접 수정. WSL 밖(Windows) 파일 편집으로도 가능 — Claude 세션 의존 없음.
- **과탐 방향**: 의심 시 게이트(ask), 비가역은 DENY. 자율은 비위험에 한정.

## 4. 검증 계획
- 분류기 golden(82 통과): curl|sh·procsubst·shell-rc·forkbomb→DENY / sudo·kill·eval·npx→T2 / **ls&&cat·grep|head·node -e·chmod +x·plain curl·pnpm build→T1(자율)**.
- 훅 E2E: 복합 read→allow / sudo→ask / curl|sh→deny.
- 우회 케이스(테스트 88 통과): `curl|tee|sh`·`curl|base64 -d|sh`·`$(curl)`·백틱curl→DENY / `pnpm dlx`·`yarn dlx`→T2.

## 4.1 L2 검증 결과 (dogfounding — 2026-06-11)
- **L2-1**: codex parser-fail → overall **incomplete**(false-pass 가드 정상). gemini 4건. 반영: dlx(`a6a27a79`)·`$(curl)`(`43508362`) 차단, OOB 롤백(`f7f66f5e`).
- **L2-2**: codex 4 + gemini 3(양쪽 파싱). **반영**: download-then-exec `curl -o x && ./x`(`450a8e31`/`3eed2fb8`) DENY / `> ~/.bashrc`·`tee -a`·`sed -i` rc우회(`0a5f1ba9`) DENY 확장 / **대화형 교착 vim·tail -f·ssh·less(`08a1bb32`) T2**(자동허용이 hang→자율훼손이라 게이트). 원자배포(`ed5dacbe`)=정책先·hook後 순서+분류기오류=passthrough로 처리(§3).
- **수용된 본질 한계(blocklist 모델, 대표 옵션 A)**: 사전게이트 부재·실시간 알림 부재(`0bdf7a66`/`1b0f9a71`, escalate) — DENY는 차단하나 미분류 위험명령은 사전차단 없음. 다단계 RCE(별도 호출 download→exec)·임의 `node -e`는 차단 불가. audit 사후측정 + DENY 차단 + OOB 롤백이 보완. **실시간 알림은 후속 과제**.
- **L2-3 (최종)**: codex 4 + gemini 4. **실 결함 2건 반영**: download-exec 분리자 `;`/`||`/newline 확대(`f7df11e6`), dev서버/REPL 교착(`pnpm dev`·bare `node`/`python`·http.server) interactive 확장(`8f9a79f9`/`cd7a5ba6`). **검토자 오판 2건**(테스트로 반증): curl|tee|sh는 greedy로 이미 차단(`659c4812`), zshrc/profile은 이미 정규식 포함(`58b29976`). **본질 한계(수용)**: 분류기오류=passthrough=모달(allow-all 아님, fail-safe쪽 — `f23ebf5b` 명료화), background `&` 데몬(`cc7c553f` suggest).
- **L2 수렴 종료**: 3라운드로 실 구현결함 소진. 잔여는 blocklist default-allow의 **원리적 미완전성**(novel 명령·다단계 RCE·임의 `node -e`) = 옵션 A 수용 위험. blocklist는 완전해질 수 없어 추가 라운드는 whack-a-mole. audit 사후측정 + DENY 사전차단 + OOB 롤백이 보완선.
- 테스트 **109 통과**. E2E: 복합read/node -e/build→allow, sudo/vim/pnpm dev/bare REPL→ask, curl|sh/download-exec/rm-rf/push→deny.

## 5. 관련
- 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.C/비전④ / 선행 [[c5-0a-decision-gate-ask-resolution-20260611]] / [[c5-0b-commit-allow-plan]]
