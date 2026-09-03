# otel-kit에 기여하기

<a href="CONTRIBUTING.md">English</a> · <b>한국어</b>

시간을 내어 기여해 주셔서 감사합니다! 이 문서는 아이디어에서 병합된 PR까지 필요한 모든 것을 다룹니다.

## 시작하기 전에

- [이슈 트래커](https://github.com/sistinafibel/otel-kit/issues)에서 기존 논의가 있는지 확인해 주세요.
- 버그 수정보다 큰 변경은 먼저 이슈를 열어 접근 방식을 합의한 뒤 작업하면 시간을 아낄 수 있습니다.
- 보안 문제는 **공개 이슈로 올리지 마세요.** [SECURITY.ko.md](SECURITY.ko.md)를 참고하세요.

## 개발 환경

요구 사항: Node.js 22+, npm 11+ (`.nvmrc` 포함).

```bash
git clone https://github.com/sistinafibel/otel-kit.git
cd otel-kit
npm ci
npm run typecheck
npm test
```

주요 스크립트:

| 스크립트 | 설명 |
| --- | --- |
| `npm run build` | `tsconfig.build.json`으로 `src/`를 `dist/`로 컴파일 |
| `npm run typecheck` | 테스트를 포함한 전체 프로젝트 타입 검사 |
| `npm test` | Jest 테스트 실행 |
| `npm run test:cov` | 커버리지 리포트와 함께 테스트 실행 |
| `npm run test:ci` | CI와 동일: 커버리지 + `--runInBand` |

## 프로젝트 구조

```
src/
├── index.ts                 # 공개 진입점 (프레임워크 무관)
├── nest.ts                  # NestJS 전용 진입점 (@sistinafibel/otel-kit/nest)
├── register.ts              # 사전 로드 진입점 (--require ...otel-kit/register)
├── init-observability.ts    # SDK 부트스트랩: provider, exporter, sampler, resource
├── tracing.ts               # runWithSpan 도우미
├── error-record.ts          # 안전하고 크기가 제한된 오류 -> 로그 레코드 직렬화
├── error-telemetry.ts       # captureError / recordErrorOnSpan
├── metrics.ts               # getMeter
├── trace-context.ts         # getActiveTraceId / getActiveSpanId
├── http/                    # HTTP 로거 + 클라이언트 IP 도우미 (프레임워크 무관)
├── nest/                    # NestJS 미들웨어 / interceptor 래퍼
├── winston/                 # Winston OTLP transport 팩토리
└── __tests__/               # Jest 스펙 (모듈당 하나)
```

## 변경 작업

1. `main`에서 브랜치를 만듭니다: `git checkout -b feat/my-change`
2. 테스트를 먼저 작성하거나 갱신합니다. 커버리지 기준은 **라인/구문 80%**이며 CI가 강제합니다.
3. 공개 API는 작고 안정적으로 유지합니다. `src/index.ts`와 `src/nest.ts`에서 export되는 것은 모두 공개 계약입니다.
4. 기존 스타일을 따릅니다: strict TypeScript, 불변 데이터(입력을 변경하지 말고 새 객체 반환), 작고 집중된 파일, 한국어 JSDoc.
5. [CHANGELOG.md](CHANGELOG.md)의 **Unreleased** 섹션에 한 줄 추가합니다.
6. 푸시 전에 전체 검사를 돌립니다:

   ```bash
   npm run typecheck && npm run build && npm run test:ci && npm pack --dry-run
   ```

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/ko/)를 사용합니다.

```
<타입>: <짧은 요약>

<선택적 본문: 왜 바꿨는지>
```

타입: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Pull Request

- PR 하나에 논리적 변경 하나.
- PR 템플릿을 채워 주세요. *무엇*보다 *왜*를 설명해 주세요.
- Node 22와 24에서 CI가 통과해야 합니다.
- 메인테이너가 리뷰하고 변경을 요청할 수 있습니다. 대화는 PR 안에서 이어 주세요.

## 릴리스 (메인테이너용)

1. `package.json`의 `version`을 올리고 `CHANGELOG.md`의 **Unreleased** 항목을 새 버전 아래로 옮깁니다.
2. 커밋 후 태그를 붙입니다: `git tag v1.2.3 && git push --tags`
3. [release 워크플로](.github/workflows/release.yml)가 태그와 패키지 버전이 일치하는지 확인한 뒤 Trusted Publishing(OIDC)으로 npm에 배포합니다. 저장소에 npm 토큰을 저장하지 않습니다.

## 라이선스

기여하시면 기여 내용이 [MIT 라이선스](LICENSE)로 배포되는 데 동의하는 것으로 간주합니다.
