---
name: service-ui-designer
description: Use when creating or modifying service/UI pages, landing pages, dashboards, forms, admin screens, or doing responsive/design-quality work. Enforces the project's code-based design system (tokens + shadcn components) and a Playwright visual-verification loop instead of ad-hoc styling. Reads the project's /docs/ui-*.md and components/ui before generating UI.
---

# service-ui-designer

서비스/UI 페이지를 구현할 때 **디자인 감각에 의존하지 않고**, 프로젝트의 코드기반 디자인시스템과 시각검증 루프에 따라 일관된 UI를 만든다. 규칙 SSOT = 프로젝트 `CLAUDE.md`의 UI 규칙블록 + `/docs/ui-rules.md`.

## tier 판별 (먼저 확인)

프로젝트/페이지의 tier를 `/docs/ui-design-system.md`의 `tier:` 또는 프로젝트 CLAUDE.md에서 확인한다.
- `dashboard` — **아이콘 라이브러리 금지**(raw text/emoji만).
- `service-page` — **lucide-react 허용**.

## 필수 참조 (UI 생성 전 반드시)

1. `/docs/ui-design-system.md` (토큰 SSOT), `/docs/ui-rules.md`, `/docs/page-patterns.md`, `/docs/component-usage.md`
2. `components/ui/*` (기존 컴포넌트), `.storybook/*`(있으면)
3. 토큰 소스: `tailwind.config` 또는 `app/globals.css`의 theme/토큰 섹션
4. MCP(활성 시): shadcn MCP(컴포넌트), Context7 MCP(최신 문서)

## 작업 순서

1. 요구 화면의 **목적**을 파악한다.
2. `/docs/page-patterns.md`에서 **유사 페이지 패턴**을 찾는다.
3. **기존 컴포넌트/스토리**를 확인한다 → shadcn MCP 참조 → **신규 컴포넌트 생성을 최소화**한다.
4. **반응형을 먼저 설계**한다(모바일 우선). breakpoint 토큰만 사용.
5. **토큰만** 사용해 구현한다 — 임의 hex/px/inline-style 금지(§게이트가 차단).
6. 구현 후 **Playwright로 desktop/tablet/mobile(1440/1024/768/390) 스크린샷**을 연다. `@axe-core/playwright`로 대비/a11y 측정.
7. 다음을 점검한다: 여백 · 정렬 · 글자크기 · **대비(axe)** · CTA 강조 · 카드 간격 · 모바일 깨짐 · 텍스트 겹침.
8. 문제 발견 시 수정 → 재검증. **최대 3회**; 미수렴(3회 초과·상충) 시 **대표에게 에스컬레이션**(완료불가 교착 방지).

## 금지 (하드 게이트가 실제 차단 — §gate.md)

- 임의 hex color / 임의 px spacing (토큰 정의 파일 외)
- Tailwind arbitrary value: `bg-[#abc]`, `p-[13px]` 등
- JSX inline-style `style={{}}`
- shadcn/ui 대체 컴포넌트 임의 제작 (기존 우선·점진 확장)
- 페이지마다 다른 버튼 스타일 / 카드 radius·shadow 임의 변경
- **스크린샷·axe 검증 없이 UI 완료 선언 금지**
- `dashboard` tier에서 아이콘 라이브러리 사용 금지

## 완료 기준

기능 정상 + 반응형 정상(4 viewport) + **토큰 준수(lint 통과)** + 시각검증(스크린샷+axe) 통과. 이 중 하나라도 불충족 시 완료 아님.
