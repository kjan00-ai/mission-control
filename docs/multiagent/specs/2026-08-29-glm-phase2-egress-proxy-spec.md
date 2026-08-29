# GLM Phase 2 — 로컬 인증 egress 프록시 spec (§0.5 근본한계 기술강제)

- **문서유형**: spec (구현 전 동결 대상)
- **작성일**: 2026-08-29
- **상위**: [[2026-07-06-glm-05-governance-gate-spec]] §L117(Phase 2 이연 3한계) / 정책 `~/.ai-bootstrap/glm-policy.json` / 게이트 `~/.ai-bootstrap/glm-gate.js`
- **대상**: 신규 `~/.ai-bootstrap/glm-egress-proxy.js`(+`.test.js`) shared·T2 / 로컬 `glm-launch.sh`(untracked) 재구성 / `maia-manifest.json` 등재. **glm-gate.js·glm-policy.json(T3) 미편집.**
- **대표 결정**: 키 격리 = **Tier A(동일유저)**.

## 1. 문제 (Phase 1 근본한계)
§0.5 게이트(Phase 1)는 `glm-launch.sh` 사용 시 **launch-time에 디렉토리·파일만** 검사. spec §L117이 3한계를 Phase 2로 명시 이연:
1. **대화형 프롬프트 미검사** — 세션 중 프롬프트에 금융/보험/PII 포함 시 미차단(egress 스트림은 어떤 훅도 못 봄, 상위 spec §19).
2. **직접 env 자기우회** — 키가 `~/.glm-poc/.env` 평문 + agent env(`ANTHROPIC_AUTH_TOKEN=$GLM_API_KEY`)에 주입 → 아무 프로세스나 읽어 z.ai 직호출로 게이트 우회.
3. **C-ENTRY 권고수준** — 게이트 조회가 문서계약 + `z\.ai` grep 린트일 뿐 기술강제 아님.

## 2. 해법 = 로컬 인증 egress 프록시
프록시가 **GLM 실키를 단독 보유**하고 `ANTHROPIC_BASE_URL` 앞단(loopback)에서 모든 GLM 트래픽을 가로챈다. agent(child claude)는 실키 대신 **per-launch 세션토큰**만 받는다.

```
claude(agent) --[session token]--> 프록시(127.0.0.1, 실키 메모리) --[real key]--> https://api.z.ai/api/anthropic
                                     ├ 세션토큰 검증(timingSafeEqual)
                                     ├ payload 콘텐츠 검사(scanPatterns) → 금융/보험/PII 히트=차단·미전송
                                     └ 통과 시 실키 주입 + 스트리밍 SSE 투명전달
```

- **키 격리 Tier A**: 프록시가 startup에 `~/.glm-poc/.env`의 `GLM_API_KEY`를 **메모리로만** 읽음. 런처·agent env에 실키 미주입. 키 없음=`exit 1`(fail-closed).
- **per-request egress 검사** = 한계#1 폐쇄(대화형 프롬프트도 검사). **키 env 제거** = 한계#2의 env경로 폐쇄. **프록시=승인경로의 키 초크포인트** = 한계#3 기술강제 — 단 **Tier A 한정 해석(L2 `35b17be9`)**: "env·우발·대화형 경로"에서 프록시 경유가 강제된다는 뜻이지, 동일유저 셸의 고의 키파일 read까지 막는 절대 보장은 아니다(그건 Tier B). "유일 키보유자"의 절대판=Tier B.

## 3. 프록시 계약 (`glm-egress-proxy.js`, Node stdlib http/https/crypto, 무외부의존)
- 재사용: `require('./glm-gate')`의 `scanPatterns`(정규식 SSOT, glm-gate.js L41)·`writeAudit`(L183). 로컬 `scanText(text)`=scanPatterns 루프 래퍼(정규식 미복제 → glm-gate.js T3 미편집). **egress action은 정책 미참조**(L2 `31aa5bf7`) → `loadPolicy` 미사용.
- env 입력(런처 주입): `GLM_PROXY_SESSION`(세션토큰)·`GLM_BASE_URL`(기본 `https://api.z.ai/api/anthropic`)·`API_TIMEOUT_MS`.
- **바인드**: `server.listen(0,'127.0.0.1')` → ephemeral port(loopback 전용). listening 시 `stdout: "READY <PROTO_VERSION> <port>\n"`(`PROTO_VERSION='p2-v1'` 상수 — 런처 계약 강제, L2 `cba187d8`; tmpfile 레이스 회피).
- **요청 처리**:
  1. **세션토큰 검증**(body 읽기 전): `authorization: Bearer`/`x-api-key` vs `GLM_PROXY_SESSION`을 `crypto.timingSafeEqual`(길이 불일치 선차단). 미스=401 `authentication_error`.
  2. **경로**: `/v1/messages`·`/v1/messages/count_tokens`·user content 지닌 POST `/v1/*`=검사경로(count_tokens도 같은 프롬프트 전송이라 비면제). content 없는 GET(model list 등)=인증 후 전달.
  3. **body 버퍼링**: cap 32MB, 초과=413 `invalid_request_error`(미검사 대용량 미전송=fail-closed). 요청 body는 전량 버퍼(응답만 스트림).
  4. **파싱+검사**: `JSON.parse` try/catch, 실패=400 block(미전송, fail-closed). **검사 대상 텍스트(L2 `ef13d33e`)** = `system`(문자열|`{type:text}`배열) + `messages[].content`(문자열|배열, tool_result 중첩 포함) + **`tools[].description` 및 tool `input_schema`의 description/enum 등 prompt-adjacent 텍스트**(민감정보가 tool 정의로 egress되는 경로 포함). 재귀적 텍스트 수집(문자열 노드 전량)→결합→`scanText`.
  5. **판정**: 히트=**block**(업스트림 소켓 미개설, 403 error shape, `writeAudit{kind:'egress-block',path,patterns,decision:'deny'}`). **action=고정 `block` 상수(L2 `31aa5bf7`)** — ToS 하드경계라 정책으로 약화 불가·glm-policy.json 미참조. 클린=forward.
  6. **forward**: `https.request`(테스트 http 폴백=`UPSTREAM.protocol` 분기)로 z.ai. client auth 헤더 스트립(`authorization`/`x-api-key`) + **실키 주입**(`x-api-key: REAL_KEY`, `authorization: Bearer REAL_KEY`). **`Host` 헤더 = upstream host(api.z.ai)로 설정(L2 `8192e072` — client의 `127.0.0.1:PORT` Host 보존 금지)**, `anthropic-version` 보존. 버퍼 body write.
  7. **스트리밍**: 업스트림 response `pipe(res)`(SSE 투명, content-length 미설정). `egress-allow` 1회 audit(**payload 미기록** — 감사에 민감내용 안 남김).
  8. **에러**: 업스트림 timeout=504·err=502·핸들러 try/catch=500(스택 미노출), 이중 writeHead 가드. SIGTERM/INT→`server.close()`+exit0.
- `respondErr(res,status,type,msg)` = `{"type":"error","error":{"type","message"}}`(Claude Code 해석 → 차단이 정상 API 에러로 표면화, 세션 안 걸림).

## 4. 런처 재구성 (`glm-launch.sh`, 로컬 untracked, `.gitignore:27`)
- launch-time 디렉토리 게이트 **그대로 유지**(`glm-gate.js --cwd --dirs`, exit3=deny).
- **실키 소싱(`set -a; . ENVFILE`) 제거** — Tier A: 런처는 실키 안 읽음(프록시가 읽음). `GLM_BASE_URL/MODEL`(비밀 아님)만 기본값.
- 세션토큰=`node -e 'crypto.randomBytes(32).hex'`. `coproc`로 프록시 기동(`GLM_PROXY_SESSION`·`GLM_BASE_URL` 주입).
- **핸드셰이크(L2 `7ef44462`·`cba187d8`)**: 프록시 listening 시 stdout 첫 줄 `READY <proto> <port>`(예 `READY p2-v1 41xxx`). 런처 `read -r _tag PROTO PROXY_PORT <&"${PROXY[0]}"` → `_tag=READY` && `PROTO` == 런처 상수 `EXPECTED_PROTO=p2-v1` && `PROXY_PORT` 숫자 검증. **불일치(버전 drift)=exit4**(untracked 런처↔shared 프록시 계약 강제). `trap cleanup EXIT INT TERM`(프록시 kill).
- **foreground** `claude "$@"; cleanup`(exec 금지 — 트랩 teardown 위해). env: `ANTHROPIC_BASE_URL=http://127.0.0.1:$PORT`·`ANTHROPIC_AUTH_TOKEN=$SESSION_TOKEN`(실키 아님).

## 5. 배포·게이트
- shared 신규 2파일(`glm-egress-proxy.js`·`.test.js`)=`maia-manifest.json shared.boot` 등재(미등재=unclassified LOUD). WSL canonical 편집→`maia-deploy`→Windows byte-identical. 런처=untracked env-class(미동기, 절대경로로 shared 프록시 참조=현 glm-launch↔glm-gate 방식 동형).
- 신규 파일·manifest=T2(ask). glm-gate.js·glm-policy.json(T3) 미접촉. push=T3 대표 `!`.

## 6. 한계 (정직 — 상위 spec §100·§8 계승)
- **Tier A 잔여**: agent가 `bestconsulting` 유저·셸 보유 → `cat ~/.glm-poc/.env`로 실키 읽어 z.ai 직호출 가능(동일유저 600 파일 read 기술적 미차단). = 고의 우회, 대표 `!` 동급. 탐지통제=`z\.ai` grep 린트. **Tier B(별도유저 glm-proxy, sudo)** = 이 잔여까지 폐쇄하는 하드닝 옵션(문서화, 미구현).
- **정규식 한계**: 인코딩/난독/의역된 PII는 scanPatterns 미탐(필터지 증명 아님). 파일스캔과 동일 시그니처(오탐 최소화 튜닝).
- **범위**: GLM egress 전용 — z.ai 외 임의 엔드포인트 exfil은 미통제(일반 네트워크 방화벽 아님).
- **Phase 2가 폐쇄**: 대화형/headless 프롬프트 egress 검사(#1)·키 env 제거(#2 env경로)·프록시 필수 초크포인트(#3 토큰보유 트래픽).

## L2 검증 이력 (codex ∥ gemini, 2026-08-29)
> 원장: reviews `2026-08-29-glm-phase2-egress-proxy-spec-l2-aggregation-20260829-143657`(+r2). 2라운드, **settled 6 전건 반영**(escalate 0).
- `8192e072`(blocker): forward Host를 client(127.0.0.1)로 보존=z.ai 깨짐 → **Host=upstream(api.z.ai)** 설정.
- `ef13d33e`: `tools[].description`/schema 텍스트 미검사 → 검사대상 확대(prompt-adjacent 전량 재귀수집).
- `31aa5bf7`: "policy.egress 존중" vs "미의존" 모순 → **egress action=고정 block 상수**(정책 미참조).
- `35b17be9`: "유일 키보유자/기술강제" over-claim → Tier A 한정 해석 명확화(절대판=Tier B).
- `7ef44462`+`cba187d8`: 런처 핸드셰이크 문구 오류·버전 drift → `READY <proto> <port>` + `EXPECTED_PROTO` 계약검증.

## 7. 검증
- `node glm-egress-proxy.test.js`(8케이스: 금융/PII block·클린 forward+스트림·토큰미스 401·count_tokens 차단·GET 전달·parse실패 fail-closed·oversized 413·scanText 단위)·`node glm-gate.test.js`(34/34 회귀0).
- `maia-deploy --check` 0 drift·0 unclassified.
- E2E: glm-launch 세션에서 `printenv ANTHROPIC_AUTH_TOKEN`=세션토큰(실키 아님)·금융 프롬프트 403·audit `egress-block` 기록.
