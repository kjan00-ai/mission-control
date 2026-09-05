# C5-1b 후속 — Auto-L2 실시간 BLOCKER 알림 (Telegram)

> C5-1b 자동발동의 비동기 폐루프를 닫는다: auto-L2가 BLOCKER/에스컬레이션 발견 시 **대표님께 Telegram 실시간 통지**. gemini가 3세션 연속 강조한 #1 후속. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.B/비전④ + [[c5-1b-auto-l2-trigger-plan]] §4.3.
> - 날짜: 2026-06-12 / 작성: claude / 버전: **v2 (L2 round1 반영 — deepen 링크·다중claim·override hijack 차단) · 라이브**
> - SSOT: `~/.ai-bootstrap/l2-loop.js`(sendAlert) + `~/.claude/hooks/post-task-l2.js`(MAIA_L2_AUTO=1).

## 0. 문제
C5-1b auto-L2는 결과를 위키 `reviews/`에 **비동기 적재만** → 대표님이 BLOCKER를 즉시 인지 못 함('결함의 암묵적 배포'). push 자율(C5-0c) 개방 전, 검증 결과가 대표님께 도달하는 폐루프가 필요.

## 1. 메커니즘
- **전송 경로 = 검증된 watchdog 패턴 재사용**: `printf msg | $HOME/bin/hermes send -t telegram` → 대표님 DM(telegram `6206674018` "월천현금"). 봇토큰(`~/.hermes/.env`)이라 게이트웨이·LLM 불요. l2-loop(node)이 spawn → Decision Gate 대상 아님(게이트는 Claude tool만).
- **`l2-loop.js` `sendAlert(artifact, overall, agg, escalated, aggName)`**: run 종료 시 호출. **조건**: `MAIA_L2_AUTO`(자동발동 run) **AND** (escalation≥1 **OR** blocker-severity canonical≥1). 그 외 무음.
  - **수동 run 무음**: 대표님이 세션에서 직접 L2 돌릴 땐 화면 보고로 충분 → 노이즈 방지(자동 run만 알림).
  - **pass/important-only 무음**: BLOCKER/에스컬레이션만 통지(every 수정필요 알림=피로).
  - best-effort(try/catch, timeout 15s) — 알림 실패가 L2를 깨지 않음. 끄기 `MAIA_L2_ALERT_OFF=1`, 테스트 override `MAIA_L2_ALERT_CMD`.
- **훅(`post-task-l2.js`)**: l2-loop spawn 시 `env MAIA_L2_AUTO=1` 주입.
- **메시지**: `🚨 [MAIA Auto-L2] {artifact} / 판정 {overall} | blocker N · 에스컬레이션 M / ▸ {top claim 180자} / → 위키: reviews/{aggName}.md`.

## 2. 안전/리스크
- **노이즈 제어**: 자동 run + BLOCKER/에스컬레이션만 → 저빈도(auto-L2 자체가 hash dedup+cooldown+회당≤2). 수동·pass·important-only 무음.
- **실패 격리**: best-effort, l2-loop 결과(위키 적재)는 알림 성패와 무관.
- **게이트 무결성**: l2-loop의 node spawn은 정상 경로(설계). Claude Bash의 `hermes send`는 여전히 외부발신 DENY(우회 아님).
- **한계(수용)**: 알림은 BLOCKER/에스컬레이션 한정 — important/suggest는 위키 검토. 알림≠게이트(여전히 비차단, 중요건은 동기 L2 권장).

## 3. 검증
- mock(`MAIA_L2_ALERT_CMD`=recorder): ① auto+blocker→발송(형식 확인) ② 수동→무음 ③ auto+pass→무음. (완료.)
- 라이브: 다음 auto-L2 BLOCKER 시 대표님 텔레그램 수신 / 또는 대표님 수동 `printf … | hermes send -t telegram`.

## 3.1 L2 검증 결과 (dogfounding — 2026-06-12)
- **round1**: codex 4 + gemini 4, 8 canonical, escalation 0(round2 6건 corroborated). **실 결함 3건 반영(v2)**:
  - `b633c87c`: 에스컬레이션 시 알림 링크를 round1 집계 → **deepen 집계(판정 섹션)**로(`lastDeepenAgg` 전달).
  - `68103a66`(보안): `MAIA_L2_ALERT_CMD`가 auto-spawn env 상속 → 임의 exec hijack. **훅이 auto-spawn 시 override 삭제**(프로덕션 auto=항상 실 hermes; 테스트 override는 직접 invoke만).
  - `5467b363`: top claim 1→**최대 3건**(다중 심각도 가시화).
- **수용/문서화**: basename 충돌(`a9edb400` — 날짜접두 네이밍상 비현실적) / spawn≠완료 silent failure(`af8c63be` — 7d prune 경계, output-dedup 후속) / 변경→재알림(`7a75676d` — cooldown 경계) / 원격 snooze·kill(`b6933142` — 봇 양방향 핸들러 후속) / important 무음(`cd9c55f0` — 의도: 위키 검토, 알림은 BLOCKER/에스컬레이션 한정).

## 4. 롤백
- `MAIA_L2_ALERT_OFF=1`(환경) 또는 l2-loop `sendAlert` 호출 1줄 제거 → 알림 중단(자동발동·위키 적재는 유지).

## 5. 관련
- [[c5-1b-auto-l2-trigger-plan]] §4.3 / [[2026-06-11-maia-autonomy-overhaul]] §2.B
