# 시각검증 루프 harness (Playwright + axe)

> 구현 후 AI가 실제 렌더 화면을 스크린샷으로 점검·수정·재검증하는 자기폐쇄 루프. 무료(Playwright 로컬 + `@axe-core/playwright`). Chromatic/Percy는 운영단계 이연.

## 선행조건 (L2 85f37b68 — 없으면 루프가 안 돈다)

1. **dev server 기동 + 렌더 가능 라우트**: `next dev`(MC) 또는 `wrangler dev`(Cloudflare/BC). 검증할 페이지 URL이 실제 200 응답해야 함.
2. **baseline 스크린샷 저장소**: `tests/__screenshots__/`(git 관리). 최초 실행 = baseline 등록(diff 아님), 이후 = diff.

## viewport 세트

`1440`(desktop) · `1024`(laptop) · `768`(tablet) · `390`(mobile).

## 루프 절차

1. dev server 기동 확인 → 대상 라우트 접속.
2. viewport별 스크린샷 캡처 → `tests/__screenshots__/{route}-{w}.png` (baseline 없으면 등록).
3. **`@axe-core/playwright`**로 대비/a11y 스캔(WCAG 대비는 육안 불가 → 측정, L2 6cfcd7cf).
4. AI가 점검: 여백·정렬·글자크기·**대비(axe 결과)**·CTA 강조·카드 간격·모바일 깨짐·텍스트 겹침.
5. 문제 → 토큰/컴포넌트로 수정 → 2로 재검증.

## 종료조건 (L2 e6bacd7e — 교착 방지)

- **최대 반복 3회.**
- **통과기준**: 체크리스트 전항목 pass + axe violations 0(critical/serious).
- **미수렴(3회 초과·상충)** → 대표 에스컬레이션. 상시 알림 아님 — tail 케이스만(운영부담 최소).

## 스켈레톤 (Playwright test)

```ts
// tests/visual/ui-verify.spec.ts (발췌 — 활성 시 프로젝트에 맞게)
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const VIEWPORTS = [[1440,900],[1024,768],[768,1024],[390,844]] as const
const ROUTES = ['/'] // 채우기: 검증 대상 라우트

for (const route of ROUTES) {
  for (const [w,h] of VIEWPORTS) {
    test(`${route} @ ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(route)
      await expect(page).toHaveScreenshot(`${route.replace(/\//g,'_')}-${w}.png`)
      const a = await new AxeBuilder({ page }).analyze()
      expect(a.violations.filter(v => ['critical','serious'].includes(v.impact!))).toEqual([])
    })
  }
}
```

## MCP 연동 (Phase 2)

AI가 대화 중 직접 브라우저를 열어 점검하려면 **Playwright MCP**(`@playwright/mcp`)를 `.mcp.json`에 활성. 위 spec은 CI·재현용, MCP는 대화형 점검용 — 병행.
