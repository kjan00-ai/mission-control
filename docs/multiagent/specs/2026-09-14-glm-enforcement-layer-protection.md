# §0.5 GLM 보호 확대 — 게이트를 강제하는 주체도, 탐지하는 주체도 게이트가 지켜야 한다

- 날짜: 2026-09-14
- 대상: `~/.ai-bootstrap/decision-policy.json` (게이트 SSOT · T3) + `risk-classify.test.js` 가드
- 선행: 핸드오프 carry "`glm-launch.sh` 버전관리 밖" · [[glm-05-governance-gate-live]] · [[glm-phase2-egress-proxy]] · [[2026-09-13-gate-ssot-t1-script-vector-accepted]]
- 상태: **구현·실측·L2 반영 완료 · 대표 `!` 적용 대기**

---

## 0. 지시의 전제부터 정정한다

carry 는 "`glm-launch.sh` 도 `~/.hermes/scripts/` 와 같은 계열(운영 경로인데 git 추적 밖)"이라 적혀 있었다. **실측하니 아니다.**

```
9c90211  chore(glm): glm-launch.sh 추적 전환 — PoC 분류 해제 (대표 승인)
매니페스트: wslOnly.boot 등재 · 트리 clean
```

**이미 추적·등재돼 있었다.** 09-07 시점의 서술이 그 뒤 해소됐는데, 09-13 세션(=필자)이 그 문장을 **검증 없이 spec·핸드오프에 옮겨 적었다.** [[spec-status-text-is-not-evidence]] 의 재범이다.

그래서 "버전관리 편입"은 할 일이 없다. 대신 hermes 구조와 **항목별로 대조**했더니 진짜 갭이 나왔다.

## 1. 실측된 갭 — 게이트가 자기 강제층과 탐지층을 안 지킨다

`{tool, path}` 를 실제 훅 형태로 넘겨 전수 측정(`measure-glm.js`, 파일 121개 × Edit/Write):

| 파일 | 역할 | Edit/Write |
|---|---|---|
| `glm-gate.js` · `glm-policy.json` | 게이트·정책 | **T3** ✅ |
| **`glm-launch.sh`** | §0.5 **유일 진입점**(프록시 기동·실키 env 제거) | **T1/default-write** ❌ |
| **`glm-egress-proxy.js`** | **실키 격리·payload 검사**(BASE_URL 앞단 기술강제) | **T1/default-write** ❌ |
| **`gate-ssot-ledger.js`** | **해시 대장 도구** = 탐지층 전체의 주체 | **T1/default-write** ❌ |

앞의 둘은 `gate-self-glm` 이 **정책·판정 로직만** 잡고 그것을 **실행으로 옮기는 주체**를 빠뜨린 것이다.
세 번째는 L2(`c96f2cf9`)가 잡았다 — 2026-09-13 판정 A 는 `node <스크립트>` 벡터를 **탐지로 커버한다**는 전제였는데,
**그 탐지 주체 자신이 무보호**면 전제가 성립하지 않는다.

## 2. 설계 — glob 확대 + 탐지 주체 규칙 신설

```
- **/.ai-bootstrap/glm-{gate.js,policy.json}
+ **/.ai-bootstrap/glm-{gate.js,policy.json,launch.sh,egress-proxy.js}

+ { id: "gate-self-ledger", class: "T3", nonOverridable: true,
+   glob: "**/.ai-bootstrap/gate-ssot-ledger.js" }
```

기존 `gate-self-*` 규칙의 형태를 그대로 복제한다. **부수 효과가 본 목적이다** — 봉인 보호집합은 `gate-self-*` glob 에서 **유도**되므로, 이 확대만으로 대상 파일이 **해시 대장에 자동 편입**된다. 예방(T3)과 탐지(대장)가 같은 변경에서 나온다.

## 3. 실측

| 축 | 결과 |
|---|---|
| **경로 축** (파일 121 × Edit/Write = 242) | 변경 **8건** — 대상 4파일의 Edit/Write. 나머지 **234건 불변** |
| **명령 축** (코퍼스 42,182 고유 명령) | 상승 **0** · 하락 **0** |
| 시험군 | **421/421** (risk-classify **241** · gate-destructive 127 · policy-classify 53) |
| 비공허성 | 미패치 라이브 정책에서 **T3 가드 3건이 깨진다**(`expected T3 got T1/default-write`), 음성 대조군은 통과 |

경로 축 8건에는 `gate-ssot-ledger.json` 의 `T2/maia-policy → T3` 도 포함된다 — glob 이 끝 앵커가 없어 `…ledger.js` 패턴이 `.json` 까지 잡는 **엔진의 기존 성질** 때문이다(의도한 것은 아니나 방향은 옳다: 대장 위조가 더 어려워진다).

## 4. ★ 내가 여기서 틀렸다 — 없는 문제를 고칠 뻔했다

위 사실을 보고 **"대장 파일이 봉인 집합에 들어가면 봉인할 때마다 해시가 바뀌어 영구 불일치(자기순환)"** 라고 판단해,
`protectedFiles()` 에 `files.delete(LEDGER)` 를 넣고 시험 4건까지 붙였다. 그런데 **비공허성 검사에서 공허**로 나왔다(규율을 빼도 25/25 통과).

파고드니 **두 경로가 다른 함수를 쓴다**:

| 경로 | 함수 | `…ledger.json` |
|---|---|---|
| 분류(T3 판정) | `globToRe` — 끝 앵커 없음 | **잡는다** |
| 봉인 집합 | `expand()` | **안 잡는다** |

규율을 제거한 변형으로 2회 seal + check 를 실제로 돌려 확인했다 — 대장 항목 3개, 매번 일치. **자기순환은 실재하지 않는다.**
`gate-ssot-ledger.js` 는 원본과 byte-동일로 되돌렸다.

> 교훈: **한 경로의 결과로 다른 경로의 동작을 추정하지 않는다.** 분류기가 `.json` 을 잡는다는 실측은 옳았지만, 거기서 "봉인도 그럴 것"으로 건너뛴 것이 틀렸다. 비공허성 검사가 없었으면 불필요한 코드와 공허한 시험이 그대로 남았을 것이다.

시험 4건은 **버리지 않고 남긴다** — 순환이 *없음*을 고정하는 회귀 시험으로 문구를 고쳤다(`expand` 나 glob 처리가 바뀌어 순환이 생기면 여기서 깨진다). 현재 `gate-ssot-ledger.test.js` **25/25**.

## 5. 보류 — Bash DENY 확대(②)는 하지 않는다

같은 조사에서 두 번째 갭이 나왔다. `gate-write-bash`(DENY) 대상 목록:

```
decision-policy.json · c6-policy.json · risk-classify.js
policy-classify.js · /.claude/hooks/ · maia-manifest.json
```

`glm-*` 4종과 `c6-{activate,ready,evidence}.js`(= `gate-self-b-pipeline` 의 T3 집합)가 **빠져 있다.**
그래서 **Edit 은 T3 인데 `sed -i`·`cp` 경유는 T2** 다 — 규칙 이름이 막겠다고 선언한 바로 그 우회다.

그런데 확대해 보니 **비용이 이득을 넘는다**(측정):

- 코퍼스 상승 **10건**인데 대부분 **오탐**이다. 정규식이 `2>/dev/null` 의 `>` 를 쓰기로 오인해, 파일명을 **언급만 한 읽기 명령**이 DENY 된다. 이 세션에서도 실제로 `ls`·`head` 조회와 시험 편집 스크립트가 막혔다
- 진짜 이득(Bash 로 런처 덮어쓰기)은 코퍼스에 **0건**
- 예방이 완성되지도 않는다 — `node <스크립트>` 경유는 여전히 T1(판정 A)

⇒ **①만 적용한다.** 패처에 `withBashDeny` 플래그로 남겨두되 기본 비활성이다. 되살리려면 "언급 텍스트" 오탐 정밀화(09-07 판정 가로 수용된 것)가 선행돼야 한다.

**단, ①이 이 보류의 전제를 복구한다** — 판정 A 가 기대는 탐지층의 주체(`gate-ssot-ledger.js`)가 이제 T3 로 보호되고 대장에도 편입된다.

## 6. 가드 (적용 시 함께)

`risk-classify.test.js` 에 4건 — 양방향으로 고정한다.

| 케이스 | 기대 | 지키는 것 |
|---|---|---|
| `Edit glm-launch.sh` | **T3** | 진입점 |
| `Write glm-egress-proxy.js` | **T3** | 강제층 |
| `Edit gate-ssot-ledger.js` | **T3** | **탐지층**(판정 A 의 전제) |
| `Edit glm-egress-proxy.test.js` | **T1** | **음성 대조** — 시험 파일까지 올리면 시험 수정마다 대표 승인이 필요해진다 |

## 7. 적용·롤백·재봉인

```
node ~/p1c/candidates/glm-protect/apply-glm.js --check | --apply | --rollback
```

안전판은 quote-bypass `apply5` 계승: STAMP 선기록 · 적용 직전 새 백업 + 해시 가드 · 재적용 차단 · 쓰기 실패 시 원복 · **Windows 동기 실패 시 WSL 도 원복**.

- **적용기가 끝에 양쪽 대장 상태를 실측 출력한다.** 숫자를 예측하지 않는다 — 이전 초안이 "Windows 17 → 19" 라고 적었다가 L2(`970ca550`)에 틀린 것으로 잡혔다(`glm-launch.sh` 는 wslOnly 라 Windows 에 없다). 예측 대신 실측을 찍는 편이 안전하고, 한쪽 봉인을 빠뜨린 상태가 즉시 드러난다(L2 `2aeb8464` 부분 수용)
- **롤백 후에도 재봉인이 필요하다**(L2 `e11c2b8f`) — 보호집합이 줄어 대장이 removed 드리프트를 낸다. 적용기가 롤백 경로에서 그 명령을 안내한다
- 재봉인은 **두 환경 모두**(2026-09-14 확인된 함정):

```
node ~/.ai-bootstrap/gate-ssot-ledger.js --seal --reason "§0.5 GLM 보호 확대"
node ~/.ai-bootstrap/gate-ssot-ledger.js --seal --boot /mnt/c/Users/Design/.ai-bootstrap --reason "§0.5 GLM 보호 확대"
```

## 8. 한계 — 이 변경이 막지 못하는 것

L2(`9b302bc0`)가 짚은 실패모드를 명시한다. **파일 보호는 "그 파일을 고쳐서 하는 우회"만 막는다.**

- `glm-launch.sh` 를 한 글자도 안 고치고 **환경변수·인자로 우회**할 수 있다(런처가 참조하는 설정 경로를 바꾸는 등). "유일 진입점"은 **규약**이지 기술 강제가 아니다 — 사용자가 런처를 거치지 않고 직접 CLI 를 띄우면 그만이다
- `node <스크립트>` 경유 쓰기는 여전히 T1 이다(판정 A, 기지·수용). 이 변경은 그 구멍을 닫지 않고, **탐지 주체를 보호해 판정 A 의 전제를 복구**할 뿐이다
- 따라서 보장되는 것은 **가시성**이지 예방이 아니다 — gate-ssot-ledger 와 같은 결의 선택이다

## 9. 범위 밖

- Bash 벡터 갭(§5)은 `glm-*` 뿐 아니라 `c6-{activate,ready,evidence}.js` 에도 열려 있다 — 보류, 별건
- `glm-verify.sh` 는 `.gitignore` 28행 + 매니페스트 `local` 로 **의도적 제외**(PoC 검증용). 건드리지 않았다
- L2 에스컬레이션 `411da2e5`(glob 의 `**/.ai-bootstrap` 하드코딩이 배포 환경에 유연하지 않다)는 **기존 모든 `gate-self-*` 규칙과 같은 형태**라 이 변경만의 결함이 아니다 — refute 유지
