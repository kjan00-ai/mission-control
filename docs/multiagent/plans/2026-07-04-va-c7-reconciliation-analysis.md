# Verified Autonomy ↔ C7(A2→A1→B) 정합성 재조정 + 통합 실행계획 (2026-07-04)

> 두 설계(VA 게이트 재설계 2026-07-03 / A2→A1→B 로드맵 2026-06-24)가 같은 목표(verification-over-approval)를 각자 수립 → 정합성 재조정.
> **본 판(v2)은 L2 codex∥gemini 3라운드 검증 완료본**(6건 합의 반영, 결론 확정). L2 원장: `reviews/2026-07-04-va-c7-reconciliation-analysis-l2-aggregation-20260704-122951.md` (+ deepen r2/r3).
>
> 원문 A (VA): `docs/multiagent/specs/2026-07-03-verified-autonomy-gate-redesign-spec.md`
> 원문 B (로드맵): `docs/multiagent/plans/2026-06-24-a1-a2-b-roadmap.md`
> 구현 상태: ①a/①b/①c **적용됨, `reversibilityDowngrade.enabled=false`(no-op)**. prune cron 등록. C6 cutover/queue `activated=false`.

## 1. L2 확정 결론 (구두 재조정 오류 6건 교정)

| # | 교정 전(오류) | L2 확정 결론 | 근거(합의) |
|---|---|---|---|
| ❶ | A2와 VA 보호대상 **동일** | **불일치 — 통일 필요.** 로드맵 A2=`settings.json` hook 등록부 포함·`maia-manifest.json`은 **T2** / VA §0.5 canonical=settings 없음·manifest 보호대상. 보호집합 자체가 다름 | `b6cc904c` |
| ❷ | B.1이 VA §2.2로 **흡수** | **흡수 아님 — 상보.** B.1의 Silent Trigger 방지 핵심=**"인간이 실제 검토한 holdback 표본 거부0"(미검토≠증거)**. VA §2.2는 content-hash/run_key+L2 verdict만 정의, **인간관측 요건 없음**. 흡수 주장 시 인간관측 증거 삭제=Silent Trigger 재개방 | `f8faeff7` (blocker) |
| ❸ | C6 queue **obviate** | **queue 존속.** VA 가역성=git-추적 Edit/Write pre-image 한정(Bash/exec·미추적 신규파일 비대상). queue=비가역 op **T3 async 대표승인**+B.3 원자성/락/멱등성/부분실패 롤백 → VA 미포함 기능. cutover만 코드표면 부분중첩 | `2acb95ce`·`1b2a3cca` |
| ❹ | 임계경로 VA②→A1 | **A1이 VA② hardblock의 전제.** 신뢰못할 CLI L2로 ② hardblock 승격=로드맵 "A1 없이 B 금지"와 동일위험. **②는 informed 먼저 → A1 후 hardblock 승격** | `0d606cc9`·`412c043d` (blocker) |
| ❺ | (누락) | VA §2.2 반영점 게이트에 **서비스명→경로→원장키 매핑 상태모델** 부재 — ② 구현 시 보완 | `7d8970e4` (suggest) |
| — | (대표 판정) | `aad46cc1`: "문서가 결론 미확정" — codex refute(L2 대질문서라 정상). **본 v2에서 결론 확정으로 해소** | escalation |

## 2. 확정 관계도

- **A2**(자기보호): VA의 토대. 단 **보호집합 정의가 두 문서에서 갈림 → W1에서 통일.**
- **A1**(L2 네이티브 전환): 불변 + **VA② hardblock·B의 신뢰성 전제**. informed 단계는 A1 전 가능, hardblock/활성화는 A1 후.
- **B.1**(인간관측 증거): VA와 **상보** — 보존 필수(VA②에 인간관측 층 명시 추가 or B에 유지).
- **B.3 queue**: **존속**(VA 미포함 표면). **cutover**: 코드표면은 VA②로 대체, 그 외는 결정.

## 3. 통합 실행계획 (세부 순서·작업내용)

**임계경로: A2 ✅ → W1 → VA① flip → W3 → A1(W4) → VA② hardblock+B(W5) → C6 정리(W6)**

### W1 — 보호집합 통일 (선행, 작음 · 해소 ❶) ✅ 2026-07-04 완료
- **실측 등급**(risk-classify classify 직접 호출): `decision-policy/c6-policy/risk-classify/policy-classify/hooks` = **T3**(gate-self) · `maia-manifest.json` = **T2**(maia-policy) · `settings.json` = **T1**(default-write).
- **확정**: (a) manifest = **T2 유지**(게이트 로직 불변경·드리프트 health탐지 → T3 불요, friction 회피). VA §0.5의 "manifest=owner-only T3" 오기 교정됨. (b) `settings.json` hook 등록부 = **T1 잔여 구멍**(에이전트가 훅 등록 삭제로 게이트 무력화 가능) → **별도 하드닝 과제로 트래킹**(훅 섹션 한정 content-gate; env-class라 blanket 불가). (c) VA §0.5·로드맵 문구 동기 완료.
- **정책 편집 없음**(status quo T2 유지) → 문서-only(T1), 자율 반영.
- **잔여 하드닝(H1, 별도)**: settings.json 훅 등록부 content-gate. 우선순위 낮음(현 세션 에이전트 게이트 우회 실익 없음)이나 A2 완결성엔 필요.

### W2 — VA① flip (대표 `!` · 게이트)
- **작업**: `decision-policy.json reversibilityDowngrade.enabled: false→true`.
- **효과**: auth/dispatch/scheduler/relay/i18n의 git-추적 Edit → T1 자율(pre-image+informed 반영점 게이트).
- **★ 글로벌 적용 = 불변 법칙(대표님 2026-07-04)**: flip은 **전 환경 동시 발효가 정상**(MC/WSL + BC/SF/Windows). 환경별 스코프 설계·부분활성은 **금지**. `decision-policy.json`·훅 모두 shared라 flip은 이미 전 환경에 걸림 — 이게 올바른 목표. [[maia-always-global-immutable-law]]
- **⚠️ 글로벌 준비 격차 = G1(전제)**: 실측상 Windows(BC/SF)엔 게이트 훅 동기·등록 완료(flip 시 실제 활성) + pre-image 기록 가능 + 반영점 방어선(push=T3) 유효 — **유일 격차 = pre-image 청소(prune)가 WSL 전용** → Windows blob 무한적재. **격차는 스코프로 회피하지 않고 닫는다**: prune을 크로스-환경화(W2 직전 **G1**).
- **flip 타이밍**: G1 완료 후 글로벌 flip 안전(informed 수준). async 검증(W3)·hardblock은 상위 층이라 flip 비차단.
- **가역**: enabled→false 1줄(전 환경).

### G1 — prune 크로스-환경화 (글로벌 flip 전제 · 작음)
- **작업**: `preimage-prune.js` 단일 ledger → **다중 ledger 순회**(WSL `~/.ai-bootstrap/evidence` + Windows `/mnt/c/Users/design/.ai-bootstrap/evidence` via /mnt/c). WSL hermes cron 하나가 양쪽 청소(Windows Task Scheduler 불요). `preimage-restore.js`에 `--ledger <path>` 옵션(Windows 편집 복원).
- **검증**: 양쪽 ledger 격리·escalation 테스트 + L2.
- **가역/게이트**: preimage-* = gate-self 아님(T1). manifest wslOnly 유지(도구는 WSL 구동, 양 ledger 조작).

### W3 — VA② informed 완성 + B.1 인간관측 보존 (해소 ❷·❺)
- **작업**:
  1. **run_key 원장 게이트**: `verifyRequiredPaths`(plans/specs/decisions+T2+) content-hash+commit SHA/diff-hash 바인딩, commit 순간 재산정(TOCTOU). **단 hardblock 아님 = UNVERIFIED-LOGGED advisory**(❹).
  2. **async 자동검증 배선**: commit 후 async `l2-loop`(변경 diff)→verdict를 원장에 기입(informed 반영점이 실제 verdict 소비). ⚠️ 이 시점 검증기는 CLI L2(A1 전) — **advisory 한정, hardblock 금지**.
  3. **B.1 인간관측 층 보존**: 반영점/원장에 **"인간 검토 holdback 표본 거부0"** 증거 필드를 L2 verdict와 **별도**로 유지(미검토≠증거). VA②가 이걸 삭제하지 않도록 명시.
  4. **서비스→경로→원장키 매핑 상태모델**(❺): 반영점(systemctl restart 등) 화이트리스트 서비스 ↔ 해당 코드경로 ↔ 원장키 매핑 정의.
- **가역/게이트**: 코드 = repo. 정책/훅 편집 = A2 T3. 산출물 = L2 대상.
- **규모**: 중. (VA spec §4 구현목록 기반)

### W4 — A1 L2 네이티브 전환 (C7 최대 관문 · ②hardblock·B 전제)
- **작업**: L2 transport CLI(codex/gemini) → **Claude 서브에이전트(기술)+gemini API 직결(운영)**. CLI 인증·쿼터·timeout 근본 소거. `l2-schema.js` 집계·심화 로직 불변(transport만 교체). 폴백 CLI opt-in 유지(증거 자격 없음).
- **⚠️ 비용·도입 게이트**: `claude -p`/서브에이전트=**에이전트 SDK 인접** → 대표 비용·도입 승인 재확인(전역 규약). A1.0 구성은 2026-06-24 대표 결정됐으나 착수 시 재고지.
- **검증**: `l2-loop` 55테스트 무회귀·parser-fail율↓ 실측·독립성 보존·폴백 좀비 0.
- **규모**: 대.

### W5 — VA② hardblock 승격 + B 활성화 (A1 후)
- **작업**: (a) VA② informed→**hardblock**(이제 L2 신뢰 → 비가역 반영 미검증 차단 안전). (b) B 양성증거 활성화(코드표면 cutover=VA②로, 인간관측층 결합). break-glass(대표 `!` 단건) 유지.
- **가역/게이트**: 활성화 편집=A2 owner-only T3. 3중 가역(flag/env/policy).

### W6 — C6 정리 (해소 ❸)
- **작업**: **cutover** = 코드표면은 VA②로 대체 → C6 cutover 코드표면 로직 은퇴/리다이렉트. **queue** = **존속**(비가역 T3 async 대표승인+트랜잭션 보장) — 역할 재-스코프(VA 비대상 표면 전용 명시).
- **대표 판정**: cutover 은퇴 범위 / queue 존속 확정.

## 4. 대표 결정 게이트 (요약)
1. **W1**: manifest T2 vs T3 / settings hook 포함 여부.
2. **W2 flip 타이밍**: 지금 vs W3 후.
3. **W4 A1**: 에이전트 SDK 인접 비용 승인.
4. **W6**: cutover 은퇴 범위 / queue 존속 확정.
