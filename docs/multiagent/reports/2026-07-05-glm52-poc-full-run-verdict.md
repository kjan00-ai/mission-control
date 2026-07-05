# GLM-5.2 PoC — Full 24런 결과 · AI 개발모델 운영 매뉴얼 근거

- **문서유형**: report (PoC 종결 산출물)
- **작성일**: 2026-07-05
- **상위계획**: [[2026-07-02-glm52-poc-plan]] §5 Go기준·§6 실행순서 / 캘리 spec [[2026-07-03-glm-calibration-spec]]
- **판정**: **조건부 Go** (대표 판정 2026-07-05)
- **raw/산출물**: `~/.glm-poc/full-run/`(격리, repo 밖) — `reviews/{go-verdict,ledger,summary}.json` + 24런 raw. 하네스 `lib/`·`taskA|B|C/`.

> ⚠️ **격리 유지**: GLM은 확정 배선 전까지 opt-in PoC(`glm-launch.sh` 수동). §0.5 운영게이트 선통과 전 `maia-deploy` 전 프로젝트 배포 금지. 보험·금융 도메인은 z.ai ToS상 하드경계([[glm-zai-tos-finance-insurance-prohibited]]).

## 1. 실행 개요
- **4모델 × 3과제 × 2반복 = 24런**. 모델: GLM-5.2 / Claude Sonnet 5(baseline) / GPT-5.5(codex) / Gemini 3.1 Pro(gemini-3-pro-preview).
- **baseline = Sonnet 5**($3/$15) — GLM이 대체하는 대량구현 tier. Opus 4.8($5/$25)은 비대상(과대평가 회피, 대표 확정).
- 과제 A(프론트 위젯 재현)·B(webhooks CRUD)·C(seeded-bug 코드검증). 격리 sandbox·프롬프트 인라인·flat pricing(입력 전량 fresh).
- 채점: 정량 자동(토큰·wall·비용·compile-check 왕복) + 정성 **블라인드 패널**(시각 배심원 2 + 소스 배심원 1, cand-X# 봉인 keymap·시그니처 sanitize).

## 2. GO-1~5 판정

| 게이트 | 기준 | 실측 | 판정 |
|---|---|---|---|
| GO-1 비용 | ≤40% | **47.5%** (A 56%·B 37%) | ❌ 미달 |
| GO-2 품질 | ≥80% | **107%** (GLM≥Claude) | ✅ |
| GO-3 왕복 | ≤1.5× | 절대 near-0(GLM 0.5·Claude 0), 비율 degenerate | ✅ 실질 |
| GO-4 critical | 미탐=실격 | GLM critical **3/3**(양 rep) | ✅ |
| GO-5 concordance | ≥70% | 양 rep PASS·union PASS | ✅ |

## 3. 핵심 발견 — 비용우위 = 프론트 장황성에 막힘

**품질(블라인드 rubric acc 0~1)**:

| 모델 | A | B |
|---|---|---|
| claude(sonnet) | 0.94 | 0.63 |
| **glm-5.2** | **0.95** | **0.73** |
| codex | 0.93 | **0.97** |
| gemini | 0.78 | 0.83 |

**비용 — output-only(한계 생성비용)**:
- **과제 A: GLM = Claude 95%** — GLM out **12,608 토큰(Claude 3,879의 3.25×)**·wall **~205s(5.7× 느림)**. 단가우위($4.4 vs $15)를 장황성이 거의 소진.
- 과제 B: GLM = 42%. 린 과제선 우위 유지.
- full-cost(입력 포함): A 56%·B 37%·합 47.5%.

→ **GO-1 스모크(무튜닝 47%) 대규모 재확인.** 비용명분은 ①린/CRUD 한정 or ②간결 규율 하에서만. **품질·검증안전(critical 3/3)은 완전 입증.**

## 4. 대표 판정 — 조건부 Go
- **허용**: 린/CRUD/반복 대량작업 + 간결 프롬프트 규율(concise mandate) 하 생성.
- **금지**: 프론트/디자인 무튜닝 투입 · 보험/금융 도메인 · Go만으로 전 프로젝트 전파(§0.5 선통과 필수).
- **근거**: 코드품질·검증안전 입증 = 도입 근거 충분. GO-1 미달은 프론트 국소원인 → 스코프 제한으로 회복.

## 5. 차기(대표 결재)
1. **§6-3 L2 배선**: `l2-loop.js`에 claude 검증자 추가 + `decision-policy.json` 티어별 L2(T2/T3 shared) — WSL canonical 편집, 대표 결재. Go 후에만 maia-deploy.
2. **§0.5 운영거버넌스**: R1 실PII/금융 GLM 유입차단·R2 접근제어·R3 잔존/삭제.
3. **보험/금융 하드경계 코드게이트화**.
4. **concordance 상시지표 승격** = 별도 대표 확정(캘리 spec §5-2 게이트).

## 6. 방법론 한계
- flat 비용은 입력 오버헤드(Claude Code 시스템 ~30-40k)를 fresh 계산 → full-cost 비율이 입력에 희석. output-only 병산으로 한계 생성비용 정직 표출(진짜 신호=A 95%).
- codex/gemini 입력비용 ref-only(CLI 오버헤드 상이). output·wall이 교차모델 정직 지표.
- 블라인드 패널 = Claude 서브에이전트(블라인드성으로 자기편향 통제). 멀티벤더(gemini/codex 이미지) 확장은 후속 강건화 여지.
- 표본 소량(2반복) → 상시운영 concordance로 보완.
