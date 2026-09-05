---
type: ui-methodology-template
title: UI Rules (Enforceable Checklist)
project: <채우기: 프로젝트명>
tier: <채우기: dashboard | service-page>
version: <채우기: 0.1.0>
status: draft
---

# UI Rules — 강제 체크리스트

> AI/개발자가 UI를 작성·수정할 때 **반드시** 지켜야 하는 규칙.
> 대부분 ESLint/stylelint로 하드 게이트되며, 그렇지 않은 항목은 리뷰/검증 루프에서 확인한다.
> 토큰 정의는 [[ui-design-system]] SSOT를 따른다.

## 0. Tier 판정 (먼저 확인)

- [ ] 이 프로젝트 tier = `<채우기: dashboard | service-page>` 임을 확인했다.
- [ ] **dashboard tier** → 아이콘 라이브러리 금지, raw text/emoji만 사용.
- [ ] **service-page tier** → `lucide-react` 아이콘 허용(다른 아이콘 라이브러리는 금지).

## 1. Token-only (SSOT 준수)

- [ ] 모든 색·간격·radius·shadow·타이포·breakpoint·motion 은 [[ui-design-system]]의 **토큰(CSS 변수)만** 참조한다.
- [ ] 새 값이 필요하면 임의로 쓰지 말고 **토큰을 먼저 추가**한 뒤 참조한다.
- [ ] 원시 hex/px 는 토큰 정의 파일(`<채우기: 토큰 파일 경로>`) 안에서만 존재한다.

## 2. 금지 사항 (하드 게이트)

- [ ] ❌ arbitrary Tailwind value 금지 — `bg-[#abc]`, `p-[13px]`, `w-[327px]`, `text-[15px]` 등.
- [ ] ❌ JSX inline-style 금지 — `style={{ ... }}`.
- [ ] ❌ 토큰 파일 밖의 ad-hoc hex/px 금지 — `color: #3366ff`, `margin: 13px`.
- [ ] ❌ tier 규칙 위반 아이콘 라이브러리 import 금지.
- [ ] 위반 시 lint가 실패한다(경고 아닌 error). 우회(eslint-disable) 금지.

## 3. Component-first

- [ ] UI 요소는 인벤토리 컴포넌트([[component-usage]])를 **재사용**한다. 일회성 재구현 금지.
- [ ] 인벤토리에 없는 반복 패턴이 생기면 컴포넌트로 추출하고 [[component-usage]]에 등재한다.

## 4. Responsive-first

- [ ] 4개 기준 뷰포트 **1440 / 1024 / 768 / 390** 에서 레이아웃이 깨지지 않는다.
- [ ] breakpoint 는 토큰(`--bp-*`)에 정의된 값만 사용한다.
- [ ] 모바일(390)에서 가로 스크롤·overflow·텍스트 잘림이 없다.

## 5. 접근성 (a11y)

- [ ] 텍스트 대비(contrast) WCAG AA 이상.
- [ ] 인터랙티브 요소에 접근 가능한 이름/포커스 상태가 있다.
- [ ] `@axe-core/playwright` 위반(critical/serious) 0건.

## 6. Verification-before-done (완료 정의)

작업을 "완료"로 표시하기 전 아래를 증거로 남긴다:

- [ ] Playwright로 **1440/1024/768/390** 스크린샷 캡처.
- [ ] `@axe-core/playwright` 로 대비/a11y 검사 통과.
- [ ] `pnpm lint` (UI 게이트 포함) 통과.
- [ ] 결함 발견 시 수정 → 재검증. **최대 3 iteration**, 초과 시 에스컬레이션(원인·차단점 보고).

## 7. 에스컬레이션 트리거

- [ ] 토큰만으로 표현 불가한 신규 디자인 요구 → SSOT 변경 제안으로 게이트.
- [ ] 3회 반복 내 검증 미통과 → 대표님께 원인 3줄 + 스크린샷과 함께 에스컬레이션.
