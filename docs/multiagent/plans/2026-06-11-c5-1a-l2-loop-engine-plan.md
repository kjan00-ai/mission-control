# C5-1a 실행계획 — schema 기반 L2 자동검증 loop 엔진

> MAIA 자율화 로드맵 2단계. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.B + L2 round1 만장일치 반영.
> - 날짜: 2026-06-11 / 작성: claude / 버전: **v2 (L2 round1 반영 — 수동 MVP·canonical id·린터 Warn)**
> - SSOT: 코드=repo(`~/.ai-bootstrap`), 지식/결정=위키 + 위키링크
> - 선행: **C5-0a 완료**(PreToolUse 훅·정책·classifier 재사용) / 후속: C5-0b(commit) → C5-1b/C5-2(MC durable bus + 실 Auto-L2 자동발동)
> - 대표 결재: 로드맵 재배열 승인(2026-06-11) + 세부결재 §7 + §1.1 해석 확인

---

## 0. 한 줄 정의 + L2 round1 핵심 반영

이번 세션 Claude가 **수동으로 4회 수행한 L2 캐치볼**(MAIA 기획 / C5-0a plan / 이 plan / …)을 **재현 가능한 runner**로 코드화. round1(Codex∥Gemini 만장일치) 반영:
- **MVP = 수동 트리거 runner**(완전 Auto-L2 발동은 실 hook/event 확인 후 C5-1b — Codex BLOCKER#1).
- **item_id는 aggregator가 canonicalize**(AI 자체생성 금지 — Codex BLOCKER#2).
- **린터 = Warn+fail-open**(hard-block은 Write만, 위반 시 명확한 필드 지적 — Codex BLOCKER#3 + Gemini BLOCKER#1).
- **★ 모든 round(raw 개별 AI + 수렴 집계) = 위키 md 영구**(§1.1 문서강제 **엄격 유지** — 대표 확정 2026-06-11, Gemini/Codex의 "temp로 빼자"안 기각). 폭증·orphan은 §1.1 내에서 완화: **per-artifact 서브폴더 `reviews/l2/{artifact}/` + 모든 round md에 부모(집계) `[[ ]]` backlink 필수**(orphan 0) + settled 후 선택적 아카이브.

## 1. 목표 / 비목표

### 목표 (산출물)
- **(D1) L2 runner** `~/.ai-bootstrap/l2-loop.js` — `<artifact-md> [--manual]` → Codex∥Gemini 병렬 → **aggregator 집계(canonical id)** → 수렴/심화 → **모든 round md + 수렴 집계를 위키**(§1.1 엄격, 서브폴더+backlink).
- **(D2) verdict 스키마 + parser** — AI 판정을 frontmatter/JSON으로 받되 **aggregator가 canonical_item_id 재부여**. 스키마 준수 실패 시 repair/quarantine.
- **(D3) 문서 린터** `~/.ai-bootstrap/wiki-lint.js` — 파일명/frontmatter/backlink 검출. **반환=경고리스트**(차단 아님).
- **(D4) PreWrite 검증 훅** — **Write만(wiki md) 위반 시 deny + 구체 사유**, Edit/MultiEdit는 **warn**(최종 md 미확정), 린터 오류는 fail-open. C5-0a 훅 인프라 재사용.
- **(D5) 발동 = 수동 트리거**(Claude가 Handoff 전 `l2-loop.js` 호출). 실 Post-Task 자동발동은 C5-1b로 이연.

### 비목표 (제외)
- 완전 자동 Post-Task 발동 + MC durable 버스(`l2_reviews/l2_rounds` 테이블) = **C5-1b/C5-2** / commit·push allow = C5-0b/c / 서브에이전트 킷 = C4B.

---

## 2. L2 runner (D1) — 견고성 강화

`l2-loop.js <artifact-md> [--max-rounds 3] [--deepen-budget 2] [--max-calls 8]`:

```
0. lock: **외부 lockfile만** `~/.ai-bootstrap/tmp/l2/<artifact>.lock` (race 방지). ★ artifact 본문에 마커 삽입 금지 — 검증 대상을 변경하면 artifact_hash 멱등성·정합성 깨짐(smoke round1 Codex BLOCKER). "진행중" 가시화는 별도 status 파일로.
1. 산출물 md + 컨텍스트 로드
2. round r: Codex ∥ Gemini 병렬 (background, process group, 개별 temp 출력, stderr 캡처)
     - 프롬프트 규약(실측 검증됨): "탐색범위=명시 파일만, 코드베이스/transcript grep 금지, 결론(verdict) 먼저"
     - 출력 = D2 스키마. 실패 시 repair-prompt 1회 → 그래도 실패면 quarantine(해당 AI round=parser_status:fail)
3. ★ aggregator 정규화: 각 AI item을 `claim+evidence_refs+severity` 정규화 → **canonical_item_id 발급/병합**(AI가 붙인 id 신뢰 안 함)
4. 항목별 수렴: 만장일치/무반박=settled / 비만장일치=심화 후보
5. 심화: **severity important+ 비만장일치만**(Gemini), deepen-budget 남고 max-calls 미초과 시 쟁점 한정 재질의(범위축소→근거강화→depth2) → r++
6. 종료: 전부 settled→PASS / 잔존 BLOCKER·미합의→escalation-summary(합의/미합의 쟁점/각 AI 1줄/롤백)
7. 산출(§1.1 엄격 — 모든 round 위키 md):
     · raw 개별 AI round = wiki reviews/l2/{artifact}/{artifact}-l2-{ai}-{YYYYMMDD-HHMMSS}-r{n}.md (frontmatter refs에 부모 집계 [[ ]] 필수 → orphan 0)
     · 수렴 집계 = wiki reviews/{artifact}-l2-aggregation-{YYYYMMDD-HHMMSS}.md (모든 round md backlink)
     · ★ run-stamp에 HHMMSS 포함 — 같은 날 재구동 시 덮어쓰기 방지(Gemini smoke). lock은 owner pid 죽으면 자동 회수(stale reclaim).
     · CLI 원시 stdout/stderr·lockfile = ~/.ai-bootstrap/tmp (프로세스 plumbing만, 문서 아님). atomic write로 위키 반영.
     · settled 후 선택적 아카이브(reviews/l2/{artifact}/는 그대로 보존 — 추적 100%).
8. 호출 상한: 2 reviewers × 3 rounds + repair ≤ 8 calls (max-calls 가드)
```

- 병렬 호출: 이번 세션 패턴 코드화 — codex `< /dev/null`, gemini `GEMINI_CLI_TRUST_WORKSPACE=true`, lockfile, atomic write, partial output 파싱 금지, 재실행 시 round 중복 생성 방지. [[l2-cli-invocation-gotchas]].

## 3. verdict 스키마 + parser (D2)

각 AI(frontmatter/JSON):
```yaml
schema_version: 1
artifact_id: c5-1a-plan
artifact_hash: <대상 md canonical hash>
round: 1
reviewer: codex|gemini
generated_at: <ts>
summary_verdict: pass|수정필요
parser_status: ok|repaired|fail
items:
  - item_id: <AI 임의>          # 신뢰 안 함(aggregator가 재부여)
    severity: blocker|important|suggest
    claim: "..."
    evidence_refs: ["file:line","[[doc]]"]
    status: open|resolved|escalate
```
- **aggregator가 부여**: `canonical_item_id`(= `artifact_id`+정규화 claim 해시) + `parent_item_id`(심화 계보). **AI item_id는 입력일 뿐 매칭 키 아님**.
- **hash canonicalization 명세**: YAML 키 정렬 + whitespace 정규화 + `hash` 필드 제외 + 본문 포함. 멱등 기준 고정.
- **스키마 실패 처리**: 추출 실패→repair-prompt 1회→실패시 `parser_status:fail`+quarantine(해당 round 집계 제외, 로그 보존). partial 파싱 금지.

## 4. 린터(D3) + PreWrite 훅(D4) — Warn 우선

- **wiki-lint.js**: 파일명(§2.E.1)·frontmatter 필수키·backlink·orphan 검출 → **반환 = `{ok, violations:[{field, msg}]}`**(차단 아님, 구체 지적).
- **PreWrite 훅**(C5-0a `pre-risk-classify.js` 확장 or 신규 `pre-wiki-lint.js`):
  - **MVP = warn 전용**(deny 없음): wiki md Write를 lint → 위반을 `audit/wikilint-*.jsonl`에 기록만, **차단 안 함**(C5-0a dry-run처럼 측정 우선). ★ 훅은 stateless라 "2회 재시도 후 통과"식 재시도 카운팅 불가(Gemini smoke BLOCKER) → hard-block(deny)+retry는 **TTL 상태파일** 도입하는 별도 단계로 이연. 정확도 실측 후 Write 한정 deny 승격.
  - **Edit/MultiEdit** → 최종 md 미확정이라 **warn만**(post-write lint 또는 C5-1b에서 메모리 적용 후 검증).
  - **린터 오류**(크래시 등) → fail-open(통과+경고). **위반(deny)/오류(allow+warn)/미지원(Edit warn)을 상태코드 분리**(Codex).
  - 적용 범위: wiki `projects/**/*.md`만(repo 코드·일반 md 제외 — 과차단 방지).

## 5. 발동 (D5) — 수동 MVP

- **C5-1a = 수동 트리거**: Claude가 Handoff 작성 전, T2+ 수정 포함 or spec/plan/design 산출 시 `l2-loop.js <artifact>` 호출(백그라운드). (실 Post-Task 자동 hook은 미존재 — C5-1b에서 wrapper/event 확인 후.)
- artifact lock 마커로 미검증 산출물의 후속단계 유출 방지(Gemini).

## 6. 비용 / 리스크 가드
- 복잡도 임계: spec/plan/design/T2+수정만. round cap 3, deepen-budget 2(쟁점당), **총 호출 ≤8**, 백그라운드, relay quota 재사용.
- R: Codex 과탐색(실측 해소 — 탐색가드 프롬프트로 16k tokens) / 비결정 출력→스키마+aggregator canonical id+hash / 린터 교착→Warn+2회후통과 / 문서폭증→**모든 round 위키 + 서브폴더+backlink**(§1.1 엄격) / race→**외부 lockfile**(artifact 본문 미변경) / CLI→process group·lockfile·atomic.
- **★ parser-fail → false-pass 방지(smoke Codex BLOCKER)**: 한 reviewer가 파싱 실패(quarantine)하면 overall을 'pass'로 수렴 금지 → **'incomplete'** 반환 + 재실행/repair. (`overallVerdict` 구현 반영.)
- **★ prompt-echo 파싱 함정(smoke 실측)**: CLI가 프롬프트(=json 템플릿 예시 포함)를 에코 → 첫 json 블록은 무효 템플릿. extractJson은 **마지막 유효 verdict 블록** 채택. (회귀 테스트 보유.)

## 7. 잔여 결재 (대표) — round1 의견 반영
1. **L2 복잡도 임계** = spec/plan/design + classifier T2+ 수정. → **양 AI 승인**. ✅
2. **deepen-budget·round cap** = round 3 / 쟁점당 2, **심화는 severity important+ 비만장일치만**(Gemini). → 승인. ✅
3. **린터 위반 처리** = ~~hard-block~~ → **Warn+fail-open**(Write만 2회 재시도 후 통과, Edit warn). → 양 AI 기각→수정 반영. ✅
4. **발동 자동화** = **수동 트리거 시작**(양 AI 승인), 완전 자동은 C5-1b. ✅
5. **★ §1.1 문서강제** = **엄격 유지 확정**(대표 2026-06-11). 모든 round(raw 개별+수렴)를 위키 md로 영구. "temp로 빼자"(양 AI 제안) **기각**. 폭증·orphan은 §1.1 내 완화: per-artifact 서브폴더 `reviews/l2/{artifact}/` + 모든 round md 부모 backlink 필수 + settled 후 선택 아카이브. → 문서 폭증 BLOCKER는 "대표가 감사추적 우선으로 감수 + 서브폴더/backlink 완화"로 종결.

## 8. 검증 계획
- **dogfounding**: 이 plan을 (이번 세션) 수동 L2로 검증 완료(round1) → v2.
- 엔진 회귀(golden run): 이번 세션 수동 L2 4건(MAIA기획/C5-0a/이 plan)을 runner로 재현 → 동일 BLOCKER 검출 확인.
- 린터 golden fixture(위반 케이스 ≥15) + PreWrite 훅 수동 stdin(Write 위반→deny / Edit→warn / 오류→fail-open).
- aggregator canonical id: 동일 이슈를 다르게 표현한 2 AI 출력 → 1 canonical로 병합되는지 fixture.

## 9. 관련
- 설계: [[2026-06-11-maia-autonomy-overhaul]] §2.B/§2.E.1 / 선행 [[c5-0a-decision-gate-ask-resolution-20260611]]
- L2 근거: [[c5-1a-plan-l2-aggregation-20260611]] / [[maia-autonomy-l2-aggregation-20260611]] / [[c5-0a-plan-l2-aggregation-20260611]]
- 호출 함정: [[l2-cli-invocation-gotchas]]

## 10. L2 검증 결과 (dogfounding round 1 — 2026-06-11)
이 plan을 Auto-L2(Codex∥Gemini, 탐색범위 제한 적용)에 통과 → **만장일치 "수정필요"**(충돌 0건, 심화 불필요). 집계 [[c5-1a-plan-l2-aggregation-20260611]].
- 공통 BLOCKER: 린터 hard-block 과함(→Warn+fail-open) / 문서폭증(→**대표: §1.1 엄격유지**, 모든 round 위키 + 서브폴더 `reviews/l2/{artifact}/`+backlink 완화).
- Codex: D5 자동트리거 미성립(→수동 MVP) / item_id 자동수렴 불가(→aggregator canonical id) / Edit lint 불가(→Write만).
- 전부 v2 반영(§0~§7). **§1.1 = 엄격 유지 확정(대표 2026-06-11)**. 잔여 대표 결재 0 → **착수 가능**.
