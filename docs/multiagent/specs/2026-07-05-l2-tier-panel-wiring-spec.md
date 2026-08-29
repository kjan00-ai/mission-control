# §6-3 L2 티어별 패널 배선 — spec 동결 (DEFER)

- **문서유형**: spec (frozen, 미배선)
- **작성일**: 2026-07-05
- **상위계획**: [[2026-07-02-glm52-poc-plan]] §1.5(평가 아키텍처)·§6-3(실행순서 3단계)
- **판정**: **DEFER + spec 동결** (대표 판정 2026-07-05). 코드변경 0. GLM 운영배선(§0.5 통과) + concordance 승격 시점에 **동반 배선**.

> 이 문서는 §6-3의 티어→L2패널 매핑을 **계약으로 동결**한다. 지금 단독 배선하지 않는 이유와 배선 선결조건을 명시한다.

## 1. 실측 현황 (2026-07-05)

**① "claude 검증자 추가" = 이미 라이브 (무배선 필요)**
- `~/.ai-bootstrap/l2-loop.js` 기본 reviewers = **`claude ∥ gemini`**(A1.2/A1.3, 2026-06-25). claude = 구독 네이티브 기술검증(`claude -p --json-schema`, **추가 과금 0**), gemini = REST 운영검증, codex = `--reviewers` opt-in.
- 상위계획 §1.5의 "현행 L2 = codex∥gemini, claude는 검증단 밖" 전제는 **stale** — A1이 이미 편입. → §6-3의 이 절반은 **완료**.

**② 티어별 패널 구성 = 미배선**
- `decision-policy.json` = **Decision Gate(권한 T0~T3, allow/ask/deny)** 전용. L2 reviewer 구성과 **연결 없음**.
- `l2-loop.js`도 reviewers를 `--reviewers > env MAIA_L2_REVIEWERS > 기본(claude,gemini)`으로만 해결 — **티어 인지 없음**.

## 2. 동결 계약 — 티어 → L2 패널 (배선 시 이 매핑을 구현)

| 티어(risk-classify) | 대상 | L2 패널 | claude 관여 |
|---|---|---|---|
| **T0/T1** | docs·routine CRUD·단순 페이지 | codex∥gemini (또는 현 claude∥gemini) | **샘플링**(N건당 1) — 비용폭주 방지 |
| **T2/T3** | auth·결제·마이그레이션·보안·개인정보·보험/금융 | codex∥gemini∥**claude** 상시 | **상시 필수** |

- 배선 지점: (a) `decision-policy.json`에 `l2ByTier` 섹션 추가 **또는** 별도 `l2-tier.json` 신설 + (b) `l2-loop.js`가 artifact의 risk-tier를 `risk-classify`로 산정→패널 구성 consult. **가역**: env override(`MAIA_L2_REVIEWERS`) 우선순위 유지.
- 비용가드: T2/T3 3벤더 상시는 검증비용↑ → T0/T1 샘플링 비율 상시 모니터링(상위계획 §7 "Claude L2 비용 폭주 방지").

## 3. DEFER 사유 — 선행 단독배선 = 死배선

§6-3은 "**GLM=활성 생성자 → Claude=검증자 → concordance=GLM 성능지표**"를 전제. 조건부 Go 하에서 전제 미성숙:

| 전제 | 상태 |
|---|---|
| GLM 활성 생성자 | ❌ 스코프제한·격리 opt-in(수동), 운영 미배선 |
| Claude 검증자 | ✅ 이미 A1(전제 무관) |
| concordance 상시지표 | ✅ 대표 승격 확정(2026-08-29, [[2026-08-29-concordance-standing-metric-promotion]]) |
| 3벤더 상시 편익 | ⚠️ GLM 생성 스트림 부재 → 편익 0·비용만↑ |

→ 티어 패널을 지금 배선해도 **검증할 GLM 산출물 스트림이 없어 死배선**. codex 상시추가는 비용만 증가.

## 4. 배선 선결조건 (동반 배선 트리거)

**아래 3건 충족 시 §2 매핑을 배선**한다(단독 선행 금지):
1. **GLM 운영배선**: §0.5 운영거버넌스 게이트(R1 실PII/금융 GLM유입차단·R2 접근제어·R3 잔존) 통과 → GLM이 실제 생성 스트림 발생.
2. **concordance 상시지표 승격**: ✅ 대표 확정(2026-08-29, [[2026-08-29-concordance-standing-metric-promotion]]). 캘리 spec §5-2 게이트 두 선결 충족.
3. **게이트/전파**: `decision-policy.json` = `gate-self-policy` **T3 nonOverridable**(대표 `!`만 편집). shared 인프라 = WSL canonical 편집 → `maia-deploy`(전파는 Go 후 + §0.5 후).

## 5. 지금 상태 = no-op
- claude-검증자 라이브 확인 완료(추가작업 0). 티어 패널은 본 spec으로 동결. **코드변경 없음.**
