# MCP 연결 — 1단계 (Phase 2, 무료·경량)

> UI 방법론이 쓰는 MCP. **토큰 예산 규율(중요)**: MCP는 tool schema를 컨텍스트에 상시 로드한다 → 다종 상시탑재 금지. **프로젝트별 `.mcp.json`에서 필요할 때만 활성**, 안 쓰면 비활성. 상위 계획 §3.

## 1단계 대상 (전부 무료)

| MCP | 용도 | 패키지 / 명령 | 필수도 |
|---|---|---|---|
| **Playwright MCP** | 대화형 시각검증(브라우저 열기·스크린샷·클릭) | `@playwright/mcp` (MS 공식) | 필수 |
| **Context7 MCP** | 최신 라이브러리 문서 참조(hallucination↓) | `@upstash/context7-mcp` (무료 티어) | 필수 |
| **shadcn MCP** | shadcn 컴포넌트/블록 참조 | `npx shadcn@latest mcp` | 선택 |

> 2단계(Storybook·21st.dev Magic)·3단계(Chromatic/Percy)는 이연. 유료(21st/Chromatic/Percy/v0)는 결재 게이트.

## `.mcp.json` 예시 (프로젝트 루트)

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

## CLI로 추가(대안)

```bash
claude mcp add playwright -- npx -y @playwright/mcp@latest
claude mcp add context7  -- npx -y @upstash/context7-mcp@latest
claude mcp add shadcn    -- npx shadcn@latest mcp
```

## 토큰 예산 규율

- **UI 작업 세션에서만 활성**. 상시 세션에 3종 상시탑재 금지(컨텍스트 잠식).
- 프로젝트 `.mcp.json`은 해당 repo에서 UI 작업할 때만 로드되게 스코핑.
- Context7는 무키 무료 티어로 시작; 한도 초과 시에만 키 검토.

## harness와의 관계

- **Playwright MCP** = *대화형* 점검(AI가 직접 브라우저 열어 확인). [[harness]]의 `*.spec.ts` = *CI·재현용* 자동 검증. **병행** — 역할 분리.

## 활성 시 확인 (인스턴스화 체크)

- [ ] `.mcp.json` 프로젝트 루트에 배치, UI 작업 세션에서 3종 연결 확인.
- [ ] Playwright MCP로 dev server 라우트 스크린샷 1회 성공.
- [ ] Context7로 Tailwind/shadcn 문서 조회 1회 성공.
- [ ] ⚠️ 패키지명·플래그는 버전따라 변동 → 활성 시점 공식 문서 재확인.
