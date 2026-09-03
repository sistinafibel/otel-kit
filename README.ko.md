<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-dark.svg">
    <img alt="otel-kit — Zero-config OpenTelemetry for Node.js" src="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-light.svg" width="640">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cloudjun/otel-kit"><img alt="npm version" src="https://img.shields.io/npm/v/%40cloudjun%2Fotel-kit?logo=npm&color=cb3837"></a>
  <a href="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js >= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>한국어</b></p>

**otel-kit**은 Node.js 서비스의 OpenTelemetry **트레이스·로그·메트릭**을 import 한 줄과 표준 `OTEL_*` 환경 변수만으로 연결해 줍니다. 오류 캡처, 백그라운드 작업 span, Winston OTLP transport, HTTP 요청 로거, 신뢰 프록시 기반 클라이언트 IP 처리처럼 매번 반복되는 부분을 개인정보 안전 기본값으로 제공합니다. NestJS용 래퍼도 선택적으로 포함되어 있습니다.

**SigNoz**, **Grafana(Tempo / Loki / Mimir)**, **OpenTelemetry Collector** 등 OTLP/HTTP를 받는 모든 백엔드와 함께 쓸 수 있습니다.

## 왜 otel-kit인가?

OpenTelemetry SDK를 제대로 붙이려면 십여 개 패키지, exporter·sampler·resource 설정, 신호별 환경 변수, 종료 순서를 한꺼번에 다뤄야 합니다. otel-kit은 이 작업을 모든 서비스에서 같은 방식으로 한 번에 끝냅니다.

- **한 번의 호출, 세 가지 신호.** `initObservability()`가 trace·log·metric provider를 구성하고 endpoint가 실제로 있는 신호만 켭니다.
- **표준 설정.** `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`, `OTEL_TRACES_SAMPLER`, `OTEL_SDK_DISABLED` 등을 그대로 따릅니다. 새로 배울 설정 형식이 없습니다.
- **안전한 기본값.** HTTP 로거는 명시적으로 켜기 전까지 body, query string, 클라이언트 IP를 기록하지 않습니다. 민감 키는 재귀적으로 마스킹하고 오류 객체는 깊이·크기 제한을 두고 직렬화합니다.
- **명시적인 신뢰 경계.** 통제하는 프록시 홉 수를 선언하기 전까지 `X-Forwarded-For`를 무시합니다.
- **숨은 signal handler 없음.** 종료는 애플리케이션이 소유합니다. 적절한 위치에서 `await observability.shutdown()`을 호출하면 됩니다.
- **프레임워크 무관, NestJS 친화.** 핵심 도우미는 순수 `http`, Express, Fastify 등에서 동작하고, `/nest` 진입점이 미들웨어와 interceptor를 더합니다.

## 요구 사항

| | |
| --- | --- |
| Node.js | 22 이상 |
| 백엔드 | OTLP/HTTP protobuf를 받는 모든 것 (SigNoz, OTel Collector, Grafana...) |
| 선택 | 로그 transport용 `winston` 3.x, NestJS 도우미용 `@nestjs/common` 10~12 및 `rxjs` 7.x |

## 설치

```bash
npm install @cloudjun/otel-kit @opentelemetry/api
```

`@opentelemetry/api`는 프로세스 전역 tracer·meter·logger 레지스트리를 갖는 얇은 패키지라 의존성 트리 안에 단 하나만 있어야 합니다. 그래서 peer dependency로 두었으며 npm 7 이상은 자동으로 설치합니다. 다른 instrumentation 패키지와 함께 쓸 때는 `npm ls @opentelemetry/api`로 중복 설치가 없는지 확인하세요.

## 빠른 시작

### 1. 백엔드를 가리킵니다

```dotenv
OTEL_SERVICE_NAME=my-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.version=1.2.3
```

### 2. 무엇보다 먼저 로드합니다

OpenTelemetry는 계측 대상 모듈(`http`, 프레임워크, DB 드라이버)보다 **먼저** 초기화되어야 합니다. 가장 쉬운 방법은 사전 로드 진입점입니다.

```bash
node --require @cloudjun/otel-kit/register dist/main.js
# 또는
NODE_OPTIONS="--require=@cloudjun/otel-kit/register" node dist/main.js
```

코드에서 옵션을 넘기고 싶다면 별도 파일을 만들고 진입점의 **첫 번째 import**로 둡니다.

```ts
// instrumentation.ts
import { initObservability } from '@cloudjun/otel-kit';

export const observability = initObservability({
  defaultServiceName: 'my-api',
  resourceAttributes: { 'service.version': process.env.APP_VERSION ?? 'unknown' },
});
```

```ts
// main.ts
import { observability } from './instrumentation'; // 반드시 첫 줄
import { NestFactory } from '@nestjs/core';
```

`initObservability()`는 프로세스당 한 번만 실행됩니다. OTLP endpoint가 없거나 `OTEL_SDK_DISABLED=true`이면 안전한 no-op 핸들을 반환하므로 collector 없이도 로컬 개발이 가능합니다.

### 3. 종료 시 flush 합니다

```ts
process.on('SIGTERM', async () => {
  await server.close();
  await observability.shutdown(); // 대기 중인 span·log·metric을 모두 내보냅니다
  process.exit(0);
});
```

이제 HTTP 서버·클라이언트 요청이 추적됩니다. 로그·메트릭·오류 도우미는 아래를 읽거나, 로컬 collector가 포함된 [실행 가능한 예제](examples/basic)로 바로 가 보세요.

## 설정

모든 설정은 표준 OpenTelemetry 환경 변수로 이뤄집니다.

| 변수 | 용도 | 기본값 |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | 모든 신호에 붙는 서비스 이름 | `defaultServiceName` 옵션, 없으면 `unknown_service` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 기본 URL. `/v1/traces`, `/v1/logs`, `/v1/metrics`가 붙습니다 | 없음 (SDK 비활성) |
| `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_ENDPOINT` | 신호별 전체 URL (경로 포함) | 기본 URL 상속 |
| `OTEL_EXPORTER_OTLP_HEADERS` | 예: `signoz-ingestion-key=...` | 없음 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`만 지원. 다른 값은 시작 시 즉시 실패 | `http/protobuf` |
| `OTEL_{TRACES,LOGS,METRICS}_EXPORTER` | `none`으로 두면 해당 신호 비활성 | `otlp` |
| `OTEL_RESOURCE_ATTRIBUTES` | 추가 리소스 속성, 쉼표 구분 | 없음 |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | 예: `parentbased_traceidratio` + `0.2` | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` / `OTEL_METRIC_EXPORT_TIMEOUT` | 밀리초. 명시한 timeout은 interval보다 클 수 없고, 기본 timeout은 interval에 맞춰 자동으로 줄어듦 | `60000` / `30000` |
| `OTEL_SDK_DISABLED` | `true`면 전부 no-op | `false` |
| `OTEL_LOG_LEVEL` | SDK 진단 로그 레벨 (`error`, `warn`, `info`, `debug`, ...) | `error` |

### SigNoz

자체 호스팅:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4318
```

SigNoz Cloud:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<ingestion-key>
```

### 샘플링

```dotenv
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

head sampling은 오류 span도 함께 버립니다. 오류 보존이 중요하다면 비율 sampler를 collector의 tail sampling과 함께 쓰거나 `sampler` 옵션으로 직접 지정하세요.

### 프로그래밍 옵션

```ts
initObservability({
  defaultServiceName?: string;          // OTEL_SERVICE_NAME 미설정 시 대체값
  resourceAttributes?: Record<string, string | number | boolean>;
  sampler?: Sampler;                    // OTEL_TRACES_SAMPLER보다 우선
  extraInstrumentations?: Instrumentation[]; // 예: @opentelemetry/instrumentation-pg
  enableTraces?: boolean; enableLogs?: boolean; enableMetrics?: boolean;
  metricExportIntervalMs?: number; metricExportTimeoutMs?: number;
});
// -> { enabled, signals: { traces, logs, metrics }, forceFlush(), shutdown() }
```

## 사용법

### 오류: 로그 필드와 span 상태를 한 번에

```ts
import { captureError } from '@cloudjun/otel-kit';

try {
  await paymentGateway.charge(order);
} catch (error) {
  logger.error('결제 실패', captureError(error, {
    errorCode: 'PAYMENT_CHARGE_FAILED', // 저카디널리티, 알림·그룹화에 적합
    orderId: order.id,                  // 로그·span엔 OK, metric label엔 넣지 않기
  }));
  throw error;
}
```

`captureError`는 크기가 제한된 직렬화 안전 레코드(`exception.type`, `exception.message`, `exception.stacktrace`, 전달한 meta)를 반환하는 **동시에** 활성 span에 exception과 `ERROR` 상태를 기록합니다. 한쪽만 필요하면 `recordErrorOnSpan` 또는 `toErrorLogRecord`를 쓰세요.

span에는 예외 메시지와 스택이 exception 이벤트로 항상 기록됩니다. `includeStatusDescription` 옵션은 span *status description*에만 영향을 줍니다. 오류 메시지에 비밀값이 섞일 수 있다면 throw하기 전에 메시지를 정제하세요.

### 백그라운드 작업: 폴링, 큐, cron

```ts
import { runWithSpan, SpanKind } from '@cloudjun/otel-kit';

await runWithSpan('orders.sync', () => syncOrders(), {
  kind: SpanKind.CONSUMER,
  attributes: { 'messaging.destination.name': 'orders' },
  errorType: 'ORDER_SYNC_FAILED',
});
```

span은 자동으로 종료됩니다. 오류는 span에 기록된 뒤 원래 값 그대로 다시 throw됩니다.

### 로그: Winston OTLP transport

```ts
import winston from 'winston';
import { createOtelLogTransport } from '@cloudjun/otel-kit';

const transports: winston.transport[] = [new winston.transports.Console()];
const otel = createOtelLogTransport('info');
if (otel) transports.push(otel); // logs 신호가 꺼져 있으면 null

export const logger = winston.createLogger({ transports });
```

활성 span 안에서 기록된 로그에는 `trace_id` / `span_id`가 자동으로 붙습니다. Winston 로그만 전달되며 `console.*`와 NestJS 기본 logger는 건드리지 않습니다.

### HTTP 요청 로깅

```ts
import { createHttpLoggerMiddleware } from '@cloudjun/otel-kit';

app.use(createHttpLoggerMiddleware({
  logger,            // log/warn/error(message, context)를 가진 객체면 무엇이든
  logBody: false,    // 기본값: body를 기록하지 않음
  stripQuery: true,  // 기본값: query string 제거
  logClientIp: false // 기본값: IP 미기록
}));
```

응답마다 method, route, status, 소요 시간, `trace_id`, user agent가 담긴 구조화 로그 한 줄이 남습니다. `logBody`를 켜면 알려진 비밀·인증·개인정보 키를 재귀적으로 마스킹하고 깊이·항목 수·문자열 길이를 제한합니다. `extraSensitiveKeys`로 키를 추가할 수 있습니다.

로그의 `user` 필드는 기본적으로 `req.user`에서 `id`(또는 `idx`)·`role`·`isAnon`만 뽑습니다. 사용자 객체 구조가 다르면 `getUser` 옵션으로 작은 요약을 만들어 넘기고, 객체를 통째로 넘기지 마세요.

### 프록시 뒤의 클라이언트 IP

```ts
import { createRealIpMiddleware } from '@cloudjun/otel-kit';

// 정확히 이 홉 수를 운영자가 통제할 때만 (예: CDN + ingress)
app.use(createRealIpMiddleware({ trustedProxyCount: 2 }));
```

forwarded 헤더는 위조될 수 있으므로 `trustedProxyCount`를 설정하기 전까지 무시됩니다. 결정된 주소는 `req.realIp`로, 선택적으로 span 속성으로도 노출됩니다.

### 메트릭

```ts
import { getMeter } from '@cloudjun/otel-kit';

const meter = getMeter('orders');
const failures = meter.createCounter('orders.sync.failures');
failures.add(1, { 'error.type': 'RATE_LIMITED' });
```

otel-kit은 `MeterProvider`와 exporter를 구성하지만 런타임 메트릭을 스스로 만들지는 않습니다. 사용하는 라이브러리에 맞는 `extraInstrumentations`를 추가하세요.

### NestJS

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OTEL_ERROR_INTERCEPTOR_OPTIONS, OtelErrorInterceptor } from '@cloudjun/otel-kit/nest';

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: OtelErrorInterceptor },
    { provide: OTEL_ERROR_INTERCEPTOR_OPTIONS, useValue: { recordHttp4xx: false } },
  ],
})
export class AppModule {}
```

`OtelErrorInterceptor`는 처리되지 않은 예외를 요청 span에 기록합니다(4xx `HttpException`은 기본적으로 제외). `RealIpMiddleware` / `REAL_IP_OPTIONS`는 `createRealIpMiddleware`를 `MiddlewareConsumer`용으로 감싼 것입니다. 정상 종료는 `OnApplicationShutdown`과 `app.enableShutdownHooks()`에 맞춰 넣으면 됩니다.

## API 개요

| 진입점 | export | 용도 |
| --- | --- | --- |
| `@cloudjun/otel-kit` | `initObservability`, `getObservability`, `isOtelExportEnabled` | 부트스트랩, 현재 핸들 조회, 신호 상태 |
| | `captureError`, `recordErrorOnSpan`, `toErrorLogRecord` | 오류 표준화 |
| | `runWithSpan` | HTTP 밖 작업의 span |
| | `createOtelLogTransport` | Winston OTLP transport |
| | `createHttpLoggerMiddleware`, `maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS` | 요청 로깅과 마스킹 |
| | `getClientIp`, `extractIPv4`, `createRealIpMiddleware` | 신뢰 프록시 기반 IP 결정 |
| | `getMeter`, `getActiveTraceId`, `getActiveSpanId` | 메트릭과 trace context |
| | `SpanKind`, `SpanStatusCode` 및 타입 | `@opentelemetry/api` 재export |
| `@cloudjun/otel-kit/nest` | `OtelErrorInterceptor`, `OTEL_ERROR_INTERCEPTOR_OPTIONS`, `RealIpMiddleware`, `REAL_IP_OPTIONS` | NestJS 래퍼 |
| `@cloudjun/otel-kit/register` | `observability` | `--require`용 사전 로드 진입점 |

## 예제

- [examples/basic](examples/basic): 순수 `http` 서버 + Winston + Docker Compose로 띄운 로컬 OpenTelemetry Collector. 명령 세 번이면 span·log·metric이 도착하는 걸 볼 수 있습니다. (한국어 안내: [examples/basic/README.ko.md](examples/basic/README.ko.md))

## 기여

버그 리포트, 기능 제안, PR 모두 환영합니다. 개발 환경과 워크플로는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md), 취약점 비공개 신고 방법은 [SECURITY.ko.md](SECURITY.ko.md)를 읽어 주세요.

```bash
npm ci
npm run typecheck && npm run build && npm run test:ci
```

## 라이선스

[MIT](LICENSE) © sistinafibel
