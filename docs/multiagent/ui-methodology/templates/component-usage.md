---
type: ui-methodology-template
title: Component Usage
project: <채우기: 프로젝트명>
tier: <채우기: dashboard | service-page>
version: <채우기: 0.1.0>
status: draft
---

# Component Usage

> 인벤토리 컴포넌트별 사용 규약. 반복 UI는 반드시 여기 등재된 컴포넌트를 재사용한다.
> 모든 스타일 값은 [[ui-design-system]] 토큰을 참조하고, [[ui-rules]] 금지사항을 따른다.
> tier 규칙: dashboard = 아이콘 라이브러리 금지(raw text/emoji), service-page = `lucide-react` 허용.

각 컴포넌트 공통 필드:
- **경로**: `<채우기>`
- **목적**: `<채우기>`
- **주요 props**: `<채우기>`
- **variants**: `<채우기>`
- **Do / Don't**: `<채우기>`

---

## Button

- 경로: `<채우기>`
- 목적: `<채우기: 액션 트리거>`
- 주요 props: `variant`, `size`, `disabled`, `<채우기>`
- variants: `<채우기: primary / secondary / ghost / danger>`
- Do: `<채우기>` / Don't: `<채우기: 원시 색상·arbitrary 값 금지>`

## Input

- 경로: `<채우기>`
- 목적: `<채우기: 단일행 텍스트 입력>`
- 주요 props: `label`, `error`, `type`, `<채우기>`
- variants: `<채우기: default / error / disabled>`
- Do: `<채우기: label·에러 상태 필수>` / Don't: `<채우기>`

## Select

- 경로: `<채우기>`
- 목적: `<채우기: 옵션 선택>`
- 주요 props: `options`, `value`, `onChange`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기>` / Don't: `<채우기>`

## Card

- 경로: `<채우기>`
- 목적: `<채우기: 콘텐츠 표면 그룹핑>`
- 주요 props: `<채우기: padding, header, footer>`
- variants: `<채우기>`
- Do: `<채우기: surface/shadow 토큰 사용>` / Don't: `<채우기>`

## Badge

- 경로: `<채우기>`
- 목적: `<채우기: 상태/라벨 표시>`
- 주요 props: `tone`, `<채우기>`
- variants: `<채우기: neutral / success / warning / danger>`
- Do: `<채우기>` / Don't: `<채우기>`

## Modal

- 경로: `<채우기>`
- 목적: `<채우기: 오버레이 다이얼로그>`
- 주요 props: `open`, `onClose`, `title`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기: 포커스 트랩·Esc 닫기·a11y role>` / Don't: `<채우기>`

## Table

- 경로: `<채우기>`
- 목적: `<채우기: 행/열 데이터 표시>`
- 주요 props: `columns`, `rows`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기: 768 이하 가로 스크롤 래핑>` / Don't: `<채우기>`

## Sidebar

- 경로: `<채우기>`
- 목적: `<채우기: 주 네비게이션 (dashboard)>`
- 주요 props: `items`, `collapsed`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기: 768 이하 접힘>` / Don't: `<채우기: dashboard tier는 아이콘 라이브러리 대신 raw text/emoji>`

## Header

- 경로: `<채우기>`
- 목적: `<채우기: 상단 바 (타이틀·액션·사용자)>`
- 주요 props: `title`, `actions`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기>` / Don't: `<채우기>`

## PageContainer

- 경로: `<채우기>`
- 목적: `<채우기: 페이지 폭·패딩 표준 래퍼>`
- 주요 props: `maxWidth`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기: 간격 토큰만 사용>` / Don't: `<채우기>`

## SectionHeader

- 경로: `<채우기>`
- 목적: `<채우기: 섹션 제목 + 설명 + 액션>`
- 주요 props: `title`, `description`, `action`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기>` / Don't: `<채우기>`

## EmptyState

- 경로: `<채우기>`
- 목적: `<채우기: 데이터 없음/초기 안내>`
- 주요 props: `title`, `description`, `action`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기>` / Don't: `<채우기>`

## PricingCard

- 경로: `<채우기>`
- 목적: `<채우기: 플랜/가격 표시 (Landing·Billing)>`
- 주요 props: `plan`, `price`, `features`, `highlighted`, `<채우기>`
- variants: `<채우기: default / highlighted>`
- Do: `<채우기>` / Don't: `<채우기>`

## DashboardCard

- 경로: `<채우기>`
- 목적: `<채우기: 지표/요약 KPI 카드>`
- 주요 props: `label`, `value`, `delta`, `<채우기>`
- variants: `<채우기>`
- Do: `<채우기>` / Don't: `<채우기>`
