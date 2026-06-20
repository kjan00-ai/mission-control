---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료 — P1·P2·P4 / P3 의도적 스킵)
track: L2-AVAIL (독립 트랙 — C6 선행)
status: implemented (P1+P2+P4)
l2_ref: "[[2026-06-21-l2-engine-availability-spec-l2-deepen-r2-20260621-045822]]"
impl:
  P1: "done — l2-loop wslOnly→shared, Windows 네이티브 codex+gemini 실증 (ai-bootstrap 6126b97)"
  P2: "done — l2-launch detached 런처, 브리지/네이티브 폴백 양경로 실증 (455669a)"
  P3: "skipped — P2 즉시 네이티브 폴백이 24h-드롭 우려를 흡수. 둘다실패 희귀케이스는 기존 24h 재시도가 백스톱"
  P4: "done — maia-wsl-healthwatch.js + Windows 스케줄(15m) + hermes-free Telegram, 실발송 검증 (44861ed)"
known_gap: "~/.claude/hooks 는 git 미추적 → post-task-l2.js 변경은 라이브+배포본엔 있으나 git 이력엔 없음(MAIA 인프라 기존 갭, 본 트랙 무관)"
---

# L2 엔진 가용성 — WSL 단일의존 제거 (독립 트랙, C6 선행)

> **문제**: MAIA L2 검증 엔진(`l2-loop.js`)·codex·gemini·hermes가 전부 WSL에 거주한다. BC/SF 등 Windows 네이티브 프로젝트는 Stop 훅이 `wsl.exe`로 WSL의 l2-loop을 **브리지** 호출해 L2를 돌린다. **WSL이 완전히 죽으면(부팅 실패·24h+ 지속 다운) BC/SF의 L2는 auto·inline·동기 전부 불가**하며, 미검증 산출물은 24h 룩백 창에서 노화돼 조용히 소실된다. 단일 의존점에 폴백이 없다.
>
> - 선행 분석: 2026-06-21 세션 검증 — Decision Gate(C5-0a)는 Windows 로컬 node로 enforce(폴백 불요), 그러나 **L2만 WSL 단일거주**. 같은 세션에서 **Windows에 codex·gemini CLI 둘 다 존재** 확인(`codex.ps1`/`gemini.ps1`) + Windows gemini API 키 경로 복구 완료 → Windows 네이티브 L2가 **기술적으로 가능**해짐.
> - 관계: 본 트랙은 **C6와 독립**이며 **C6보다 먼저** 진행한다(대표 지시 2026-06-21). C6 resilience(§3 결과유실 복원력)는 "L2 실패를 *시끄럽게 드러내고 강등*"하는 직교 축으로, **단일의존 제거는 다루지 않는다** → 본 트랙이 그 공백을 메운다.
> - SSOT: 코드/spec=이 repo, 지식/결정=위키 + 위키링크. ★ `[기획결정]` = 미확정.

## 0. 목표 / 비목표

**목표 (이 트랙이 보장하려는 것)**
- G1. **단일의존 제거**: WSL이 죽어도 Windows 네이티브로 L2를 실행할 수 있다(폴백 엔진).
- G2. **무손실**: 미검증 산출물이 24h 노화로 *조용히* 소실되지 않는다(내구 큐 + 명시 에스컬레이션).
- G3. **자기치유**: 일시적 WSL 다운은 자동 부팅·재시도로 복구된다(다운 윈도우 최소화).

**비목표**
- N1. hermes 텔레그램 알림의 Windows 네이티브 이식(WSL 전용 유지 — Windows 폴백 경로에선 알림 **graceful skip**, 결과는 위키/DB에 남으므로 손실 아님).
- N2. C6 E×V 정책 모델 변경(본 트랙은 가용성만, 정책 무관).
- N3. codex/gemini의 Windows 동작 *품질* 동등성 보증(검증은 함, 단 미세 차이는 허용 — 폴백은 "무검증보다 낫다"가 기준).

## 1. 현행 구조 요약 (확인된 사실)

- `post-task-l2.js`(shared): Windows Stop 훅 → `spawn('wsl.exe', ['-d','Ubuntu','--','bash','-lc', 'node <WSL l2-loop> <snap>'])`. l2-loop은 **wslOnly**(매니페스트).
- 무손실 모델: 산출물은 **done-marker 떨굴 때만** `reviewed`. spawn 동기실패→pending 미기록→다음 Stop 재선택. 룩백 **24h 고정창**. → **24h+ 다운 시 영구드롭**(G2 위반).
- WSL 자동부팅: `wsl.exe` 호출이 stopped distro를 깨움(겹1 자기치유 일부 존재). 단 **완전 사망·부팅실패**엔 무력.
- l2-loop WSL 종속 3지점(확인):
  - (a) `sendAlert` → `~/bin/hermes`(WSL 전용).
  - (b) 위키경로 기본값 `/mnt/c/Users/user/OneDrive/...`(WSL 마운트형) — `MAIA_WIKI_ROOT`로 override 가능.
  - (c) reviewer를 `spawn('codex'|'gemini', ...)` bare-name 실행 — Windows는 `.cmd`/`.ps1` 셸 shim이라 `shell:true` 또는 명시 확장자 필요.

## 2. 설계 — 3 레이어

### L3 (코어) Windows 네이티브 폴백 엔진 — G1
`l2-loop.js`를 **플랫폼 포터블**하게 만들어 `wslOnly → shared` 승격. 3 종속지점 처리:
- (a) **hermes 알림 graceful skip**: `process.platform==='win32'` 또는 hermes 부재 시 `sendAlert`를 no-op(로그만). 결과는 위키 reviews + MC DB(durable bus)에 남으므로 **알림 누락 ≠ 검증 누락**.
- (b) **위키경로 플랫폼 인지**: `MAIA_WIKI_ROOT` 미설정 시 win32면 `C:\Users\user\OneDrive\...`(또는 `process.env.USERPROFILE` 기반), 아니면 현행 `/mnt/c/...`. 브리지 경로(WSL서 /mnt/c)와 네이티브 경로(Windows서 C:\)가 **같은 물리폴더**를 가리키도록 보장.
- (c) **reviewer spawn 셸해석**: ★ `shell:true` **금지**(L2 `06605db2`: 동적 산출물경로를 셸에 넘기면 quoting 깨짐·명령주입). 대신 win32에서 **실제 실행파일을 resolve**(`where codex`→`codex.cmd` 절대경로)해 **args 배열로 no-shell spawn**. 인자 이스케이프 불요(셸 미경유). gemini 키주입(오늘 추가분)·`GEMINI_CLI_TRUST_WORKSPACE`는 그대로. codex sandbox 플래그 Windows 동작 검증.

### L2 내구 pending 큐 — G2
`post-task-l2.js`의 무손실을 24h 룩백에서 분리:
- 선택됐으나 미완료(브리지 실패·엔진 부재)인 산출물을 **`state/l2-queue.json`에 내구 기록**(slug/hash/경로/최초시각/attempts/nextEligible). 룩백 창과 무관하게 생존.
- 매 Stop: 큐를 먼저 드레인(완료 done-marker면 제거, 미완이면 §3.2 백오프 따라 재시도). **maxAttempts 초과 → dead-letter 격상**.
- ★ **동시성·내구성(L2 `c5075403`)**: 큐 read-modify-write는 기존 `post-task-l2`의 **atomic hard-link 락(STATE_LOCK)** 임계영역 안에서만(동시 Stop 경쟁 차단). 쓰기는 **tmp+rename 원자치환**. 읽기 손상 시 `{}`로 폴백(기존 `readJson` 의미론) + 손상본 백업. 큐는 STATE와 같은 락 우산 아래 둔다.
- ★ **에스컬레이션 배치(L2 `00be2bc7`)**: dead-letter는 산출물 건별 errors/ 문서를 만들지 않고 **단일 롤링 다이제스트**(`errors/l2-unverified-digest.md`에 append, 일자 섹션)로 통합 — 위키 그래프 폭증 방지.
- 기존 reviewed-hash dedup·45m TTL 의미론 보존(큐는 *추가* 안전망).

### L1 WSL 헬스워치 + 강제부팅 — G3
- Windows 작업스케줄러 주기 태스크(또는 기존 keep-alive 확장): `wsl.exe -d Ubuntu -- true` 헬스핑 → 실패 시 `wsl.exe --distribution Ubuntu` 강제부팅.
- ★ **WSL-down 알림은 hermes 비의존(L2 `d7147485`)**: WSL이 완전 사망하면 hermes(WSL 거주)로는 알릴 수 없으므로, 헬스워치는 **Windows 네이티브 채널로 직접 통지** — Telegram Bot API에 `Invoke-WebRequest`(PowerShell, curl 등가)로 POST(봇토큰·chat_id는 Windows 자격저장). hermes 경로와 독립. → WSL 완전사망도 대표님이 인지.
- 부팅 성공 시 L2 큐 드레인 트리거.

## 3. 실행 정책 — 언제 네이티브 폴백을 쓰나 (L2 v0.2 개정)

> ★ **불변식 보존(L2 blocker `f5cd4544`)**: Stop 훅은 **절대 블록 금지**(NEVER blocks·exit 0·DETACHED+unref). 따라서 헬스핑·부팅·폴백 판정을 **훅 인라인에서 하지 않는다**. 훅은 산출물당 **detached 런처 `l2-launch`를 fire-and-forget**으로 spawn만 하고 즉시 종료한다. 모든 대기성 로직은 런처(별도 프로세스)에서 일어나 인간 워크플로우를 0초 차단한다.

```
Stop 훅(논블록): 산출물 선택 → 각 산출물에 detached l2-launch spawn+unref → exit 0
                  (pending 기록은 spawn 성공 시에만 — 기존 의미론)

l2-launch(detached, 인간 비차단):
  ① wsl.exe 헬스핑(timeout 3s, `wsl.exe -d Ubuntu -- true`)
     OK   → 브리지: WSL l2-loop 실행(hermes 알림 정상)
     FAIL → ② wsl.exe 강제부팅 1회 + 재핑(timeout 3s)
              OK   → 브리지
              FAIL → ③ Windows 네이티브 l2-loop 실행(폴백, hermes 알림 skip)
  완료 시 어느 경로든 **동일 canonical done-key**로 done-marker 떨굼(§3.1)
```

### 3.1 Canonical done-key — 경로정규화 무한루프 차단 (L2 blocker `2287c11f`)
브리지(`/mnt/c/...`)와 네이티브(`C:\...`)가 **같은 물리폴더**를 가리키므로, done-marker는 **경로가 아니라 plataform-independent slug**(이미 dir-hash 기반)로만 키잉한다. 추가 안전장치:
- snapshot·done-dir 경로를 런처가 **한 곳에서 정규화**해 브리지/네이티브에 동일 논리키 전달(브리지는 `toWslPath`, 네이티브는 그대로 — 둘 다 같은 slug).
- reconcile은 slug 매칭만 사용(경로 비교 금지).
- **무한루프 백스톱**: 큐 엔트리에 `attempts`. **maxAttempts(예 5) 초과 → dead-letter로 격상**(재시도 중단·에스컬레이션). 경로버그가 있어도 무한루프 대신 유한 종료.

### 3.2 헬스핑·백오프 파라미터 (L2 `f03cbab4`·`dd8824a7`)
- 헬스핑 timeout **3s**, 강제부팅 재시도 **1회**(런처 내, 인간 비차단).
- 큐 재시도는 **지수 백오프**(`nextEligible = now + base·2^attempts`, base 예 5m, cap 예 6h) → 폴백 환경 자체 결함 시 매 Stop 스팸 방지. attempts 소진 시 dead-letter.

## 4. 단계 (Phasing)

| 단계 | 내용 | 의존 | 비고 |
|---|---|---|---|
| **P1** | L3 l2-loop 포터빌리티((a)(b)(c)) + wslOnly→shared + maia-deploy | 없음 | **단일의존 제거의 핵심**. WSL `--shutdown` 상태서 Windows 네이티브 l2-loop 단독 동작 검증 |
| **P2** | `l2-launch` detached 런처(§3) + post-task-l2가 런처를 spawn하도록 변경 | P1 | 헬스핑→부팅→네이티브 폴백. **훅 논블록 유지**. done-marker 기반(큐 비의존) |
| **P3** | L2 내구 큐 + 백오프 + dead-letter + 배치 다이제스트 | P2 | 24h 영구드롭 제거 = **G2 달성** |
| **P4** | L1 WSL 헬스워치 + Windows 네이티브 알림 | 없음(병행) | 다운 윈도우 축소 + WSL 완전사망 통지 |

★ **MVP 재정의(L2 `5aea6826`)**: G2(무손실)는 P3 큐가 있어야 달성되므로 **MVP = P1+P2+P3**. P2의 런처·폴백은 **done-marker만으로 동작**(큐 비의존)해 P3 전에도 모순 없음 — 큐는 P3에서 *추가*. §3의 "큐 기록" 문구는 P3 적용分. P4는 병행 견고화.

## 5. 검증 계획
- P1: Windows에서 `MAIA_WIKI_ROOT` 세팅 후 `node l2-loop.js <BC샘플산출물>` **단독 실행** → codex∥gemini parser=ok, 위키 reviews 정상 기록, hermes skip 로그 확인. **WSL 완전 종료(`wsl --shutdown`) 상태에서** Windows 네이티브 L2가 도는지 실측.
- P2: WSL down 시뮬레이션(헬스핑 강제 FAIL) → 폴백 경로 진입 + done-marker 정상.
- P3: 산출물 변경 후 WSL 24h+ down 시뮬 → 큐 생존 + 에스컬레이션 발화(드롭 0).
- maia-deploy `--check` drift 0, 기존 유닛/통합테스트 회귀 0.

## 6. SSOT / 매니페스트 영향
- `l2-loop.js`: 매니페스트 **wslOnly → shared**(byte-identical 강제 대상). 편집=WSL canonical→`maia-deploy` 1회.
- 신규 파일(WSL 헬스워치 스크립트·큐 모듈)은 매니페스트 등재(미등재 시 health가 UNCLASSIFIED LOUD).
- `~/.ai-bootstrap` git commit으로 이력.

## 7. 정직한 한계 (pre-L2)
- H1. **Windows 폴백은 hermes 실시간 알림이 없다**(N1). BLOCKER/에스컬레이션이 위키·DB엔 남지만 텔레그램 푸시는 WSL 복귀 후에야 가능 → 실시간성 저하. (완화: L1 헬스워치가 WSL 다운 자체를 알림.)
- H2. **codex/gemini Windows 동작이 WSL과 byte-identical하지 않을 수 있다**(샌드박스·트러스트·경로). 폴백 기준은 "무검증보다 낫다"이며, 품질차는 결과에 *명시*.
- H3. **위키경로 매핑**(b): 브리지(/mnt/c)와 네이티브(C:\)가 동일 물리폴더를 가리켜야 done-marker reconcile이 일관됨. 경로 정규화 실수 시 중복/누락 위험 → 테스트 필수.
- H4. 본 트랙은 **가용성**만 높인다. Auto-L2가 *게이트가 아닌 안전망*이라는 하네스 한계(전역 규약)는 불변 — 중요 산출물 동기 L2 권장은 유지.

## 8. 메타 (자기적용)
본 spec은 **L2 가용성 기능 자신을 동기 L2로 검증**한다(codex∥gemini). 라운드 결과는 위키 `reviews/`에 산출.
