# GoPeak 터미널 훅 기반 업데이트 알림 & 온보딩 시스템

> **상태**: 계획서 (유저 승인 대기)
> **날짜**: 2025-03-05
> **브랜치**: beta
> **이전 계획**: `onboarding-update.md` (MCP 레벨 접근 — 실패, 폐기)

---

## 1. 왜 MCP 레벨이 실패했는가

| 시도 | 실패 이유 |
|------|-----------|
| `instructions` 필드 | OpenCode가 LLM system prompt에 주입 안 함 (저장만 하고 무시) |
| `prompts` (getting_started) | 클라이언트가 prompts API를 지원해야 함 — 범용 불가 |
| Tool response 배너 | 도구 호출 시에만 표시 — 서버 시작 시점에는 불가 |
| tool_catalog 온보딩 | LLM이 먼저 호출해야 동작 — 자동이 아님 |

**결론**: MCP 프로토콜은 "서버 → 사용자" 직접 통신 채널이 없음. 클라이언트마다 지원 범위가 달라 범용 솔루션 불가.

---

## 2. 새로운 접근: 터미널 레벨 훅

### 핵심 아이디어

사용자가 AI CLI 도구를 **터미널에서 실행할 때**, 그 전에 GoPeak 업데이트 확인 + 온보딩 메시지를 보여주는 시스템.

### 래핑 대상: 모든 AI 코딩 CLI 도구 (포괄적 목록)

| 카테고리 | 명령어 | 도구 | 비고 |
|----------|--------|------|------|
| **Tier 1: 주요 CLI** | `claude` | Claude Code (Anthropic) | npm: `@anthropic-ai/claude-code` |
| | `codex` | OpenAI Codex CLI | npm: `@openai/codex` |
| | `gemini` | Google Gemini CLI | npm: `@anthropic-ai/gemini-cli` |
| | `opencode` | OpenCode | Go binary |
| | `aider` | Aider | pip: `aider-chat` |
| | `goose` | Goose (Block) | Binary |
| | `amp` | AmpCode (Sourcegraph) | Binary |
| | `copilot` | GitHub Copilot CLI | `gh copilot` or standalone |
| **Tier 2: 기타 CLI** | `cody` | Cody CLI (Sourcegraph) | Binary |
| | `cursor` | Cursor CLI mode | Binary (IDE + CLI) |
| | `windsurf` | Windsurf/Codeium CLI | Binary (IDE + CLI) |
| | `plandex` | Plandex | Go binary |
| | `mentat` | Mentat | pip: `mentat` |
| | `trae` | Trae (ByteDance) | Binary |
| | `roo` | Roo Code CLI | 있으면 래핑 |
| | `cline` | Cline CLI | 있으면 래핑 |
| **Tier 3: 래퍼 도구** | `omx` | oh-my-opencode | ⚠️ 특별 처리 필요 (아래 참고) |
| | `omc` | oh-my-claudecode | npm binary |

**총 19개 명령어**. `command -v` 체크로 시스템에 설치된 것만 래핑하므로, 목록이 넓어도 부작용 없음.

#### ⚠️ `omx` 특별 처리

사용자의 `~/.bashrc`에 이미 `omx()` 함수가 존재:
```bash
omx() { command omx --no-alt-screen "$@"; }
```
GoPeak 훅은 이 기존 함수를 **덮어쓰지 않고**, 기존 함수 내부에 precheck를 주입하거나, `omx`가 이미 함수인 경우 스킵.

**구현 방식**: 훅 삽입 시 `type -t $cmd`로 체크 → 이미 function이면 기존 함수 body를 보존하면서 `__gopeak_precheck`만 앞에 추가.

### 방법: `gopeak` CLI에 서브커맨드 추가 + 쉘 훅 설치

```
gopeak setup     # 쉘 RC 파일에 훅 함수 추가 (1회)
gopeak check     # 업데이트 확인 (비대화형, 빠르게)
gopeak star      # GitHub 스타 (gh 있으면 자동, 없으면 안내)
gopeak uninstall # 쉘 훅 제거
```

---

## 3. 구현 계획

### Phase 1: `gopeak` CLI 서브커맨드 시스템

현재 `gopeak` 바이너리는 `build/index.js`를 직접 실행 → MCP 서버 시작.
이를 **엔트리포인트 분기**로 변경:

```
gopeak           → MCP 서버 시작 (기존 동작 유지)
gopeak setup     → 쉘 훅 설치
gopeak check     → 업데이트 확인 + 표시
gopeak star      → GitHub 스타
gopeak uninstall → 쉘 훅 제거
gopeak version   → 현재 버전 표시
```

**구현 파일**: `src/cli.ts` (새 파일)

```typescript
// src/cli.ts — 엔트리포인트
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'setup':    await setupShellHooks(); break;
  case 'check':    await checkForUpdates(); break;
  case 'star':     await starGoPeak(); break;
  case 'uninstall': await uninstallHooks(); break;
  case 'version':  console.log(version); break;
  default:         await startMCPServer(); break; // 기존 동작
}
```

**빌드 변경**: `package.json`의 `bin.gopeak`을 새 엔트리포인트로 변경.

### Phase 2: 업데이트 확인 로직 (`gopeak check`)

```typescript
async function checkForUpdates(): Promise<void> {
  const currentVersion = getLocalVersion(); // package.json에서
  const latestVersion = await fetchLatestVersion(); // npm registry API
  
  if (isNewerAvailable(currentVersion, latestVersion)) {
    console.log(`
╔══════════════════════════════════════════════╗
║  🚀 GoPeak v${latestVersion} available! (current: v${currentVersion})  ║
║                                              ║
║  npm update -g gopeak                        ║
║                                              ║
║  Changelog: https://github.com/HaD0Yun/     ║
║  godot-mcp/releases/tag/v${latestVersion}              ║
╚══════════════════════════════════════════════╝
`);
  }
}
```

**npm registry API**: `https://registry.npmjs.org/gopeak/latest` — HTTP GET, JSON 응답, `version` 필드.

**캐싱**: 마지막 확인 시간을 `~/.gopeak/last-check.json`에 저장. 24시간 이내 재확인 스킵.

```json
{
  "lastCheck": "2025-03-05T09:00:00Z",
  "latestVersion": "2.3.0",
  "currentVersion": "2.2.0"
}
```

### Phase 3: GitHub 스타 (`gopeak star`)

```typescript
async function starGoPeak(): Promise<void> {
  // 1. gh CLI 존재 확인
  const hasGh = await commandExists('gh');
  if (!hasGh) {
    console.log('ℹ️  gh CLI가 설치되어 있지 않습니다.');
    console.log('   https://github.com/HaD0Yun/godot-mcp 에서 직접 ⭐ 눌러주세요!');
    return;
  }
  
  // 2. gh 인증 확인
  const isAuthed = await isGhAuthenticated();
  if (!isAuthed) {
    console.log('ℹ️  gh CLI가 인증되어 있지 않습니다.');
    console.log('   https://github.com/HaD0Yun/godot-mcp 에서 직접 ⭐ 눌러주세요!');
    return;
  }
  
  // 3. 이미 스타 했는지 확인
  const alreadyStarred = await checkIfStarred();
  if (alreadyStarred) {
    console.log('⭐ 이미 GoPeak에 스타를 눌러주셨습니다! 감사합니다!');
    return;
  }
  
  // 4. 스타 실행
  await execAsync('gh repo star HaD0Yun/godot-mcp');
  console.log('⭐ GoPeak에 스타를 눌러주셨습니다! 감사합니다!');
}
```

**제약조건 준수**: gh 없으면 설치 요구 안 함, 그냥 안내하고 넘김.

### Phase 4: 쉘 훅 설치 (`gopeak setup`)

`~/.bashrc` (또는 `~/.zshrc`)에 다음 함수 블록을 추가:

```bash
# >>> GoPeak shell hooks >>>
# Checks for GoPeak updates before launching AI CLI tools
__gopeak_precheck() {
  # 24시간 캐시 — 매번 네트워크 요청 안 함
  if command -v gopeak &>/dev/null; then
    gopeak check --quiet 2>/dev/null &
    disown 2>/dev/null
  fi
}

# AI CLI 도구 래핑 — 시스템에 설치된 것만 래핑
# Tier 1: 주요 CLI
# Tier 2: 기타 CLI
# Tier 3: 래퍼 도구 (omx는 기존 함수 보존)
__gopeak_target_cmds=(claude codex gemini opencode aider goose amp copilot cody cursor windsurf plandex mentat trae roo cline omc)

for __cmd in "${__gopeak_target_cmds[@]}"; do
  if command -v "$__cmd" &>/dev/null; then
    eval "${__cmd}() { __gopeak_precheck; command ${__cmd} \"\$@\"; }"
  fi
done

# omx 특별 처리: 기존 함수가 있으면 precheck만 추가
if declare -f omx &>/dev/null; then
  __gopeak_orig_omx=$(declare -f omx | tail -n +2)
  eval "omx() { __gopeak_precheck; $(echo "$__gopeak_orig_omx" | sed '1d;$d'); }"
elif command -v omx &>/dev/null; then
  omx() { __gopeak_precheck; command omx "$@"; }
fi

unset __cmd __gopeak_target_cmds __gopeak_orig_omx
# <<< GoPeak shell hooks <<<
```

**핵심 설계 원칙**:

1. **비차단 (non-blocking)**: `gopeak check --quiet`는 백그라운드(`&`)로 실행. AI CLI 시작을 지연시키지 않음.
2. **24시간 캐시**: 네트워크 요청은 하루 1번만. `~/.gopeak/last-check.json` 기반.
3. **안전한 래핑**: `command ${__cmd}`로 원래 바이너리를 직접 호출. 재귀 방지.
4. **조건부 래핑**: 해당 명령이 시스템에 있을 때만 함수 생성.
5. **쉽게 제거 가능**: `>>> ... <<<` 마커로 감싸서 `gopeak uninstall`로 정확히 제거.

**`--quiet` 모드 동작**:
- 업데이트 있으면: stderr에 1줄 알림 출력 (`GoPeak v2.3.0 available! Run: npm update -g gopeak`)
- 없으면: 아무 출력 없음
- 에러 시: 무시 (사용자 경험 방해 안 함)

### Phase 5: 첫 실행 온보딩

`gopeak setup` 실행 시 또는 최초 `gopeak check` 시:

```
╔══════════════════════════════════════════════════════╗
║  🎮 GoPeak v2.2.0 — AI-Powered Godot Development    ║
║                                                      ║
║  110+ tools for Godot Engine via MCP                 ║
║                                                      ║
║  📖 Docs: https://github.com/HaD0Yun/godot-mcp     ║
║  ⭐ Star: gopeak star                                ║
║  🔄 Update: npm update -g gopeak                     ║
╚══════════════════════════════════════════════════════╝
```

`~/.gopeak/onboarding-shown` 파일 존재 여부로 1회만 표시.

### Phase 6: 쉘 훅 제거 (`gopeak uninstall`)

```typescript
async function uninstallHooks(): Promise<void> {
  const rcFile = getShellRcFile(); // ~/.bashrc or ~/.zshrc
  const content = await readFile(rcFile, 'utf-8');
  
  // 마커 사이의 블록 제거
  const cleaned = content.replace(
    /\n?# >>> GoPeak shell hooks >>>[\s\S]*?# <<< GoPeak shell hooks <<<\n?/g,
    ''
  );
  
  await writeFile(rcFile, cleaned);
  console.log('✅ GoPeak 쉘 훅이 제거되었습니다.');
}
```

---

## 4. 파일 구조

```
src/
├── cli.ts              # 새 엔트리포인트 (서브커맨드 분기)
├── cli/
│   ├── check.ts        # 업데이트 확인 로직
│   ├── star.ts         # GitHub 스타 로직
│   ├── setup.ts        # 쉘 훅 설치
│   ├── uninstall.ts    # 쉘 훅 제거
│   └── utils.ts        # 공통 유틸 (semver 비교, 캐시, npm registry)
├── index.ts            # 기존 MCP 서버 (변경 없음)
└── ...
```

### package.json 변경

```json
{
  "bin": {
    "gopeak": "./build/cli.js",       // 새 엔트리포인트
    "godot-mcp": "./build/cli.js"     // 동일
  }
}
```

`cli.ts`에서 인자 없으면 `./index.js`를 import해서 기존 MCP 서버 시작 → **하위 호환 100%**.

---

## 5. 사용자 경험 (UX) 시나리오

### 시나리오 1: 처음 설치

```bash
$ npm install -g gopeak
$ gopeak setup
✅ 쉘 훅이 ~/.bashrc에 설치되었습니다.
   다음 명령어를 실행하거나 새 터미널을 열어주세요:
   source ~/.bashrc

╔══════════════════════════════════════════════════════╗
║  🎮 GoPeak v2.2.0 — AI-Powered Godot Development    ║
║  ...                                                 ║
╚══════════════════════════════════════════════════════╝

⭐ GoPeak이 도움이 되셨다면 스타를 눌러주세요!
   gopeak star
```

### 시나리오 2: 업데이트 있을 때

```bash
$ opencode
🚀 GoPeak v2.3.0 available! Run: npm update -g gopeak
# (opencode 즉시 시작 — 백그라운드 확인이므로 지연 없음)
```

### 시나리오 3: 스타 누르기

```bash
$ gopeak star
⭐ GoPeak에 스타를 눌러주셨습니다! 감사합니다!

# gh 없는 경우:
$ gopeak star
ℹ️  gh CLI가 설치되어 있지 않습니다.
   https://github.com/HaD0Yun/godot-mcp 에서 직접 ⭐ 눌러주세요!
```

### 시나리오 4: 훅 제거

```bash
$ gopeak uninstall
✅ GoPeak 쉘 훅이 제거되었습니다.
```

---

## 6. 기존 코드 영향도

| 파일 | 변경 | 설명 |
|------|------|------|
| `src/index.ts` | ❌ 없음 | MCP 서버 코드 전혀 안 건드림 |
| `src/cli.ts` | ✅ 신규 | 엔트리포인트 분기 |
| `src/cli/*.ts` | ✅ 신규 | 서브커맨드 구현 (4~5개 파일) |
| `package.json` | ✅ 수정 | `bin` 필드만 변경 |
| `tsconfig.json` | ❌ 없음 | src/ 아래이므로 자동 포함 |
| READMEs | ✅ 수정 | `gopeak setup` 사용법 추가 |

**위험도**: 매우 낮음. 기존 MCP 서버 코드(`index.ts`)를 전혀 수정하지 않음.

---

## 7. 대안 분석 (왜 이 방식인가)

| 방식 | 장점 | 단점 | 채택 |
|------|------|------|------|
| **쉘 훅 (이 계획)** | 범용, 모든 CLI에 적용, 빠름 | 사용자가 `gopeak setup` 실행 필요 | ✅ |
| MCP stderr 출력 | 설치 불필요 | OpenCode 등이 stderr 표시 안 할 수 있음 | ❌ |
| npm postinstall 자동 | 완전 자동 | 보안 문제, npm 정책 위반 가능 | ❌ |
| MCP instructions | 이론상 가장 깔끔 | 클라이언트가 무시 (검증됨) | ❌ |
| Claude Code hooks | Claude에서만 동작 | 범용 불가 | ❌ |

---

## 8. 구현 순서

1. **`src/cli.ts`**: 엔트리포인트 분기 (인자 파싱 → 서브커맨드 or MCP 서버)
2. **`src/cli/utils.ts`**: semver 비교, npm registry fetch, 캐시 관리
3. **`src/cli/check.ts`**: 업데이트 확인 (--quiet 모드 포함)
4. **`src/cli/star.ts`**: GitHub 스타 (gh 확인 → 인증 확인 → 스타)
5. **`src/cli/setup.ts`**: 쉘 훅 설치 (bashrc/zshrc 감지, 마커 블록 추가)
6. **`src/cli/uninstall.ts`**: 쉘 훅 제거 (마커 블록 삭제)
7. **`package.json`**: bin 필드 변경
8. **빌드 & 테스트**: `npm run build` → 수동 테스트
9. **README 업데이트**: `gopeak setup` 사용법 추가

---

## 9. 테스트 계획

```bash
# 빌드
npm run build

# 서브커맨드 동작 확인
gopeak version          # 버전 출력
gopeak check            # 업데이트 확인
gopeak check --quiet    # 조용한 모드
gopeak star             # 스타 (gh 있으면 동작)

# 쉘 훅 설치/제거
gopeak setup            # ~/.bashrc에 훅 추가 확인
source ~/.bashrc        # 훅 로드
type opencode           # 함수로 래핑됐는지 확인
gopeak uninstall        # 훅 제거 확인

# MCP 서버 정상 동작 확인 (하위 호환)
gopeak                  # 기존처럼 MCP 서버 시작
node build/cli.js       # 동일
```

---

## 10. 승인 요청 사항

1. 위 계획서 전체 방향이 맞는지
2. 래핑 대상 19개 명령어 목록 검토 — 추가/삭제할 것?
3. `omx` 기존 함수 보존 방식 (precheck만 추가) 괜찮은지
4. `gopeak setup`을 `npm postinstall`에서 자동 실행할지, 수동으로만 할지
5. 업데이트 알림 표시 주기: 24시간 (현재 계획) 적절한지
