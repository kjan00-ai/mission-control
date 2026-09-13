# hermes cron 운영 스크립트를 버전관리로 — canonical + 배포 + 드리프트 탐지

- 날짜: 2026-09-13
- 대상: `~/.hermes/scripts/` (cron 운영 스크립트 6개) · `~/.ai-bootstrap/` (정본·동기기·health)
- 선행: 핸드오프 carry "`~/.hermes/scripts/` 버전관리 밖" (09-07 `glm-launch.sh` 와 같은 계열)
- 상태: **구현·실측 완료 · L2 검증 후 대표 `!` push 대기**

---

## 1. 문제

hermes cron 이 매일/매분 돌리는 운영 스크립트가 **git 추적 밖**이었다. 이력도 원격 백업도 없다.

| 스크립트 | 스케줄 | 하는 일 |
|---|---|---|
| `mc-relay-cron.sh` | every 1m | MC task → Hermes 연동 (가장 잦다) |
| `mc-upstream-check.sh` | 09:00 | upstream 변경 점검 |
| `maia-audit-review.sh` | 09:00 | 게이트 감사 롤링 스냅샷 + 오탐 알림 |
| `c6-daily-batch.sh` | 09:30 | C6 증거 일일 배치 |
| `preimage-prune-cron.sh` | 09:40 | pre-image prune |
| `c6-batch-report.sh` | (미참조) | 잔재 — 이력 보존용으로만 편입 |

실제로 09-13 세션이 `maia-audit-review.sh` 의 **32회 연속 거짓 텔레그램 경보**를 고쳤는데, 그 수정조차 버전관리가 없었다.

## 2. 제약 — 실행본은 옮길 수 없다

```
--script SCRIPT   Path to a script under ~/.hermes/scripts/
```

hermes 가 경로를 고정한다. 따라서 "repo 안으로 옮기고 끝"이 성립하지 않는다.

## 3. 선택지와 채택

| 안 | 구조 | 판정 |
|---|---|---|
| **A (채택)** | canonical `~/.ai-bootstrap/hermes-scripts/`(기존 repo) → 복사 → 실행본. 드리프트 탐지 | 기존 remote·매니페스트·health 재사용. push 게이트 1회 |
| B | `~/.hermes/scripts/` 자체를 git repo 화 | 정본=실행본이라 분기 불가능하나 **신규 remote + 관리 repo 3개** |
| C | 심링크 | 게이트 가시성을 떨어뜨린다(cp-through-symlink 우회 계열) — 배제 |

A 의 유일한 약점은 **복사본 분기**다. 이것은 MAIA 가 C5-2b 에서 이미 푼 문제이므로, 같은 구조(canonical → deploy → drift 탐지)를 그대로 복제해 닫는다.

## 4. 구현

1. **정본** `~/.ai-bootstrap/hermes-scripts/` 6개 (git 추적)
2. **동기기** `hermes-scripts-sync.js` — `--check`(dry-run, 분기 시 exit 1) / apply
   - 대상 목록은 **매니페스트에서 유도**한다(손복사 금지 — 목록이 둘이면 하나는 반드시 낡는다). 항목이 없으면 fail-closed
   - 목적지가 **더 새로우면** 백업 후 덮고 경고 — 조용히 남의 수정을 지우지 않는다
   - canonical 에 있으나 미등재인 파일 = **고아**로 보고(조용히 배포 안 되는 상태를 막는다)
3. **탐지** `maia-health.js` arm 추가 → 분기 시 일일 텔레그램. WSL 전용(`platform === 'linux'`, bridge 제외), hermes 미설치면 skip
4. **등재** 매니페스트 `wslOnly.boot` 에 7건(스크립트 6 + 동기기). Windows 엔 hermes 가 없다

## 5. 실측

| 시험 | 결과 |
|---|---|
| 미등재 상태에서 health | **FAIL 6건 미분류** — 등재를 빠뜨리면 조용히 넘어가지 않는다(함정 확인) |
| 등재 + `maia-deploy` 후 health | **무음** |
| 실행본을 더 새롭게 변조 | `drift-dest-newer` 탐지 · health FAIL · apply 가 **백업 남기고**(프로브 문자열 보존 확인) 정본 복원 |
| 미등재 파일 투입 | `unregistered` 탐지 · exit 1 |
| **실행권한 벗기기(chmod 644)** | ⚠️ **최초 구현은 못 잡았다** — md5 가 같아 `identical` 로 보고. 수정 후 `drift-mode` 탐지 + `CHMOD 755` 복구 확인 |

> ★ 다섯 번째 항목은 **주석에 "없으면 cron 이 조용히 죽는다"고 써놓고 정작 탐지하지 못하던** 결함이다.
> 시험을 돌리지 않았으면 "권한도 보존한다"고 보고했을 것이다. 주장과 거동은 별개로 재야 한다.

## 6. 잔여 위험 · 범위 밖

- **복사본 분기는 여전히 가능하다.** 막는 것이 아니라 **탐지**한다(하루 안에 FAIL). A 안을 택한 대가이며, gate-ssot-ledger 와 같은 결의 선택이다
- `~/.hermes/` 의 나머지(`.env`·`auth.json`·`config.yaml`·DB·세션)는 **secret 혼재로 범위 밖**이다. `scripts/` 만 분리했다
- `cron/jobs.json`(스케줄 정의)도 버전관리 밖이다 — 채널 정보가 섞여 있어 별건 판정 필요
- 09-07 의 `glm-launch.sh` 도 같은 계열이다. 이번 구조를 그대로 확장하면 편입할 수 있다(별건)

## 7. 운용 규약 (신규)

- **hermes cron 스크립트는 canonical 에서만 고친다** → `node ~/.ai-bootstrap/hermes-scripts-sync.js` 1회 → 실행본 동기
- 실행본을 직접 고쳤다면 sync 가 백업을 남기고 경고한다 → 그 수정을 canonical 로 올린 뒤 다시 sync
- 새 스크립트를 추가하면 **매니페스트 `wslOnly.boot` 에 `hermes-scripts/<이름>` 으로 등재**한다(안 하면 health 가 고아로 잡는다)
