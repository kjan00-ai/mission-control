---
type: ui-methodology-template
title: UI Design System (Token SSOT)
project: <채우기: 프로젝트명>
tier: <채우기: dashboard | service-page>
version: <채우기: 0.1.0>
status: draft
---

# UI Design System — Token SSOT

> 이 문서는 프로젝트의 **디자인 토큰 단일 진실원(SSOT)** 이다.
> 색상·타이포·간격·radius·shadow·breakpoint·motion 모든 값은 여기서 정의하고,
> 나머지 코드(컴포넌트/페이지/스타일)는 **토큰 참조만** 한다.
>
> ⚠️ **원시 hex/px 허용 위치는 이 파일과 토큰 정의 파일(`<채우기: 예) src/styles/tokens.css>`) 뿐이다.**
> 다른 어떤 곳에서도 raw hex(`#abc`)·raw px(`13px`)·arbitrary Tailwind(`bg-[#abc]`, `p-[13px]`)·inline `style={{}}` 를 쓰지 않는다 (ESLint/stylelint 하드 게이트).

## Tier

| 항목 | 값 |
|---|---|
| tier | `<채우기: dashboard | service-page>` |
| 아이콘 규칙 | dashboard = **아이콘 라이브러리 금지 (raw text/emoji만)** · service-page = `lucide-react` 허용 |
| 비고 | `<채우기: tier 선택 근거>` |

## 토큰 정의 방식

- 토큰은 **CSS 변수**로 정의한다 (stack-neutral). Tailwind v3(`theme.extend`) / v4(`@theme`) 양쪽이 동일 변수를 매핑한다.
- 명명 규칙: `--<category>-<role>[-<scale>]` (예: `--color-bg-surface`, `--space-4`, `--radius-md`).
- 토큰 파일 경로: `<채우기: 예) src/styles/tokens.css>`
- Tailwind 매핑 파일: `<채우기: 예) tailwind.config.ts | app.css @theme>`

---

## 1. Color

| CSS var | 값 (raw hex 허용) | 용도 |
|---|---|---|
| `--color-bg-base` | `<채우기>` | `<채우기: 앱 배경>` |
| `--color-bg-surface` | `<채우기>` | `<채우기: 카드/패널 표면>` |
| `--color-fg-default` | `<채우기>` | `<채우기: 본문 텍스트>` |
| `--color-fg-muted` | `<채우기>` | `<채우기: 보조 텍스트>` |
| `--color-border` | `<채우기>` | `<채우기: 구분선/테두리>` |
| `--color-primary` | `<채우기>` | `<채우기: 주 액션>` |
| `--color-primary-fg` | `<채우기>` | `<채우기: primary 위 텍스트>` |
| `--color-success` | `<채우기>` | `<채우기>` |
| `--color-warning` | `<채우기>` | `<채우기>` |
| `--color-danger` | `<채우기>` | `<채우기>` |
| `<채우기>` | `<채우기>` | `<채우기>` |

> 다크모드 사용 시: `<채우기: :root.dark 또는 [data-theme] override 전략>`

## 2. Typography

| CSS var | 값 | 용도 |
|---|---|---|
| `--font-sans` | `<채우기>` | `<채우기: 기본 서체 스택>` |
| `--font-mono` | `<채우기>` | `<채우기: 코드/수치>` |
| `--text-xs` | `<채우기>` | `<채우기>` |
| `--text-sm` | `<채우기>` | `<채우기>` |
| `--text-base` | `<채우기>` | `<채우기: 본문 기준>` |
| `--text-lg` | `<채우기>` | `<채우기>` |
| `--text-xl` | `<채우기>` | `<채우기: 섹션 제목>` |
| `--text-2xl` | `<채우기>` | `<채우기: 페이지 제목>` |
| `--leading-normal` | `<채우기>` | `<채우기: 행간>` |
| `--weight-regular` / `--weight-medium` / `--weight-bold` | `<채우기>` | `<채우기>` |

## 3. Spacing

> 기준 스케일(예: 4px grid). 개별 px는 여기서만 정의한다.

| CSS var | 값 | 용도 |
|---|---|---|
| `--space-1` | `<채우기>` | `<채우기>` |
| `--space-2` | `<채우기>` | `<채우기>` |
| `--space-3` | `<채우기>` | `<채우기>` |
| `--space-4` | `<채우기>` | `<채우기: 기본 간격>` |
| `--space-6` | `<채우기>` | `<채우기>` |
| `--space-8` | `<채우기>` | `<채우기>` |
| `--space-12` | `<채우기>` | `<채우기: 섹션 간격>` |

## 4. Radius

| CSS var | 값 | 용도 |
|---|---|---|
| `--radius-sm` | `<채우기>` | `<채우기>` |
| `--radius-md` | `<채우기>` | `<채우기: 기본 카드/버튼>` |
| `--radius-lg` | `<채우기>` | `<채우기>` |
| `--radius-full` | `<채우기>` | `<채우기: pill/avatar>` |

## 5. Shadow

| CSS var | 값 | 용도 |
|---|---|---|
| `--shadow-sm` | `<채우기>` | `<채우기>` |
| `--shadow-md` | `<채우기>` | `<채우기: 카드 hover>` |
| `--shadow-lg` | `<채우기>` | `<채우기: modal/popover>` |

## 6. Breakpoint

> 검증 뷰포트(1440/1024/768/390)와 정합되게 정의한다.

| CSS var / token | 값 | 대상 뷰포트 |
|---|---|---|
| `--bp-sm` | `<채우기>` | `<채우기: 390 모바일>` |
| `--bp-md` | `<채우기>` | `<채우기: 768 태블릿>` |
| `--bp-lg` | `<채우기>` | `<채우기: 1024 랩탑>` |
| `--bp-xl` | `<채우기>` | `<채우기: 1440 데스크탑>` |

## 7. Motion

| CSS var | 값 | 용도 |
|---|---|---|
| `--duration-fast` | `<채우기>` | `<채우기: hover/press>` |
| `--duration-base` | `<채우기>` | `<채우기: 표준 전환>` |
| `--ease-standard` | `<채우기>` | `<채우기: 기본 easing>` |

> `prefers-reduced-motion` 대응: `<채우기: 감축 전략>`

---

## Allowlist / 게이트 예외

- 이 파일 + `<채우기: 토큰 정의 파일 경로>` 만 lint의 hex/px 예외로 등록한다.
- 예외 등록 위치: `<채우기: 예) .stylelintrc ignoreFiles / eslint overrides>`
