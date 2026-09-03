# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-04

### Changed

- OpenTelemetry SDK를 2.x 계열로 올리고 Node.js 지원 범위를 22 이상으로 조정했습니다.
- 표준 OTEL 환경 변수, 신호별 활성화, 리소스 감지, 샘플러 설정을 지원합니다.
- HTTP 로거의 기본값을 본문·쿼리·클라이언트 IP 비수집으로 변경했습니다.
- 프록시 전달 헤더는 `trustedProxyCount`를 명시한 경우에만 신뢰합니다.
- CI와 npm Trusted Publishing 워크플로를 Node.js 22/24 및 npm 11 기준으로 갱신했습니다.
- `@opentelemetry/api`는 전역 레지스트리 단일 인스턴스를 보장하기 위해 peer dependency로 선언합니다.
- NestJS 진입점이 쓰는 `rxjs`를 optional peer dependency로 명시합니다.
- GitHub Actions를 커밋 SHA로 고정합니다.
- 샘플러·메트릭 주기·프로토콜 검증을 전역 provider 등록 전에 끝내, 잘못된 설정으로 실패해도 절반만 등록된 전역 상태가 남지 않습니다.
- HTTP 로거 크기 제한 옵션을 요청 시점이 아니라 미들웨어 생성 시점에 검증합니다.

### Added

- `@sistinafibel/otel-kit/register` 사전 로드 진입점
- `captureError`, `recordErrorOnSpan`, `runWithSpan` 오류·백그라운드 작업 계측 도우미
- NestJS용 `OtelErrorInterceptor`
- 종료와 강제 플러시를 포함한 관측성 핸들 및 실제 활성 신호 정보
- CI: 실제 tarball 을 설치해 진입점을 검증하는 패키지 스모크 테스트(`scripts/smoke-package.sh`), 커버리지 요약·아티팩트, CodeQL 코드 스캔, 태그 푸시 시 GitHub Release 자동 생성
- 초기화된 핸들을 조회하는 `getObservability`. Winston transport 헬퍼가 이를 통해 `enableLogs: false` 같은 옵션까지 반영합니다.

### Fixed

- `OTEL_METRIC_EXPORT_INTERVAL`(또는 `metricExportIntervalMs`)만 30초보다 짧게 설정하면 기본 timeout(30초)이 interval을 초과해 시작 시 `RangeError`가 나던 문제를 수정했습니다. timeout을 명시하지 않으면 interval에 맞춰 자동으로 줄어듭니다.

### Docs

- 로고와 배너(`assets/`), 영어·한국어 README(`README.md`, `README.ko.md`)
- 기여 가이드, 보안 정책(영어·한국어), 이슈·PR 템플릿, Dependabot 설정
- 로컬 OpenTelemetry Collector와 함께 실행하는 `examples/basic` 예제

### Security

- 순환 참조, getter 예외, 과도한 중첩 및 큰 문자열을 방어하는 제한형 로그 직렬화
- 지원하지 않는 OTLP 프로토콜과 잘못된 샘플러·프록시 설정의 조기 실패

## [0.1.0] - 2026-09-03

### Added

- 트레이스·로그·메트릭 OTLP/HTTP 부트스트랩
- Winston OpenTelemetry transport
- HTTP 요청 로거, 클라이언트 IP 및 NestJS 실 IP 미들웨어
- 오류 로그 레코드와 trace context 도우미
