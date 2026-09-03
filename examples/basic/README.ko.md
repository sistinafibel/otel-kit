# 기본 예제

<a href="README.md">English</a> · <b>한국어</b>

순수 Node.js HTTP 서버가 로컬 OpenTelemetry Collector로 트레이스·로그·메트릭을 전송하는 예제입니다. 별도의 프레임워크는 필요하지 않습니다.

## 1. 라이브러리 빌드

예제는 `file:../..` 경로로 패키지를 참조하므로, 저장소 루트에서 다음 명령을 한 번 실행해 빌드합니다.

```bash
npm ci
npm run build
```

## 2. 컬렉터 실행

```bash
cd examples/basic
docker compose up
```

컬렉터는 `http://localhost:4318`에서 데이터를 수신하며, 수신한 스팬과 로그 레코드와 메트릭을 모두 출력합니다.

이미 SigNoz나 다른 OTLP 백엔드를 운영하고 있다면 이 단계를 건너뛰고, `OTEL_EXPORTER_OTLP_ENDPOINT` 변수를 그 백엔드 주소로 지정하세요.

## 3. 앱 실행

```bash
npm install
cp .env.example .env
npm start
```

앱을 실행한 뒤 다음과 같이 요청을 보내 봅니다.

```bash
curl "http://localhost:3000/hello?name=otel"
curl http://localhost:3000/fail
```

컬렉터를 실행한 터미널에서 다음 내용을 확인할 수 있습니다.

- 요청마다 생성되는 HTTP 서버 스팬 (내장 `http` 계측이 만듭니다)
- `/hello` 요청 아래에 생성되는 자식 스팬 `example.build-greeting`
- `/fail` 요청에서 `trace_id`가 붙은 오류 로그 레코드와 ERROR 상태로 표시된 스팬
- 5초마다 전송되는 `example.requests` 카운터

`Ctrl+C`를 누르면 종료됩니다. 앱이 `observability.shutdown()`을 await 하므로, 마지막 배치까지 모두 내보낸 뒤에 프로세스가 끝납니다.

## 살펴볼 파일

| 파일 | 역할 |
| --- | --- |
| `index.js` | 앱 전체 구현이며, 로거·미터·스팬·오류 기록·정상 종료를 담고 있습니다 |
| `.env.example` | 모든 동작을 설정하는 표준 `OTEL_*` 환경 변수 |
| `otel-collector.yaml` | `debug` 익스포터를 사용하는 컬렉터 설정 |
