# GoPeak

🌐 **언어**: [English](README.md) | **한국어** | [日本語](README-ja.md) | [Deutsch](README-de.md) | [Português](README-pt_BR.md) | [简体中文](README-zh.md)

> Canonical docs: [README.md](README.md). This localized page is a concise overview and may lag behind the English source.

**GoPeak은 Godot용 MCP 서버로, AI 어시스턴트가 실제 프로젝트를 실행·검사·수정·디버깅까지 end-to-end로 수행할 수 있게 해줍니다.**

## 빠른 시작

### 요구사항
- Godot 4.x
- Node.js 18+
- MCP-compatible client

### 실행
```bash
npx -y gopeak
```

또는:
```bash
npm install -g gopeak
gopeak
```

### MCP 설정 예시
```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "gopeak"]
    }
  }
}
```

## 핵심 요약
- 기본 33개 코어 도구 + 필요 시 활성화되는 22개 동적 툴 그룹
- 씬/스크립트/리소스/런타임/LSP/DAP/입력 자동화 지원
- 실제 Godot 프로젝트 상태 기반으로 작업 가능

## 자세한 문서
- 전체 설치/설정/문제해결: [README.md](README.md)
- 문서 맵: [docs/README.md](docs/README.md)
- 아키텍처: [docs/architecture.md](docs/architecture.md)
- 릴리즈 절차: [docs/release-process.md](docs/release-process.md)

## 참고
- 영어 README가 기준 문서입니다.
- 번역본은 요약본으로 유지되며 최신 변경사항이 늦게 반영될 수 있습니다.
