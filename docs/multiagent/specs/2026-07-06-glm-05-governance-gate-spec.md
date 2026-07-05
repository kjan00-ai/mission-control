# §0.5 GLM 운영 거버넌스 게이트 — 설계 spec (v0.1)

- date: 2026-07-06
- status: v0.2 (L2 codex∥gemini 반영 — blocker3+important5 전건 corroborated·수렴)
- owner: claude
- refs: `plans/2026-07-02-glm52-poc-plan.md` §0.5(L62-70)·§0(L40-58) / `reports/2026-07-05-glm52-poc-full-run-verdict.md` §5 / `specs/2026-07-05-l2-tier-panel-wiring-spec.md`
- 승인: 대표 approach 승인(2026-07-06) "판정하지 말고 뒤집는다 — fail-closed opt-in + 2차 content scan"

## 1. 문제 (why)

GLM-5.2 full 24런 → **대표 조건부 Go**. §0은 *PoC 진입*만 통제한다. Go로 GLM이 상시 생성자로 편입되면 **실 프로젝트 데이터가 z.ai로 상시 흐른다**. §0.5는 운영단계 데이터 거버넌스를 별도 강제한다 — **미통과 시 Go여도 상시 편입 보류**(plan.md:64). §0.5 = 후속 3건(§6-3 티어패널 배선 / concordance 상시지표 승격 / 보험·금융 하드경계 코드게이트화)의 유일 unblocker.

**z.ai ToS 하드경계**(plan.md:51-53): Additional Terms §1.f.iii가 `healthcare, finance, investments, insurance, credit, …`를 improper use로 **명시 금지**. §III(미국)이 GLBA NPI·HIPAA PHI·COPPA 처리/전송 금지. → 보험/금융 도메인 코드·데이터의 GLM 유입 = **약관위반**(비가역).

**확정 도메인 분류**: BC = 보험/금융(deny) · SF = 비보험(opt-in 후보) · MC = 비규제(PoC 호스트).

## 2. 핵심 아키텍처 제약 (설계 전제)

기존 MAIA 게이트(`pre-risk-classify.js`, PreToolUse)는 **도구 동작 레이어**만 가로챈다. GLM으로 나가는 프롬프트/완성 페이로드는 `ANTHROPIC_BASE_URL` egress 스트림이라 **어떤 훅도 검사하지 못한다** → R1을 기존 게이트로 못 막음.

- **GLM 유일 현재 진입점 = `~/.ai-bootstrap/glm-launch.sh:39 exec claude`** (base-URL/키를 z.ai로 스왑 후 stock `claude` exec). 게이트를 여기서 강제한다.
- **글로벌 법칙 준수**: 게이트 *정책·로직*(`glm-policy.json`·`glm-gate.js`)은 shared=글로벌(manifest 배포). 강제는 GLM 호출 모든 진입점 — 현재 정확히 1곳. **불변 계약(C-ENTRY)**: 향후 새 GLM 진입점(Windows 런처·l2-loop glm 리뷰어·직접 env 스왑 래퍼)은 반드시 `glm-gate`를 선(先)조회해야 한다. 정책 글로벌 + 진입점 계약으로 격차를 닫음(스코프 회피 아님).

## 3. 설계

### 3.1 `glm-policy.json` (글로벌 config, shared)
```jsonc
{
  "_meta": { "spec": "0.5", "canonical": "wsl", "note": "GLM 운영 거버넌스 — opt-in 편집=대표 보증(T3)" },
  "mode": "fail-closed",
  "domainDenylist": [               // 항상 deny·non-overridable. allowlist에 있어도 이김.
                                    // path = canonical 절대경로(경계매치, 서브스트링 아님).
    { "path": "/mnt/c/…/best-consulting-hp", "domain": "insurance/finance", "reason": "z.ai ToS §1.f.iii" }
  ],
  "projectAllowlist": [],           // 기본 빈 배열 = 대표 opt-in 전엔 전부 deny(fail-closed).
                                    // opt-in 시: { "path": "<canonical 절대경로>", "domain": "general",
                                    //             "attestedBy": "owner", "date": "YYYY-MM-DD" }
  "contentScan": {
    "enabled": true, "action": "warn",        // warn(기본, detective) | block. 하드경계는 denylist가 block.
    "scope": "git-tracked",                    // git repo=추적소스만(벤더 자동제외), 비-git=tree 폴백
    "maxFiles": 4000, "maxBytesPerFile": 1048576,
    "skipDirs": [".git","node_modules",".venv","venv","site-packages","__pycache__","dist","build",".next"],
    "skipFileRe": "(\\.min\\.|\\.map$|\\.(png|jpe?g|gif|pdf|zip|woff2?|ttf|ico|lock|wasm)$)"
  },
  "retention": { "source": "R3 조사", "ref": "wiki references/reference_glm_zai_data_governance.md" }
}
```

### 3.2 `glm-gate.js` (순수 로직, `risk-classify.js` 패턴 미러) — v0.2(L2 반영)
- `gate({cwd, addDirs, policy})` → `{decision:'allow'|'deny', reason, matched, scanHits}`.
- **평가 대상 = `targets = {cwd} ∪ addDirs`** — GLM에 노출되는 모든 디렉토리. 판정은 **각 target에 개별 적용**(L2 `feaab50f`: allowlist를 cwd에만 적용하면 미승인 addDir로 유입).
- **판정 순서 (highest-deny wins, 각 target D에 대해)**:
  1. 어떤 `domainDenylist` 엔트리가 D를 커버 → **deny**(non-overridable, 최우선).
  2. **모든** D가 어떤 `projectAllowlist` 엔트리에 커버돼야 함. 하나라도 미커버 → **deny**(fail-closed 기본).
  3. `contentScan.enabled`면 모든 target 파일 스캔 → 매치 시 action=block이면 **deny**, warn이면 allow+경고.
  4. else **allow**.
- **경로 매칭 = 정규화 절대경로 경계매치(서브스트링 폐기)** (L2 `860c6ff5`·`4e0a1a33`): 엔트리·target 모두 `realpath`→lowercase→`\`→`/`→후행슬래시 제거로 **정규화 절대경로**화. 엔트리가 D를 커버 = `D === entry || D.startsWith(entry + '/')`(경로 경계). 서브스트링 매치 금지 — `/home/bestconsulting`(홈) 오탐·BC 실경로(하이픈 표기차) 누락 방지. denylist/allowlist 엔트리는 **canonical 절대경로**로 기재(예: BC repo 루트 절대경로). `/mnt/c/...` Windows 경로 포함.
- **content-scan 한도 처리** (L2 `f6770209`): `maxFiles`/`maxBytesPerFile` 초과로 target을 완전 스캔 못 하면 = **스캔 불완전 = fail-closed**(action=block→deny, warn→경고). reason=`scan-incomplete`. 대형 repo/파일이 스캔 밖으로 새는 것 차단.
- **감사(R2)**: 매 호출 결과를 `~/.ai-bootstrap/audit/glm-YYYYMMDD.jsonl`에 **O_APPEND 원자쓰기**(mode 600, JSON 1줄/이벤트=손상격리) `{ts,cwd,addDirs,decision,reason,matched,scanHits}` (L2 `27027137`).
- **fail-closed**: 정책 파일 없음·파싱오류·스캔 예외·스캔 불완전 등 **모든 불확실 → deny**(도구게이트 fail-open과 반대. 스테이크가 ToS/PII). 단 감사쓰기 실패는 deny를 막지 않음(로그 best-effort, 결정은 유지).
- **CLI**: `node glm-gate.js --cwd <path> --dirs <csv>` → exit 0 allow / **exit 3 deny**(+stderr 한국어 사유). 그 외 exit≠0 = 내부오류=런처가 fail-closed 처리.

### 3.3 `glm-launch.sh` 배선
`exec`(현 L39) 직전 삽입:
- `"$@"`에서 `--add-dir <v>` / `--add-dir=<v>` 파싱 → CSV.
- `node "$HOME/.ai-bootstrap/glm-gate.js" --cwd "$PWD" --dirs "$DIRS"` 호출.
- 반환 non-zero → 사유 stderr 출력 + **exit(런치 거부)**. node 미존재/실행실패도 거부(fail-closed).
- 통과 시에만 기존 `exec env … claude "$@"`.

### 3.4 content-scan (git-tracked scope + warn — 실측 보정 2026-07-06)
- **범위 = git-tracked**(`git ls-files -z`, execFileSync no-shell): git repo는 **추적 소스만** 스캔 → `.venv`·node_modules·gitignore·생성물 자동제외. 비-git 디렉토리는 bounded tree-walk(skipDirs+maxFiles) 폴백.
- **action = warn**(기본): PII 발견 시 런치 **차단 안 하고 경고만**. 하드경계(보험/금융 ToS)는 domainDenylist가 block으로 강제하므로, 2차 스캔은 detective(탐지) 통제. block 모드도 지원(정책 선택).
- **패턴(한국형 고정밀, 단위증명)**: 주민번호 `\b\d{6}[- ][1-4]\d{6}\b`(구분자 필수=정수리터럴 오탐↓)·사업자 `\b\d{3}-\d{2}-\d{5}\b`·카드 `\b(?:\d{4}[-\s]){3}\d{4}\b`(구분자 필수)·계좌/보험/증권 키워드근접. false-positive 가드=단위테스트(UUID·git sha·타임스탬프·연속숫자 무매치).
- **실측 보정 근거(L2 `f6770209` 해소)**: 전-트리 스캔은 SF(StarFollow) 실측 **109초·오탐 8건**(Stripe 테스트카드·tzdata·botocore 벤더)으로 대형 repo를 오히려 잠금 → git-tracked로 **2.3초·오탐 1건**(README, 무해). 대표 결정 = git-tracked+warn(2026-07-06).
- **정직한 한계**: 런처는 **파일**만 스캔 — 대화형 입력 프롬프트는 못 봄. 완전 per-request 마스킹 = **Phase 2 egress 프록시**(ANTHROPIC_BASE_URL 앞단).

## 4. R1/R2/R3 통과기준 매핑

| 요구 | 통과기준(plan.md:68-70) | 충족 방식 | 상태 |
|---|---|---|---|
| **R1** | 강제필터/마스킹 **또는** 도메인코드 GLM배치 제외 | **옵션(b) 도메인제외로 통과기준 충족** = allowlist fail-closed(각 target) + BC denylist → 보험/금융 프로젝트는 GLM 실행 자체 불가 → ToS위반 시나리오 원천차단. 콘텐츠필터(옵션a)=심층방어: 파일 content-scan(now, 부분) + 대화형 프롬프트 완전커버(egress 프록시 **Phase2**). ⚠️대화형 붙여넣기는 통과기준 누락 아님 — 옵션(b)로 충족·필터는 Phase2 이연(L2 `6fb0fa41`·`c295897f`) | 이 spec |
| **R2** | 엔드포인트/키 접근 주체·범위 제한 + 감사로그 | MVP=인가경로(glm-gate) 강제 + 키격리(G4: .env 600·repo외·미커밋·전역 settings/env 미주입) + 런치별 감사. **통과기준(주체·범위 제한+감사) 충족**. ⚠️잔여=owner 직접 env 스왑 자기우회(도구게이트 `!` owner-only 동급, 런처레벨 폐쇄불가). **기술적 완전 subject-제한 = Phase2 egress 프록시**(키를 프록시만 보유·.env 평문키 제거·gate승인 런치에만 주입). 탐지통제=shared 스크립트 `ANTHROPIC_BASE_URL.*z\.ai` grep 린트(L2 `006b4356`·`3c18b345`) | 이 spec |
| **R3** | z.ai 보관기간·삭제경로 확인 | WebFetch z.ai privacy/terms → 문서화. 산출=wiki reference(ToS §1.f.iii/§III/§IV 통합, dangling 스텁 해소). 미공시 시 API opt-in 무학습(G3)+삭제요청 경로 완화통제 결론+잔여리스크 | 조사 태스크 |

## 5. 보안 불변식 (invariants)
- **I1** domainDenylist는 어떤 경로로도 downgrade 불가(non-overridable).
- **I2** allowlist 미등재 = deny(fail-closed). 빈 정책 = 전부 deny.
- **I3** gate 내부오류 = deny(fail-closed).
- **I4** glm-gate.js·glm-policy.json = T3 자기보호(에이전트 자가편집 deny, 대표 `!`만). opt-in 편집=대표 보증.
- **I5** C-ENTRY: 새 GLM 진입점은 gate 선조회 의무.

## 6. Rollout & 검증
- **에이전트 작성(T0/T1)**: glm-gate.js·glm-gate.test.js.
- **T2 ask**: glm-policy.json·maia-manifest.json.
- **T3 대표 `!`**: decision-policy.json(자기보호 등재)·maia-deploy.
- **순서**: L2(이 spec)→gate+테스트→policy→launch 배선→[대표 `!`]자기보호+manifest+deploy→R3 조사.
- **검증 E2E**: 단위 전건 pass / BC dir→deny·미등재→deny·SF(attested)→allow / 화이트리스트에 가짜 주민번호 심기→scan 차단 / `audit/glm-*.jsonl` allow+deny 기록 / `maia-deploy --check` 0 unclassified·0 drift.

## 7. 비목표 (non-goals)
- per-request egress 완전차단(Phase 2).
- GLM을 l2-loop 리뷰어로 배선(§6-3, §0.5 통과 후).
- maia-deploy 전 프로젝트 전파(Go + §0.5 통과 후).

## 8. L2 반영 로그 (v0.2, codex∥gemini round1+2, 2026-07-06)
집계 [[2026-07-06-glm-05-governance-gate-spec-l2-aggregation-20260706-002756]] — blocker3+important5 전건 양 reviewer corroborated.

| id | 유형 | 반영 |
|---|---|---|
| `feaab50f` | blocker | allowlist를 cwd에만 적용→미승인 addDir 유입. **각 target({cwd}∪addDirs) 개별 판정, 모든 D가 allowlist 커버 필수**(§3.2 수정) |
| `860c6ff5`·`4e0a1a33` | important×2 | 서브스트링 매치의 오탐(`/home/bestconsulting`)·누락(하이픈 표기차). **정규화 절대경로 경계매치**로 교체, 엔트리=canonical 절대경로(§3.1·§3.2 수정) |
| `f6770209` | important | scan 한도 초과 시 fail-closed 미정의. **한도초과=스캔불완전=fail-closed(reason scan-incomplete)**(§3.2 추가) |
| `6fb0fa41`·`c295897f` | blocker+imp | 대화형 프롬프트 미스캔인데 R1 충족 over-claim. **R1은 옵션(b) 도메인제외로 통과기준 충족**(보험/금융=GLM 실행불가로 ToS위반 원천차단); 콘텐츠필터=심층방어(파일 now/egress Phase2). 대화형=옵션(b) 커버+owner 고의우회(`!` 동급)(§4 R1 정정) |
| `006b4356`·`3c18b345` | blocker+imp | 직접 env 스왑·신규 진입점 기술적 미차단(R2). **MVP R2=인가경로+키격리+감사로 통과기준 충족**; 기술적 완전 subject-제한=Phase2 egress 프록시(키 단독보유); 탐지통제=`z\.ai` grep 린트(§4 R2 정정) |
| `27027137` | suggest | 감사로그 원자성. **O_APPEND 원자쓰기·mode600·JSON1줄/이벤트**(§3.2) |
| `47910be9` | suggest | attestedBy/date 관리부담. **수용**(의도된 owner 보증, 희소 opt-in) |

**Phase 2 (egress 프록시)로 이연되는 근본 한계**: 대화형 프롬프트 완전차단·직접 env 자기우회 기술적 폐쇄·C-ENTRY 기술강제. MVP는 옵션(b) 도메인제외 + 파일스캔 + 인가경로+감사로 §0.5 R1/R2 통과기준을 충족하되, 이 3개 잔여는 명시적 Phase2 항목으로 문서화(은닉 아님).
