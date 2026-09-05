# CLAUDE.md UI 규칙블록 (이식용 스니펫)

> 프로젝트 `CLAUDE.md`에 아래 블록을 삽입한다. **규칙 SSOT는 이 블록** — 스킬(`service-ui-designer`)은 절차만 담고 규칙은 여기를 참조한다(중복 금지, L2 반영). `<tier>` 자리는 프로젝트 값(`dashboard`/`service-page`)으로 치환.

---

```markdown
## UI 작업 규칙 (디자인시스템 — SSOT)

- **tier: <tier>** (`dashboard`=No icon libraries·raw text/emoji / `service-page`=lucide-react 허용)
- 모든 UI 작업은 프로젝트 디자인시스템 기준으로 수행한다. 새 색상/spacing/radius/shadow/typography를 **임의 생성하지 않는다**.
- **토큰만 사용**: Tailwind theme variables / CSS 토큰만. 임의 hex/px는 **토큰 정의 파일에서만** 허용(그 외 전면 금지).
- 금지(하드 게이트가 실제 차단): 임의 hex/px, Tailwind arbitrary value(`bg-[#abc]`·`p-[13px]`), JSX `style={{}}` inline-style.
- **shadcn/ui 컴포넌트 우선**. 새 컴포넌트 생성 전 기존 `components/ui`·Storybook·shadcn MCP를 확인하고 신규를 최소화한다.
- **반응형 먼저**(모바일 우선), breakpoint 토큰 사용.
- 구현 후 **Playwright로 desktop/tablet/mobile(1440/1024/768/390) 스크린샷 + `@axe-core/playwright` 대비/a11y 검증**을 수행한다.
- 텍스트 겹침·여백 불균형·CTA 약화·카드 정렬 오류·모바일 깨짐·대비 미달이 있으면 **완료하지 말고 수정 후 재검증**한다.
- 검증 루프는 **최대 3회**; 미수렴 시 대표에게 에스컬레이션(완료불가 교착 방지).
- **스크린샷·axe 검증 없이 UI 완료 선언 금지.**
- UI 작업 시 스킬 `service-ui-designer`를 사용한다.
```

---

## 삽입 메모

- 이미 프로젝트 CLAUDE.md에 상충 규칙(예: MC의 `No icon libraries`)이 있으면, tier로 조정한다 — `dashboard`는 기존 규칙 유지, `service-page`만 lucide 허용.
- 이 블록은 **규칙**만 담는다. 절차·순서는 스킬, 토큰 값은 `/docs/ui-design-system.md`.
