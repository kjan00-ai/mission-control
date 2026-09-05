# UI 디자인시스템 방법론 (Portable) — SSOT

> 코드기반 디자인시스템 + AI강제 + 시각검증 루프. **이식 가능한 방법론 정본**(크로스 프로젝트, D1). 프로젝트별로 이 폴더의 산출물을 복사·채워 인스턴스화한다.
> 상위 계획: [[../plans/2026-07-01-ui-design-system-methodology]] (PLAN-UI-DS-260701, L2 v2 검증본)

## 3축 전략

1. **코드기반 디자인시스템** — 토큰(color/typography/spacing/radius/shadow/breakpoint/motion) + 공통 컴포넌트 + 페이지 패턴을 코드로 고정.
2. **AI 강제(다층 게이트)** — skill/규칙(soft) → ESLint/stylelint(fast) → git pre-commit/CI(hard).
3. **시각검증 루프** — Playwright 스크린샷(1440/1024/768/390) + `@axe-core/playwright`(대비/a11y), 최대 3회 후 에스컬레이션.

## 산출물 (이 폴더)

| 파일 | 내용 | 활성 위치(인스턴스화 시) |
|---|---|---|
| `SKILL-service-ui-designer.md` | Claude Code 스킬 정본 | 복사 → `.claude/skills/service-ui-designer/SKILL.md` |
| `claude-md-ui-block.md` | CLAUDE.md 규칙블록 스니펫(규칙 SSOT) | 프로젝트 `CLAUDE.md`에 삽입 |
| `gate.md` | 하드 게이트 설정(ESLint/stylelint/allowlist/pre-commit·CI/PreToolUse 훅) | 프로젝트 lint 설정 + `settings.json` |
| `harness.md` | 시각검증 루프 스펙(Playwright + axe) | 프로젝트 `tests/` |
| `mcp.md` | MCP 1단계 연결 가이드 + `.mcp.json` 예시 | 프로젝트 루트 `.mcp.json` |
| `templates/ui-design-system.md` | 토큰 SSOT 레퍼런스 템플릿 | 프로젝트 `/docs/` (채움) |
| `templates/ui-rules.md` | 규칙 체크리스트 템플릿 | 프로젝트 `/docs/` |
| `templates/page-patterns.md` | 페이지 패턴 스켈레톤 | 프로젝트 `/docs/` |
| `templates/component-usage.md` | 컴포넌트 사용법 스켈레톤 | 프로젝트 `/docs/` |

## Portable vs Per-project (D1)

- **Portable(이 SSOT)**: 스킬 정본, 규칙블록, 게이트 설정 패턴, harness 스펙, 문서 템플릿.
- **Per-project(각 repo)**: 실제 토큰값, `components/ui/*`, 채운 문서 4종, `.mcp.json`, lint 설정 활성, tier 지정.

## tier (D2 — 아이콘 규칙 이원화)

- `dashboard` — **No icon libraries**(raw text/emoji). 예: Mission Control 대시보드 코어.
- `service-page` — **lucide-react 허용**(shadcn 기본). 예: BC 랜딩/서비스 페이지.

## 인스턴스화 절차 (프로젝트에 적용)

1. `templates/*` 4종을 프로젝트 `/docs/`로 복사 → 토큰·컴포넌트·페이지 값 채움. tier 지정.
2. `SKILL-service-ui-designer.md` → 프로젝트 `.claude/skills/service-ui-designer/SKILL.md`로 복사(또는 전역 등록).
3. `claude-md-ui-block.md` 내용을 프로젝트 `CLAUDE.md`에 삽입.
4. `gate.md`대로 ESLint(`eslint-plugin-tailwindcss`+inline-style 룰)·stylelint·토큰 allowlist·husky/lint-staged·CI 설정. (PreToolUse 훅은 **대표 활성** — 게이트 민감.)
5. `harness.md`대로 Playwright + `@axe-core/playwright` 설정. `.mcp.json`에 Playwright MCP(+Context7/shadcn) 활성.

## 도구 매핑 (요약)

- **Claude 고유**: 스킬 1(service-ui-designer) · MCP 2~3(Playwright/`@playwright/mcp`, Context7/`@upstash/context7-mcp`, shadcn/`npx shadcn@latest mcp`) · PreToolUse 훅 1.
- **표준 개발도구(강제 주력)**: ESLint+`eslint-plugin-tailwindcss`, stylelint, `@axe-core/playwright`, husky+lint-staged, CI.
- **외부 웹(선택·유료)**: v0(초안), Chromatic/Percy(시각회귀, 후순위).

## 상태

- Phase 1(방법론 산출물): ✅ 완료 — 이 폴더.
- Phase 2(MCP 1단계): ✅ 가이드 작성(`mcp.md`). **활성(claude mcp add / .mcp.json)은 인스턴스화 시점** — 토큰예산상 상시세션 미탑재.
- Phase 3(레퍼런스=BC 랜딩 1페이지 스모크): Phase 1/2 뒤.
- ⚠️ 유료 항목·스택 마이그레이션(Tailwind v3→v4)·PreToolUse 훅 활성 = 각각 별도 결재 게이트.
