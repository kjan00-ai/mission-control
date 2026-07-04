# G2 — pre-image 기밀성 검증 크로스-플랫폼화 (글로벌 flip 실동작 관문) 설계 (2026-07-04)

> **L2 적대검증 대상.** MAIA=글로벌 불변법칙. G2는 글로벌 flip이 Windows(BC/SF)에서 **기능하도록** 만드는 전제. 대상 파일 = `~/.ai-bootstrap/hooks/pre-risk-classify.js`(gate-self T3 → 대표 `!` 적용).

## 문제 (실측)
①b `storePreimage()`의 기밀성 자체검증:
```js
fs.writeFileSync(blob, buf, { mode: 0o600 })
if ((fs.statSync(blob).mode & 0o077) !== 0) throw new Error('pre-image blob perms too open')  // → fail-closed DENY
```
실측: **drvfs(`/mnt/c`)는 unix mode를 무시하고 mode 600 요청을 777로 저장**(Windows 네이티브 node/NTFS도 unix perm 무의미). → `mode & 0o077 = 0o77 ≠ 0` → **항상 throw → fail-closed → 다운그레이드 편집 DENY**.
∴ 글로벌 flip 시 Windows에서 auth/dispatch 등 highRisk 편집이 "T2 승인"에서 **하드 deny로 퇴행**(안전하나 기능 파탄).

## 근본 원인
unix mode(0o077)는 **ext4(WSL 네이티브)에서만 유의미**. drvfs/NTFS에선 unix mode가 표시상 777 고정. 검증이 "파일시스템이 unix mode를 강제한다"를 암묵 전제 → 비-ext4에서 오작동.

## ⚠️ v1 폐기 (L2 blocker `5e0a3492`)
v1(비-ext4에선 ACL에 의존)은 **실제 검증이 아니라 가정** — ACL을 검증하지 않고 "안전할 것"이라 전제 → 멀티유저/OneDrive/상속ACL에서 깨짐. 프로브 예외 폴백도 fail-closed 우회(`d1230239`). **가정을 검사로 대체**해야 함.

## 설계 v2 — 구조적 불변식(home-containment), FS권한 비의존
핵심 재구성: pre-image blob이 담는 것은 **이미 워킹트리에 존재하는 pre-edit 파일 내용의 복사본**이다. 원본 파일은 사용자의 프로젝트/home 트리 안에 그 환경의 보호수준으로 이미 존재한다. ∴ blob을 **같은 사용자 home 트리 안**에 두면 **새로운 노출면을 만들지 않는다**(원본과 동일 보호). 이건 FS 권한/ACL에 의존하지 않는 **플랫폼 독립 구조 불변식**이다.

1. **PRIMARY(전 플랫폼·fail-closed·하드 검사)**: `blob`의 `realpath`가 `realpath(os.homedir())` 하위인지 **assert**. 아니면 **throw(fail-closed)**. → blob 노출 ≤ 사용자 home(=원본 파일·모든 사용자 파일과 동일). 프로브·휴리스틱·ACL조회 **불필요**(결정적).
2. **SECONDARY(mode — dir-enforce 조건부)**: blob을 `mode:0o600`로 write. **EVIDENCE_DIR mode 리드백(`&0o077===0`)으로 "이 fs가 mode를 강제하나" 판정** → **강제(ext4)면 `blob mode&0o077!==0 → throw`(fail-closed 유지, 무회귀)** / **미강제(drvfs 777)면 throw 없음**(containment이 보장, Windows 퇴행 방지). ※ v1의 프로브 없이 dir 자신의 mode로 판정.
3. **디렉토리**: `mkdirSync(EVIDENCE_DIR,{mode:0o700})`(ext4 유효). 비-ext4는 home 트리 소속이 보장.
4. **관측성**: ledger에 `homeContained:true` 기록.

## 보장 범위 (정직한 명시 — 과대약속 없음)
- **보장**: pre-image blob은 **MAIA evidence dir(ext4 mode-700 / Windows 사용자-프로필 ACL) 안**에 보관 — 사용자-프라이빗. ext4는 추가로 blob mode-600(fail-closed).
- **다운그레이드 대상은 secret 아님(정책 연동)**: `secret-code`·`envfile`은 `reversibleClass` 미부여 → **절대 +rev 안 됨 → recordPreimage 미호출**. 즉 pre-image가 생기는 경로는 auth/dispatch/scheduler/relay/i18n 같은 **일반 git-추적 소스**(통상 644)뿐 → evidence dir(700)은 그 원본보다 **더 엄격하거나 동등** = 노출 하향 없음. (`.ssh`/vault류 강보호 파일은 애초에 다운그레이드 비대상이라 blob 미생성 — L2 `2f831269` 반례 배제.)
- **비보장(명시)**: home 트리 자체가 노출된 환경(OneDrive 동기·멀티유저 공유·조직 ACL)에선 **원본 파일도 동일하게 노출** — pre-image는 그 이상을 추가하지 않는다. 즉 이 시나리오는 pre-image 고유 구멍이 아니라 환경 posture 문제. (v1이 ACL을 "안전하다"고 가정했던 것과 달리, v2는 "home과 동일"만 약속 → 검증 가능·정직.)

## 불변식
- ext4/WSL: mode-600 유지(무회귀) + home-containment 추가.
- 전 플랫폼: home-containment 하드 검사 → **fail-closed 강화**(v1보다 강함: 이제 Windows도 실제 검사를 통과해야 저장).
- 프로브·임시파일·플랫폼 휴리스틱 **전부 제거** → `d1230239`·`f04dbc07`·`fead8a10`·`31e9fc3b` 소거.

## 구현 완료 (2026-07-04, ~/p1c/candidates/pre-risk-classify.js recordPreimage)
L2 v2 확정 계약대로 구현. 결함별 해소:
- **`5e0a3492`(가정→검사)**: FS권한/ACL 의존 제거. blob realpath가 **evidence dir 하위 + evidence dir가 home 하위**인지 `pathContained`(경계검사) → 실제 하드 검사.
- **`6945c4c1`(symlink TOCTOU)**: blob write를 **`flag:'wx'`(O_CREAT|O_EXCL)** → 미리 심어둔 symlink 통한 write-through 차단. 테스트: 'wx' throws + target 무변.
- **`54de1bea`/`d209cacf`(경계)**: naive startsWith 대신 **`path.relative` 경계**(`/home/user2` 우회 방어). 플랫폼 case-folding은 각 env 네이티브 `path`가 처리.
- **`8b29bdbb`/`b99fa3c0`(ext4 무회귀)**: **dir mode 리드백**(`statSync(EVIDENCE_DIR).mode & 0o077`)으로 "mode 강제 fs" 판정 → ext4는 여전히 `blob mode&0o077!==0 → throw`(fail-closed 유지), 별도 프로브 없음.
- **`d1230239`(프로브 우회)**: 프로브 자체 제거 → 우회 소지 소거.
- **`b9b2c9ae`(ledger)**: ledger는 동일 evidence dir → 동일 containment(주석 명시).
- 관측성: ledger `confidentiality: 'contained+mode'|'contained'|'clean-git'`.

**검증**: G2 단위 11/11(경계·symlink 탈출차단·O_EXCL·dir-enforce) + c-0 e2e 22/22(ext4 무회귀) + 실측 drvfs(rename/unlink OK, mode 777). ext4는 strict 유지, drvfs/NTFS는 containment이 보장 → 글로벌 flip 전 환경 실동작.

## 적대검증 요청 (v2 의심 축)
- **A. home-containment이 충분한가?** blob 노출이 "원본 파일·사용자 파일과 동일"이면 새 노출 없다는 논리가 타당한가? realpath 심볼릭링크 우회·`..` 탈출 방어 정확한가?
- **B. 보장범위 정직성**: "home과 동일" 약속이 위협모델(단일 소유자)에 충분한가? OneDrive/멀티유저에서 원본도 노출된다는 등가 논증이 성립하나?
- **C. ext4 무회귀**: write+chmod 600으로 ext4 기존 보호가 유지되는가? mode-assert throw 제거가 ext4에서 실질 약화인가(외부 탬퍼링만 놓침 — home접근 이미 필요)?
- **D. realpath 실패/부재파일**: blob 생성 직후 realpath 실패 시 fail-closed 하는가? TOCTOU(assert 후 이동)?
- **E. EVIDENCE_DIR이 home 밖으로 설정될 경우**(MISSION_CONTROL_DATA_DIR류 오버라이드) containment assert가 잡는가?
