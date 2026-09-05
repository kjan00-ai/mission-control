# 코드기반 디자인시스템 · AI강제 · 시각검증 루프 — 적용방법 & 실행계획

- 문서ID: PLAN-UI-DS-260701
- 상태: L2 검증 반영본(v2) — 수정필요 판정, 합의 5건 반영 · 에스컬레이션 2건 반박수용
- 근거 입력: `ANS_260701_001_multi_ai_ui_design_tools.md` (외부 AI 도구조사 보고서) + Claude 분석
- 확정 결정(대표님, 2026-07-01):
  - **D1. 적용 대상 = 크로스 프로젝트 방법론 먼저** (이식 가능한 방법론을 만들고 프로젝트별 인스턴스화)
  - **D2. 아이콘 규칙 = 서비스페이지 한해 lucide 허용** (MC 대시보드 코어는 `No icon libraries` 유지)
  - **D3. 강제성 = 하드 게이트 추가** (stylelint 임의값 차단 + PreToolUse 훅 — soft 가이드가 아닌 실제 차단)
  - **D4. Phase3 레퍼런스 = BC 랜딩 1페이지** (service-page tier, lucide 허용, Cloudflare/workerd 제약 유의)
  - **D5. 에스컬레이션 2건 = 반박 수용** (본문에 대응물 실재 / e6bacd7e 수정으로 흡수)

---

## 0. 채택 전략(기본 방향, 확정)

문제 본질은 모델 성능이 아니라 **디자인 기준이 코드화되지 않아 AI가 매번 감으로 UI를 생성**하는 것. 해결 3축:

1. **코드기반 디자인시스템**: 토큰(color/typography/spacing/radius/shadow/breakpoint/motion) + 공통 컴포넌트 + 페이지 패턴을 코드로 고정.
2. **AI 강제(하드 게이트 기반)**: 스킬 + CLAUDE.md 규칙 + MCP로 방향 유도 + **stylelint 임의값 차단 + PreToolUse 훅으로 실제 차단**(임의 hex/px 미통과). ※ soft 가이드만으론 "강제"가 과장 → 하드 게이트로 실현(§2.5).
3. **시각검증 루프**: Playwright로 desktop/tablet/mobile 스크린샷 → AI가 눈으로 점검·수정·재검증.

---

## 1. 방법론 vs 인스턴스 분리 (D1의 핵심 설계)

크로스 프로젝트 방법론이므로 **"스택 중립 방법론"**과 **"프로젝트별 구현물"**을 명확히 분리한다.

| 계층 | 위치(SSOT) | 내용 | 스택 의존 |
|---|---|---|---|
| **방법론(portable)** | 멀티AI 시스템 = 이 MC repo(코드/spec) + 위키 references(지식) | 스킬 `service-ui-designer`, CLAUDE.md 규칙블록, 검증루프 harness, 문서 템플릿 4종 | 없음(중립) |
| **인스턴스(per-project)** | 각 프로젝트 repo | 실제 토큰값, `components/ui/*`, 페이지 패턴, `.mcp.json` | 있음(v3/v4·Cloudflare 등) |

**추상화 위험 완화(중요)**: 방법론만 만들고 끝내면 vaporware가 된다. → **Phase 3에서 레퍼런스 프로젝트에 즉시 인스턴스화하여 루프를 1회 완주**시켜 방법론을 실증·교정한다. **레퍼런스 대상 확정(D4) = BC 랜딩 1페이지**(service-page tier). ※ 대상을 *지금 확정*(D4)해 지연을 막되, Phase3 **실행**은 harness(Phase1)·MCP(Phase2) 산출물에 의존하므로 그 뒤에 수행한다 — 선행조건 역전 방지(L2 c70d5bdc). 0eaca56c의 '실증 지연 방지'는 '대상 조기 확정 + Phase1/2 최소산출물 완료 즉시 착수'로 충족.

---

## 2. 방법론 산출물(Portable) — Phase 1

1. **스킬 `service-ui-designer`** (Claude Code Skill)
   - 입력 파라미터 `tier: dashboard | service-page` — **D2 이원화 구현**:
     - `dashboard`: `No icon libraries`, raw text/emoji, MC 코어 규칙.
     - `service-page`: lucide-react 허용(shadcn 기본 그대로).
   - 작업순서: 목적파악 → 기존 컴포넌트/스토리 확인 → shadcn 참조 → 신규 최소화 → 토큰만 사용 → 반응형 선설계 → Playwright 스크린샷 → 점검(여백/정렬/대비/CTA/모바일깨짐/텍스트겹침) → 수정·재검증.
2. **CLAUDE.md 규칙블록**(이식용 스니펫, SSOT 1곳): 임의 hex/px/inline-style 금지, shadcn 우선, 스크린샷 검증 없이 완료선언 금지. 스킬과 **내용 중복 제거**(규칙은 규칙블록이 SSOT, 스킬은 절차 참조).
3. **시각검증 루프 harness**: viewport 세트 `1440/1024/768/390`, 스크린샷 캡처 → AI 리뷰 → diff.
   - **선행조건 명시(L2 85f37b68)**: ①dev server 기동(`next dev`/`wrangler dev`) + 렌더 가능 라우트 존재, ②baseline 스크린샷 저장소(`__screenshots__/`, git 관리) — 없으면 diff 대신 최초 스냅샷 등록.
   - **대비·접근성(L2 6cfcd7cf)**: WCAG 대비는 육안 산출 불가 → **`@axe-core/playwright`(무료)** 를 루프에 포함해 대비/a11y를 *측정*. 유료 Lighthouse CI로 이연하지 않음.
   - **종료조건(L2 e6bacd7e)**: 최대 반복 **3회**, 통과기준=체크리스트 전항목 pass, **수렴 실패(3회 초과·상충) 시 인간(대표) 에스컬레이션** — "검증없이 완료금지" 규칙과의 교착 방지.
   - 초기엔 Playwright 로컬 screenshot(무료), Chromatic/Percy는 운영단계 이연.
4. **문서 템플릿 4종**(프로젝트별 채움): `ui-design-system.md` / `ui-rules.md` / `page-patterns.md` / `component-usage.md`.
5. **하드 게이트(D3 — '강제' 실현, L2 ef09c9b6/200a228c/58dd4d20/e6a4e91d)**: Tailwind/React 코드베이스의 실제 위반 벡터는 **className 문자열의 arbitrary value(`bg-[#abc]`·`p-[13px]`)와 JSX `style={{}}`** 이므로 CSS 린터(stylelint)만으론 못 잡는다 → **다층 게이트**:
   - **ESLint(주 게이트)**: `eslint-plugin-tailwindcss`로 arbitrary-value 클래스 차단 + inline-style 금지 룰(`react/forbid-dom-props` 등)로 `style={{}}` 차단 — JSX/className을 직접 검사.
   - **stylelint(보조)**: 실제 `.css`/전역 스타일의 임의 hex/px 차단.
   - **토큰 SSOT allowlist(L2 58dd4d20)**: 토큰 정의 파일(`--color-*: #...` 원시값 필수)은 린터/훅 예외 등록 → SSOT 파일 false-positive 방지.
   - **실제 커밋 게이트 = git pre-commit(lint-staged) + CI(L2 e6a4e91d)**: PreToolUse 훅은 AI Edit/Write 시점 *빠른 피드백*일 뿐 수동편집·비-Edit 경로(bash)·git commit을 못 잡음 → '실제 차단' 보장선은 pre-commit+CI. 훅은 **디자인시스템 적용 프로젝트로 스코핑**(전역 훅이 미적용 프로젝트 UI까지 막지 않도록).
   - 무료. skill/규칙(soft) → ESLint/stylelint(fast) → pre-commit/CI(hard) **다층 방어**.

### 2.6 도구 매핑 (무엇이 skill/plugin/MCP/표준도구인가)

> 핵심: **강제(게이트)의 주력은 Claude 스킬/플러그인이 아니라 표준 린트 도구(ESLint/stylelint/pre-commit/CI)**. Claude 고유 도구는 그 위에 얹는 얇은 층(스킬 1 + MCP 2~3 + 훅 1).

| §2 산출물 | 도구 유형 | 구체 도구 | 활성 위치 |
|---|---|---|---|
| ① service-ui-designer | **Claude Skill (신규 저작)** | `SKILL.md` → `.claude/skills/service-ui-designer/` | 이식(멀티AI SSOT) → 프로젝트/전역 |
| ② 규칙블록 | 설정(instructions) | CLAUDE.md 스니펫 | 프로젝트 CLAUDE.md |
| ③ harness | **MCP + npm** | Playwright MCP + `@axe-core/playwright` | 프로젝트 |
| ④ 문서 템플릿 4종 | 문서 | `/docs/ui-*.md` | 프로젝트 |
| ⑤-a 게이트(주) | **npm dev-dep** | ESLint(`eslint-plugin-tailwindcss` + inline-style 룰) | 프로젝트 |
| ⑤-b 게이트(보조) | npm dev-dep | stylelint(`.css`) | 프로젝트 |
| ⑤-c 커밋 게이트 | git hook + CI | husky + lint-staged + CI(GitHub Actions) | 프로젝트 |
| ⑤-d fast-feedback | **Claude Hook** | PreToolUse 훅(DS 프로젝트 스코핑) | `settings.json`(대표 활성) |
| (컴포넌트 참조) | MCP | shadcn MCP | 프로젝트 |

> **Plugin 관점**: 위 MCP+스킬+훅을 하나의 Claude Code plugin으로 번들 가능(팀 배포 시). 현재는 개별 `claude mcp add` + 스킬 파일 + 훅 등록이 단순. 기존 스킬 `update-config`(훅/settings 구성)·`run`/`verify`(앱 기동·검증) 활용.

---

## 3. MCP 연결 — Phase 2 (경량 우선·토큰예산 준수)

**토큰비용 게이트**: MCP는 tool schema를 컨텍스트에 상시 로드 → 5종 상시화는 우리 "CLAUDE.md 경량화" 원칙과 상충. **프로젝트별 `.mcp.json`에서 필요할 때만 활성**, 상시 다중탑재 금지.

- **1단계(무료·필수)**: Playwright MCP(`@playwright/mcp`, MS 공식 — 검증), Context7 MCP(`@upstash/context7-mcp` — 최신문서, 무료티어). shadcn MCP(`npx shadcn@latest mcp` — 컴포넌트 참조)는 선택.
- **2단계(권장, 조건부)**: Storybook MCP — 페이지 10개+ 시점. 21st.dev Magic MCP(`@21st-dev/magic`) — 유료, 보조 생성기.
- **3단계(운영, 유료·결재)**: Chromatic/Percy(시각회귀), Lighthouse CI(성능·접근성).

> ⚠️ MCP 패키지명·install 명령은 버전에 따라 변할 수 있으니 Phase 2 착수 시 공식 문서로 확정. 추가 예: `claude mcp add playwright -- npx @playwright/mcp@latest`.

**유료·과금 항목은 전역 비용 결재 게이트 대상**(대표님 승인): v0, Chromatic, Percy, 21st.dev Magic. 1단계는 전부 무료로 구성 가능.

---

## 4. 실행 단계(Phased)

- **Phase 0 — 기준 확정**: 방법론/인스턴스 분리 계약 + 토큰 스키마(스택중립: 토큰=CSS 변수 계층으로 표현해 v3/v4 양쪽 매핑) 확정.
- **Phase 1 — 방법론 산출물**(§2) 작성. 무료·저토큰.
- **Phase 2 — MCP 1단계 연결**(§3): Playwright MCP + Context7 MCP.
- **Phase 3 — 레퍼런스 인스턴스화(스모크, 대상 확정=BC 랜딩 1페이지/D4)**: BC 랜딩 1페이지에 토큰+컴포넌트+규칙 적용, 검증루프 1회 완주. **문제 발견 시 방법론 역교정**. ⚠️ service-page tier(lucide 허용) / Playwright는 로컬 `next dev`·`wrangler dev` 기동 전제(Cloudflare·workerd 배포 제약) / MC와 코드·문서·DB 혼입 금지 경계 준수.
- **Phase 4 — 일반화·문서화**: 검증된 방법론을 위키 `references/`에 SSOT 등재 + 프로젝트별 적용 가이드. 유료 도구는 페이지 10+ 시점 재평가.

---

## 5. 스택 중립성 처리(v3/v4 불일치)

문서는 Tailwind v4 전제이나 MC는 v3.4.17. 방법론은 **버전 중립**으로 설계:
- 토큰을 CSS 변수(`--color-*`, `--space-*` …)로 정의 → v3(`tailwind.config` extend + CSS vars)와 v4(`@theme`) **양쪽에 매핑 가능**.
- v3→v4 마이그레이션은 **별도 breaking 작업**으로 분리, 본 계획 범위 밖(프로젝트별 결정).

---

## 6. 비용·통제 요약

- **1차 구성은 전액 무료**: shadcn(copy-in, 무료) + Tailwind 토큰 + Playwright MCP + Context7(무료티어) + 스킬/규칙.
- **유료는 게이트 분리**: v0/Chromatic/Percy/21st → 대표님 결재.
- **에이전트 SDK 저촉 없음**(전부 MCP/CLI).
- **토큰 예산**: MCP 상시 다중탑재 금지, per-project 활성.

---

## 7. 리스크 · 완화

| 리스크 | 완화 |
|---|---|
| 방법론 추상화 → vaporware | Phase 3 레퍼런스 인스턴스화로 강제 구체화·역교정 |
| 아이콘 규칙 이원화 혼선 | 스킬 `tier` 플래그로 dashboard/service-page 분기(D2) |
| Tailwind v3/v4 불일치 | 토큰 CSS변수 중립화, v4 마이그레이션 범위 분리 |
| MCP 상시화 토큰 잠식 | per-project `.mcp.json`, 1단계 2종만 |
| shadcn 전면채택 = 대규모 리팩터 | 기존 `components/ui` 점진 확장(신규 UI부터 적용) |
| 유료 SaaS 과금 | 결재 게이트, 무료 코어로 80% 달성 후 재평가 |
| BC/SF ↔ MC 경계 혼입 | 방법론=SSOT 1곳, 인스턴스=각 repo. 코드·DB·문서 혼입 금지 규약 준수 |
| '강제' 과장 — soft만 존재(L2 ef09c9b6) | ESLint/stylelint(fast)+pre-commit/CI(hard) 다층 게이트(§2.5, D3) |
| 시각검증 선행조건 부재(L2 85f37b68) | dev server+렌더 라우트+baseline 저장소 명시(§2.3) |
| 대비 검증 무료구성 불가(L2 6cfcd7cf) | `@axe-core/playwright`(무료) 루프 포함, 유료 Lighthouse 비의존(§2.3) |
| 검증루프 미수렴 → 완료불가 교착(L2 e6bacd7e) | 최대 3회+통과기준+수렴실패 시 대표 에스컬레이션(§2.3) |
| 하드게이트 오도구 — stylelint가 className/JSX 미검사(L2 200a228c **blocker**) | ESLint(tailwindcss+inline-style 금지) 주게이트, stylelint는 .css 보조(§2.5) |
| 토큰 SSOT 파일 false-positive(L2 58dd4d20) | 토큰 정의 파일 린터/훅 allowlist(§2.5) |
| PreToolUse 훅=커밋게이트 아님·전역 스코프(L2 e6a4e91d) | 실제 게이트=git pre-commit+CI, 훅은 fast-feedback·DS프로젝트 스코핑(§2.5) |
| Phase3 타이밍 자기모순(L2 c70d5bdc) | 대상 조기확정+실행은 Phase1/2 뒤(선행조건 역전 방지, §1·§4) |

---

## 8. Next Actions(실행계획 확정 시)

1. ✅ **Phase 1 방법론 산출물 작성 완료(2026-07-02)** → `docs/multiagent/ui-methodology/`: README(도구매핑·인스턴스화) · SKILL-service-ui-designer · claude-md-ui-block(규칙 SSOT) · gate(ESLint주+stylelint보조+allowlist+pre-commit/CI+PreToolUse) · harness(Playwright+axe) · templates/ 4종. 라이브 훅/전역 스킬 등록은 미실행(env-class·게이트 민감, 인스턴스화 시 대표 활성).
2. ✅ **Phase 2 MCP 1단계 가이드 완료(2026-07-02)** → `ui-methodology/mcp.md`: Playwright(`@playwright/mcp`)+Context7(`@upstash/context7-mcp`)+shadcn 선택, `.mcp.json` 예시 + `claude mcp add` 명령 + 토큰예산 규율. **활성은 인스턴스화 시점**(상시세션 미탑재).
3. Phase 3 레퍼런스 프로젝트 1개 확정 → 스모크 루프.
4. 위키 `references/`에 방법론 SSOT 등재.

> 유료 항목·스택 마이그레이션은 각각 별도 결재 게이트. 본 계획은 무료 코어 방법론 확립까지를 1차 범위로 한다.

---

## 9. L2 검증 반영 이력 (2026-07-01)

- 판정: **수정필요** (Claude 기술 ∥ Gemini 운영/UX, 3라운드 대질). 위키 `projects/mission-control/reviews/2026-07-01-ui-design-system-methodology-l2-*`.
  - ※ Codex는 WSL 네이티브 바이너리 누락 + opt-in 레거시 강등으로 제외, 현행 표준 2벤더(claude+gemini) 적용.
- **합의 5건 반영**:
  - `ef09c9b6` 강제 과장 → §2.5 하드 게이트(stylelint+PreToolUse 훅) 신설 (D3)
  - `85f37b68` 루프 선행조건 → §2.3 dev server+라우트+baseline 명시
  - `6cfcd7cf` 대비 검증 → §2.3 `@axe-core/playwright`(무료) 포함
  - `e6bacd7e` 종료조건·수렴실패 개입 → §2.3 최대3회+통과기준+대표 에스컬레이션
  - `0eaca56c` Phase3 대상 미확정 → §1·§4 BC 랜딩 1페이지 확정 (D4)
- **에스컬레이션 2건 = 반박 수용(D5)**: `68abb56a`(병존 우선순위 지침 본문 실재), `51a43bc0`(알림부담 — e6bacd7e 수렴실패 개입으로 흡수). 별도 추가 없음.

### v2 재검증 (2026-07-02)
- 개정본 재검증 → 여전히 **수정필요**(합의 4·에스컬레이션 3). v1 5건은 해소, 하드게이트 심화 결함 노출.
- **합의 4건 반영**:
  - `200a228c` **blocker** — stylelint이 Tailwind className·JSX inline-style 미검사 → §2.5를 **ESLint 주게이트(tailwindcss+inline-style 금지) + stylelint 보조**로 교체
  - `58dd4d20` 토큰 SSOT 파일 false-positive → §2.5 allowlist 예외
  - `c70d5bdc` Phase3 타이밍 자기모순 → §1·§4 '대상 조기확정 + 실행은 Phase1/2 뒤'로 정정
  - `e6a4e91d` PreToolUse≠커밋게이트·전역스코프 → §2.5 실제 게이트=git pre-commit+CI, 훅은 fast-feedback·DS프로젝트 스코핑
- **에스컬레이션 3건 = 반박 수용**: `21e38ef0`(알림피로 재제기 — tail-case 한정 반박), `cdffd051`(게이트 교착 — 임의값만 차단·토큰 통과·override 존재로 반박), `3ffb82a7`(템플릿 폭증 — 지식 SSOT는 규칙블록/위키 중앙화, 템플릿은 per-project 인스턴스값으로 반박). 별도 추가 없음.
- **판단**: 이후 잔여 에스컬레이션은 운영리스크 '의견'(defect 아님)으로 수렴 → 계획 문서로서는 충분. **L2 반복 중단 권고**(추가 라운드는 한계효용 체감).
