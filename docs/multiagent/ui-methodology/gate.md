# 하드 게이트 설정 (D3 — '강제' 실현)

> **핵심(L2 200a228c blocker 반영)**: Tailwind/React의 실제 위반은 `.css`가 아니라 **className 문자열·JSX**에 있다 → stylelint만으론 못 잡는다. **ESLint가 주 게이트**, stylelint은 `.css` 보조. 진짜 차단선은 **git pre-commit + CI**. 전부 무료.

## 계층 (soft → fast → hard)

| 계층 | 도구 | 잡는 것 | 성격 |
|---|---|---|---|
| soft | skill + CLAUDE.md 규칙 | 방향 유도 | 조언 |
| fast | ESLint / stylelint | 임의값·inline-style | 편집 즉시(에디터·`pnpm lint`) |
| fast | PreToolUse 훅 | AI Edit/Write 시점 | 빠른 피드백(커밋 게이트 아님) |
| **hard** | **git pre-commit + CI** | 커밋/머지 전 전량 | **실제 차단 보장선** |

## 1. ESLint (주 게이트)

프로젝트 flat config(`eslint.config.mjs`)에 추가:

- **`eslint-plugin-tailwindcss`** — `no-arbitrary-value`(또는 `no-custom-classname` 병용)로 `bg-[#abc]`·`p-[13px]` 등 arbitrary value 차단.
- **inline-style 금지** — React JSX `style={{}}` 차단. `react/forbid-dom-props`(`props: ['style']`) 또는 `no-inline-styles` 계열 룰.

```js
// eslint.config.mjs (발췌 — 정확한 룰명/버전은 활성 시 확정)
import tailwind from 'eslint-plugin-tailwindcss'
export default [
  ...tailwind.configs['flat/recommended'],
  {
    files: ['**/*.{tsx,jsx}'],
    rules: {
      'tailwindcss/no-arbitrary-value': 'error',
      'react/forbid-dom-props': ['error', { forbid: ['style'] }],
    },
  },
]
```

## 2. stylelint (보조 — `.css`만)

`.css`/전역 스타일의 임의 hex/px 차단:

```json
// .stylelintrc.json (발췌)
{
  "rules": {
    "declaration-property-value-disallowed-list": {
      "/color$/": ["/#/"],
      "/^(margin|padding|gap|width|height)/": ["/\\d+px/"]
    }
  }
}
```

## 3. 토큰 SSOT allowlist (L2 58dd4d20 — 필수)

토큰 정의 파일은 **원시 hex/px를 필수로 보유**(`--color-primary: #2563eb;`)하므로 게이트가 이 파일을 막으면 안 됨. 예외 등록:

- ESLint: `ignores`(flat config) 또는 파일별 override로 토큰 파일 제외.
- stylelint: `overrides`로 토큰 파일에서 위 룰 off, 또는 `ignoreFiles`.
- 대상 예: `app/globals.css`의 `@theme`/`:root` 토큰 섹션, `src/styles/tokens.css`.

## 4. git pre-commit + CI (hard — 실제 차단, L2 e6a4e91d)

PreToolUse 훅은 AI Edit 시점만·수동편집/bash/커밋을 못 잡으므로 **보장선이 아니다**. 실제 차단:

```jsonc
// package.json (devDependencies: husky, lint-staged 추가)
"lint-staged": {
  "*.{ts,tsx,js,jsx}": "eslint --max-warnings=0",
  "*.css": "stylelint"
}
// husky pre-commit: npx lint-staged
```

- CI(GitHub Actions 등)에서 `pnpm lint` + stylelint를 PR 필수 체크로.

## 5. PreToolUse 훅 (fast-feedback, ⚠️ 대표 활성)

AI가 UI 파일에 임의값을 쓰려 할 때 편집 시점 즉시 경고/차단. **주의**:
- **커밋 게이트 아님** — 빠른 피드백용. 보장은 §4가 담당.
- **스코핑 필수(L2 e6a4e91d)**: 전역 훅이면 디자인시스템 **미적용** 프로젝트 UI까지 막는다 → DS 적용 프로젝트로 한정(cwd/마커 기반).
- 훅 등록(`settings.json`)은 게이트 민감 영역 → **대표 활성**(에이전트 자동 등록 금지).
- 기존 훅 인프라(PreToolUse) 재사용 시 전역 decision-gate의 fail-open/override가 적용됨.

## 검증

- 위반 샘플(`bg-[#f00]`, `style={{color:'red'}}`)이 `pnpm lint`에서 error로 잡히는지.
- 토큰 정의 파일이 false-positive로 안 막히는지(allowlist 동작).
- pre-commit이 위반 커밋을 실제로 거부하는지.
