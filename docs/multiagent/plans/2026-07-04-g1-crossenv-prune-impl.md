# G1 — pre-image prune/restore 크로스-환경화 (글로벌 flip 전제) 구현 요약 (2026-07-04)

> **L2 적대검증 대상.** MAIA=글로벌 불변법칙 → flip은 전 환경 동시발효. 유일 격차 = Windows(BC/SF) pre-image를 청소할 주체 부재(prune WSL 전용). G1 = WSL cron 하나가 전 환경 ledger 청소. 원본 코드: `~/p1c/candidates/preimage-prune.js`·`preimage-restore.js`(적용 대기).

## 설계

1. **경로변환 `toWslPath(p)`**: Windows 드라이브 경로(`C:\Users\x`·`C:/x`) → `/mnt/<drive>/...`(소문자 드라이브, `\`→`/`). POSIX·비문자열은 그대로. BC/SF는 Windows 네이티브 node라 ledger에 `C:\...` 저장 → WSL이 /mnt/c로 접근해 stat/unlink/git.
2. **다중 ledger 발견 `envLedgers()`**: WSL canonical + manifest `targets.{wsl,windows}.boot`의 각 env `evidence/preimage-ledger.jsonl`. resolved-path dedup. **evidence 디렉토리 존재할 때만 포함**(미생성/미마운트 env는 skip=정상, flag off면 부재).
3. **`run(now, ledgerPath)`**: 단일 ledger 청소. ledgerPath 생략 시 WSL 기본(①c-2 `run(now)` 백워드호환). fs/git은 `toWslPath(e.path/e.blob)` 변환형으로, **rewrite된 ledger엔 원본(네이티브) 경로 보존**(소유 env의 restore가 해석 가능).
4. **`runAll(now, ledgers?)`**: 전 env 집계(pruned/kept/escalated, escalation에 ledger 태깅). ledgers 주입 가능(테스트). CLI=runAll.
5. **restore `--ledger <path>`**: 특정 env ledger 대상. 표시는 네이티브, fs/git은 변환형. `findEntry`는 native·resolved·translated 3형 매칭. `planRestore` **순수함수 불변**(change-guard/need-force/byte-exact 그대로).

## 불변식 (변경 안 함)
- dirty blob(=미커밋 U의 유일본)은 **verified&aged만 삭제**, 미검증/실패는 절대 자동삭제 안 함(overdue 에스컬레이션). git 실패는 graceful degrade(blob 판정은 verdict+ts라 git 불요; clean-record superseded만 age기반으로 강등).
- ledger rewrite FIRST(atomic temp+rename) → unlink. 실패 시 아무 blob도 안 지움(fail-safe).

## 검증 (실측)
- prune: G1 21/21(경로변환·다중ledger·네이티브보존·백워드호환·Windows escalation) + c-2 회귀 23/23. 라이브 runAll no-op(flag off, evidence 부재 → pruned0/ledgers0).
- restore: c-3 회귀 16/16 + 크로스환경 스모크(findEntry byId/byPath·toWslPath·need-force change-guard 보존).

## 적대검증 요청 (의심 축)
- **A. 경로변환 정확성**: UNC(`\\server\share`)·이미 `/mnt/` 형·상대 Windows 경로·드라이브만(`C:\`) 엣지에서 오매핑? need-force/무해 실패로 안전한가?
- **B. 크로스-환경 동시성(핵심 의심)**: Windows 훅이 ledger append 하는 순간 WSL prune이 read→rewrite → **append 유실 가능**(drvfs /mnt/c, 락 없음). 단일 env에도 있던 prune race를 G1이 넓히는가? 심각도·완화(락 필요? daily·희소성으로 수용?) 판정.
- **C. drvfs 특성**: `/mnt/c`에서 `renameSync` 원자성·mode 600 blob의 WSL unlink 권한이 보장되는가?
- **D. 네이티브경로 보존**: rewrite ledger가 원본 `C:\` 경로 유지 → 소유 env(Windows) restore가 그 경로로 정상 복원하는가? WSL restore는 변환형으로 같은 파일 복원하는가(양방향 정합)?
- **E. 백워드호환**: `run(now)` 무인자·`decidePrune`·`planRestore` 시그니처 불변 확인. 기존 c-2/c-3 호출부 무영향?
