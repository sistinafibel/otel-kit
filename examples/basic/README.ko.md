# 기본 예제

<a href="README.md">English</a> · <b>한국어</b>

순수 Node.js HTTP 서버가 로컬 OpenTelemetry Collector로 trace·log·metric을 보내는 예제입니다. 프레임워크가 필요 없습니다.

## 1. 라이브러리 빌드

예제는 `file:../..`로 패키지를 참조하므로 저장소 루트에서 한 번 빌드합니다.

```bash
npm ci
npm run build
```

## 2. Collector 실행

```bash
cd examples/basic
docker compose up
```

Collector는 `http://localhost:4318`에서 수신하며, 받은 span·log record·metric을 모두 출력합니다.

이미 SigNoz나 다른 OTLP 백엔드가 있다면 이 단계를 건너뛰고 `OTEL_EXPORTER_OTLP_ENDPOINT`를 그쪽으로 지정하세요.

## 3. 앱 실행

```bash
npm install
cp .env.example .env
npm start
```

요청을 보내 봅니다.

```bash
curl "http://localhost:3000/hello?name=otel"
curl http://localhost:3000/fail
```

Collector 터미널에서 다음을 확인할 수 있습니다.

- 요청마다 HTTP 서버 span (내장 `http` 계측)
- `/hello` 아래의 자식 span `example.build-greeting`
- `/fail`에서 `trace_id`가 붙은 오류 로그 레코드와 ERROR 상태의 span
- 5초마다 내보내지는 `example.requests` 카운터

`Ctrl+C`로 종료합니다. 앱이 `observability.shutdown()`을 await 하므로 마지막 배치까지 flush된 뒤 종료됩니다.

## 살펴볼 파일

| 파일 | 역할 |
| --- | --- |
| `index.js` | 앱 전체: logger, meter, span, 오류 캡처, 정상 종료 |
| `.env.example` | 모든 것을 설정하는 표준 `OTEL_*` 변수 |
| `otel-collector.yaml` | `debug` exporter를 쓰는 Collector 설정 |
