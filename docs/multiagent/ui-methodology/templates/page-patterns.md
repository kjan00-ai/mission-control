---
type: ui-methodology-template
title: Page Patterns
project: <채우기: 프로젝트명>
tier: <채우기: dashboard | service-page>
version: <채우기: 0.1.0>
status: draft
---

# Page Patterns

> 프로젝트의 페이지 유형별 골격. 각 패턴은 레이아웃 구조·필수 컴포넌트·반응형 노트를 정의한다.
> 컴포넌트는 [[component-usage]] 인벤토리를, 토큰은 [[ui-design-system]] SSOT를 참조한다.
> 사용하지 않는 패턴은 삭제하지 말고 `사용 안 함`으로 표기한다.

각 패턴 공통 필드:
- **경로**: `<채우기: route>`
- **레이아웃 구조**: `<채우기>`
- **필수 컴포넌트**: `<채우기>`
- **반응형 노트 (1440/1024/768/390)**: `<채우기>`

---

## Landing (service-page 중심)

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: hero → features → pricing → CTA → footer>`
- 필수 컴포넌트: `PageContainer`, `SectionHeader`, `PricingCard`, `Button`, `<채우기>`
- 반응형 노트: `<채우기: 390에서 hero 세로 스택, 그리드 1열>`

## Auth (Login / Signup)

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 중앙 정렬 카드, 단일 컬럼>`
- 필수 컴포넌트: `Card`, `Input`, `Button`, `<채우기>`
- 반응형 노트: `<채우기: 모든 뷰포트 단일 컬럼, 390 full-width 카드>`

## Dashboard (overview)

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: Sidebar + Header + 지표 카드 그리드>`
- 필수 컴포넌트: `Sidebar`, `Header`, `PageContainer`, `DashboardCard`, `Table`, `<채우기>`
- 반응형 노트: `<채우기: 768 이하 Sidebar 접힘, 카드 그리드 2→1열>`

## Settings

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 좌측 섹션 네비 + 우측 폼>`
- 필수 컴포넌트: `SectionHeader`, `Input`, `Select`, `Button`, `Card`, `<채우기>`
- 반응형 노트: `<채우기: 768 이하 네비 상단 탭으로 전환>`

## Form Wizard (multi-step)

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: step indicator + step 폼 + prev/next>`
- 필수 컴포넌트: `Card`, `Input`, `Select`, `Button`, `<채우기: step indicator>`
- 반응형 노트: `<채우기: 390 step indicator 축약, 버튼 하단 고정>`

## Report

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 필터 바 + 요약 카드 + 표/차트>`
- 필수 컴포넌트: `PageContainer`, `SectionHeader`, `DashboardCard`, `Table`, `<채우기>`
- 반응형 노트: `<채우기: 표는 768 이하 가로 스크롤 컨테이너>`

## Admin List (index)

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 검색/필터 + 액션 + 페이지네이션 테이블>`
- 필수 컴포넌트: `Table`, `Badge`, `Button`, `Input`, `EmptyState`, `<채우기>`
- 반응형 노트: `<채우기: 768 이하 카드형 행 전환 여부>`

## Detail

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 헤더 + 본문 섹션 + 사이드 메타>`
- 필수 컴포넌트: `SectionHeader`, `Card`, `Badge`, `Button`, `<채우기>`
- 반응형 노트: `<채우기: 1024 이하 사이드 메타 본문 아래로>`

## Billing

- 경로: `<채우기>`
- 레이아웃 구조: `<채우기: 현재 플랜 + 플랜 비교 + 결제수단/청구내역>`
- 필수 컴포넌트: `PricingCard`, `Card`, `Table`, `Badge`, `Button`, `<채우기>`
- 반응형 노트: `<채우기: 390 플랜 카드 세로 스택>`
