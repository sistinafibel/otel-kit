<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-dark.svg">
    <img alt="otel-kit — Zero-config OpenTelemetry for Node.js" src="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-light.svg" width="640">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cloudjun/otel-kit"><img alt="npm version" src="https://img.shields.io/npm/v/%40cloudjun%2Fotel-kit?logo=npm&color=cb3837"></a>
  <a href="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22-3c873a?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>한국어</b></p>

**otel-kit**은 Node.js 서비스에 OpenTelemetry를 도입할 때 반복되는 준비 작업을 대신 처리해 주는 패키지입니다. import 한 줄과 표준 `OTEL_*` 환경 변수만 지정하면 **트레이스·로그·메트릭** 세 가지 신호가 한꺼번에 연결됩니다.

직접 구현하면 작업량이 많은 기능도 미리 준비되어 있습니다. 오류 기록, 백그라운드 작업 추적, Winston 로그 전송, HTTP 요청 로깅, 프록시 뒤에 있는 클라이언트 IP 판별을 모두 포함하고 있으며, 기본값은 개인정보가 의도하지 않게 노출되지 않도록 설정해 두었습니다. NestJS를 사용한다면 전용 래퍼도 함께 제공합니다.

**SigNoz**, **Grafana(Tempo / Loki / Mimir)**, **OpenTelemetry Collector**처럼 OTLP/HTTP를 수신하는 백엔드라면 어디로든 데이터를 전송할 수 있습니다.

<details>
<summary><b>먼저 알아두면 좋은 용어</b></summary>

<br>

| 용어 | 뜻 |
| --- | --- |
| 트레이스(trace) | 요청 하나가 여러 서비스를 거쳐 가는 전체 경로 |
| 스팬(span) | 트레이스를 구성하는 작업 한 구간이며, "DB 조회 12ms"와 같은 단위 |
| 신호(signal) | OpenTelemetry가 다루는 데이터 종류이며, 트레이스·로그·메트릭 세 가지를 가리킵니다 |
| 계측(instrumentation) | 라이브러리 동작을 가로채 스팬을 자동으로 생성하는 코드 |
| 익스포터(exporter) | 수집한 데이터를 백엔드로 실제로 전송하는 구성 요소 |
| 컬렉터(collector) | 여러 서비스가 보낸 데이터를 한곳에서 수신해 가공하고 중계하는 서버 |

</details>

## 왜 otel-kit인가?

OpenTelemetry SDK를 직접 연결하려면 준비할 작업이 많습니다. 패키지를 열 개 남짓 설치하고, 익스포터와 샘플러와 리소스를 각각 설정하고, 신호마다 서로 다른 환경 변수를 지정하고, 프로세스가 종료될 때 아직 전송하지 못한 데이터를 내보내는 순서까지 맞추어야 합니다. otel-kit은 이 과정을 한 번 정리해 두고 모든 서비스에서 동일하게 재사용합니다.

- **호출 한 번으로 세 가지 신호를 준비합니다.** `initObservability()`가 트레이스·로그·메트릭을 모두 설정합니다. 전송할 주소가 실제로 지정된 신호만 활성화되므로, 사용하지 않는 신호는 설정하지 않고 그대로 두면 됩니다.
- **새로 익혀야 하는 설정 형식이 없습니다.** `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`, `OTEL_TRACES_SAMPLER`와 같은 OpenTelemetry 표준 환경 변수를 그대로 따릅니다.
- **기본값이 안전합니다.** HTTP 로거는 직접 활성화하기 전까지 요청 본문과 쿼리 스트링과 클라이언트 IP를 모두 기록하지 않습니다. 비밀번호나 토큰처럼 민감한 키는 중첩된 객체 안까지 탐색해 마스킹하고, 오류 객체는 깊이와 크기를 제한해 기록합니다.
- **어디까지 신뢰할지 직접 지정합니다.** `X-Forwarded-For` 헤더는 위조할 수 있으므로, 애플리케이션 앞에 위치한 프록시가 몇 대인지 지정하기 전까지는 이 헤더를 사용하지 않습니다.
- **프로세스 종료를 대신 처리하지 않습니다.** `SIGTERM`과 같은 종료 신호는 애플리케이션이 그대로 관리합니다. 원하는 위치에서 `await observability.shutdown()`을 호출하면 됩니다.
- **프레임워크를 가리지 않습니다.** 기본 헬퍼 함수는 순수 `http` 모듈, Express, Fastify 어디에서나 동작하고, NestJS에서는 `/nest` 진입점이 미들웨어와 인터셉터를 추가로 제공합니다.

## 하는 일과 하지 않는 일

**하는 일**

- OpenTelemetry SDK를 초기화하고, 프로세스가 종료될 때 아직 전송하지 못한 데이터를 내보냅니다
- HTTP 서버 요청과 클라이언트 요청을 자동으로 계측합니다
- 오류를 로그 필드와 스팬 양쪽에 동일한 형태로 기록합니다
- Winston 로그를 OTLP로 전송합니다
- 요청마다 구조화된 로그를 한 줄씩 남기고, 민감한 값은 마스킹합니다
- 신뢰하는 프록시 수를 기준으로 클라이언트 IP를 판별합니다

**하지 않는 일**

- 데이터를 저장하고 조회하는 백엔드는 포함하지 않으므로, 데이터를 전송할 곳은 따로 준비해야 합니다
- DB나 Redis 같은 라이브러리 계측을 자동으로 추가하지 않으므로, 필요한 계측 패키지를 `extraInstrumentations` 옵션으로 전달해야 합니다
- CPU나 메모리 같은 런타임 지표를 스스로 생성하지 않고, 지표를 수집할 도구만 준비합니다
- `console.log`와 NestJS 기본 로거는 변경하지 않으며, OTLP로 전달되는 대상은 Winston 로그뿐입니다
- 종료 신호를 대신 처리하지 않습니다

## 요구 사항

| | |
| --- | --- |
| Node.js | 22 이상 |
| 백엔드 | OTLP/HTTP protobuf를 수신하는 모든 백엔드 (SigNoz, OTel Collector, Grafana 등) |
| 선택 사항 | 로그 전송에는 `winston` 3.x가 필요하고, NestJS 헬퍼에는 `@nestjs/common` 10~12와 `rxjs` 7.x가 필요합니다 |

## 설치

```bash
npm install @cloudjun/otel-kit @opentelemetry/api
```

`@opentelemetry/api`를 함께 설치하는 데에는 이유가 있습니다. 이 패키지는 프로세스 전체가 공유하는 tracer·meter·logger 등록소를 가지고 있어서, 의존성 트리 안에 하나만 존재해야 정상적으로 동작합니다. 그래서 otel-kit은 이 패키지를 peer dependency(사용하는 쪽이 직접 설치하는 의존성)로 선언해 두었고, npm 7 이상에서는 위 명령만 실행해도 함께 설치됩니다.

다른 계측 패키지와 함께 사용한다면 `npm ls @opentelemetry/api` 명령으로 버전이 여러 개 설치되지 않았는지 확인하세요. 중복해서 설치되면 스팬이 서로 다른 등록소로 흩어지기 때문에 트레이스가 이어지지 않습니다.

## 빠른 시작

### 1. 데이터를 전송할 곳을 지정합니다

```dotenv
OTEL_SERVICE_NAME=my-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.version=1.2.3
```

### 2. 다른 모듈보다 먼저 초기화합니다

OpenTelemetry는 계측할 대상(`http` 모듈, 웹 프레임워크, DB 드라이버)이 로드되기 **전에** 초기화되어야 합니다. 이미 로드된 모듈은 나중에 가로챌 수 없기 때문입니다.

가장 간단한 방법은 미리 로드하는 전용 진입점을 사용하는 것입니다.

```bash
node --require @cloudjun/otel-kit/register dist/main.js
# 또는
NODE_OPTIONS="--require=@cloudjun/otel-kit/register" node dist/main.js
```

옵션을 코드로 전달하고 싶다면 초기화 전용 파일을 만들고, 진입점의 **첫 번째 import**로 배치하세요.

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
import { observability } from './instrumentation'; // 반드시 첫 줄에
import { NestFactory } from '@nestjs/core';
```

`initObservability()`는 프로세스당 한 번만 동작합니다. OTLP 주소가 지정되지 않았거나 `OTEL_SDK_DISABLED=true`이면 아무 동작도 하지 않는 핸들을 반환하므로, 컬렉터 없이 로컬에서 개발할 때에도 코드를 수정할 필요가 없습니다.

### 3. 종료할 때 남은 데이터를 내보냅니다

```ts
process.on('SIGTERM', async () => {
  await server.close();
  await observability.shutdown(); // 아직 전송하지 못한 스팬·로그·메트릭을 모두 내보냅니다
  process.exit(0);
});
```

여기까지 진행하면 기본 설정이 끝납니다. 이제 HTTP 서버 요청과 클라이언트 요청이 트레이스로 남습니다. 로그와 메트릭과 오류 헬퍼 함수는 아래에서 이어서 설명하며, 동작 결과를 바로 확인하고 싶다면 로컬 컬렉터가 포함된 [실행 가능한 예제](examples/basic)부터 살펴보세요.

## 설정

설정은 모두 OpenTelemetry 표준 환경 변수로 합니다.

| 변수 | 용도 | 기본값 |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | 모든 신호에 붙는 서비스 이름 | `defaultServiceName` 옵션이며, 그 옵션도 없으면 `unknown_service` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 기본 주소이며, 뒤에 `/v1/traces`, `/v1/logs`, `/v1/metrics`가 자동으로 붙습니다 | 없음 (SDK가 활성화되지 않습니다) |
| `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_ENDPOINT` | 신호별 주소이며, 경로까지 전부 지정합니다 | 기본 주소를 따릅니다 |
| `OTEL_EXPORTER_OTLP_HEADERS` | 인증 헤더 등을 지정합니다. 예: `signoz-ingestion-key=...` | 없음 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`만 지원하며, 다른 값을 지정하면 시작하는 즉시 실패합니다 | `http/protobuf` |
| `OTEL_{TRACES,LOGS,METRICS}_EXPORTER` | `none`으로 지정하면 해당 신호를 끕니다 | `otlp` |
| `OTEL_RESOURCE_ATTRIBUTES` | 추가할 리소스 속성이며, 쉼표로 구분합니다 | 없음 |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | 샘플링 방식과 인자를 지정합니다. 예: `parentbased_traceidratio` + `0.2` | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` / `OTEL_METRIC_EXPORT_TIMEOUT` | 메트릭을 내보내는 주기와 제한 시간(밀리초)입니다. 제한 시간을 직접 지정하면 주기보다 클 수 없고, 지정하지 않으면 주기에 맞추어 자동으로 줄어듭니다 | `60000` / `30000` |
| `OTEL_SDK_DISABLED` | `true`로 지정하면 모든 기능이 동작하지 않습니다 | `false` |
| `OTEL_LOG_LEVEL` | SDK 자체 진단 로그 수준입니다 (`error`, `warn`, `info`, `debug` 등) | `error` |

### SigNoz

직접 호스팅할 때에는 다음과 같이 지정합니다.

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4318
```

SigNoz Cloud를 사용할 때에는 다음과 같이 지정합니다.

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<ingestion-key>
```

### 샘플링

기본값은 모든 요청을 기록하는 설정입니다. 트래픽이 많아서 일부만 기록하고 싶다면 비율을 지정하세요.

```dotenv
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

다만 이 방식(head 샘플링)은 요청이 **시작되는 시점**에 기록 여부를 결정합니다. 아직 요청 결과를 알 수 없는 시점이므로, 오류가 발생한 요청도 동일한 확률로 폐기됩니다. 오류만큼은 놓치면 안 된다면, 비율 샘플러를 컬렉터의 tail 샘플링(요청이 끝난 뒤에 판단하는 방식)과 함께 사용하거나 `sampler` 옵션으로 직접 구현한 샘플러를 전달하세요.

### 코드로 전달하는 옵션

```ts
initObservability({
  defaultServiceName?: string;          // OTEL_SERVICE_NAME이 없을 때 쓸 이름
  resourceAttributes?: Record<string, string | number | boolean>;
  sampler?: Sampler;                    // OTEL_TRACES_SAMPLER보다 우선합니다
  extraInstrumentations?: Instrumentation[]; // 예: @opentelemetry/instrumentation-pg
  enableTraces?: boolean; enableLogs?: boolean; enableMetrics?: boolean;
  metricExportIntervalMs?: number; metricExportTimeoutMs?: number;
});
// -> { enabled, signals: { traces, logs, metrics }, forceFlush(), shutdown() }
```

## 사용법

### 오류: 로그와 스팬에 한 번에 기록하기

```ts
import { captureError } from '@cloudjun/otel-kit';

try {
  await paymentGateway.charge(order);
} catch (error) {
  logger.error('결제 실패', captureError(error, {
    errorCode: 'PAYMENT_CHARGE_FAILED', // 값 종류가 적어서 알림·그룹화에 쓰기 좋습니다
    orderId: order.id,                  // 로그와 스팬에는 괜찮지만 메트릭 라벨에는 넣지 마세요
  }));
  throw error;
}
```

`captureError`는 두 가지 작업을 동시에 수행합니다. 하나는 로그에 그대로 넣을 수 있는 레코드(`exception.type`, `exception.message`, `exception.stacktrace`, 그리고 함께 전달한 값)를 반환하는 작업이고, 다른 하나는 현재 열려 있는 스팬에 예외와 `ERROR` 상태를 기록하는 작업입니다. 이 레코드는 깊이와 크기가 제한되어 있어서 순환 참조가 있거나 아주 큰 오류 객체도 안전하게 직렬화됩니다. 둘 중 하나만 필요하다면 `recordErrorOnSpan`(스팬 기록만 수행)이나 `toErrorLogRecord`(레코드 생성만 수행)를 사용하세요.

예외 메시지와 스택 트레이스는 언제나 스팬의 exception 이벤트로 기록됩니다. `includeStatusDescription` 옵션은 스팬의 *상태 설명(status description)* 에만 영향을 줍니다. 오류 메시지에 비밀값이 포함될 수 있다면 throw 하기 전에 제거하세요.

### 백그라운드 작업: 폴링, 큐, cron

HTTP 요청이 아닌 작업은 자동으로 계측되지 않습니다. 이런 작업은 직접 스팬으로 감싸 주세요.

```ts
import { runWithSpan, SpanKind } from '@cloudjun/otel-kit';

await runWithSpan('orders.sync', () => syncOrders(), {
  kind: SpanKind.CONSUMER,
  attributes: { 'messaging.destination.name': 'orders' },
  errorType: 'ORDER_SYNC_FAILED',
});
```

스팬은 작업이 끝나면 자동으로 닫힙니다. 오류가 발생하면 스팬에 기록한 뒤 원래 오류를 그대로 다시 throw 하므로, 바깥쪽 오류 처리 흐름은 달라지지 않습니다.

### 로그: Winston OTLP 전송

```ts
import winston from 'winston';
import { createOtelLogTransport } from '@cloudjun/otel-kit';

const transports: winston.transport[] = [new winston.transports.Console()];
const otel = createOtelLogTransport('info');
if (otel) transports.push(otel); // 로그 신호가 꺼져 있으면 null입니다

export const logger = winston.createLogger({ transports });
```

스팬이 열려 있는 동안 기록한 로그에는 `trace_id`와 `span_id`가 자동으로 붙습니다. 그래서 로그에서 해당 트레이스로 곧바로 이동할 수 있습니다. 전달되는 대상은 Winston 로그뿐이고, `console.*`이나 NestJS 기본 로거는 변경하지 않습니다.

### HTTP 요청 로깅

```ts
import { createHttpLoggerMiddleware } from '@cloudjun/otel-kit';

app.use(createHttpLoggerMiddleware({
  logger,            // log/warn/error(message, context) 형태면 무엇이든 됩니다
  logBody: false,    // 기본값: 요청 본문을 남기지 않습니다
  stripQuery: true,  // 기본값: 쿼리 스트링을 지웁니다
  logClientIp: false // 기본값: IP를 남기지 않습니다
}));
```

응답마다 구조화된 로그가 한 줄씩 남습니다. 메서드, 라우트, 상태 코드, 소요 시간, `trace_id`, user agent가 기록됩니다.

`logBody` 옵션을 켜면 요청 본문도 함께 기록합니다. 이때 비밀번호·인증 토큰·개인정보로 알려진 키는 중첩된 객체 안까지 탐색해 마스킹하고, 깊이와 항목 수와 문자열 길이에도 상한을 둡니다. 프로젝트에서만 사용하는 키가 있다면 `extraSensitiveKeys` 옵션에 추가하세요.

`user` 필드에는 기본적으로 `req.user`에서 `id`(또는 `idx`), `role`, `isAnon`만 선택해 기록합니다. 사용자 객체의 구조가 다르다면 `getUser` 옵션으로 필요한 값만 추출한 요약 객체를 반환하세요. 객체를 통째로 반환하면 개인정보가 그대로 로그에 남습니다.

### 프록시 뒤에 있는 클라이언트 IP

```ts
import { createRealIpMiddleware } from '@cloudjun/otel-kit';

// 앞단 프록시 수를 정확히 아는 경우에만 지정하세요 (예: CDN + ingress = 2)
app.use(createRealIpMiddleware({ trustedProxyCount: 2 }));
```

`X-Forwarded-For` 헤더는 클라이언트가 임의로 값을 채워 넣을 수 있어서, `trustedProxyCount` 옵션을 지정하기 전까지는 이 헤더를 전혀 사용하지 않습니다.

값을 지정하면 헤더 목록의 **뒤에서부터** 그 수만큼 센 위치의 주소를 실제 클라이언트로 판단합니다. 프록시는 요청이 지나갈 때마다 자신이 확인한 주소를 뒤에 덧붙이므로, 위조된 값은 언제나 앞쪽에 남아서 판단 범위를 자연히 벗어나기 때문입니다. 판별한 주소는 `req.realIp`에 저장되고, 필요하다면 스팬 속성으로도 기록할 수 있습니다.

### 메트릭

```ts
import { getMeter } from '@cloudjun/otel-kit';

const meter = getMeter('orders');
const failures = meter.createCounter('orders.sync.failures');
failures.add(1, { 'error.type': 'RATE_LIMITED' });
```

otel-kit은 `MeterProvider`와 익스포터를 준비할 뿐, 지표를 스스로 생성하지는 않습니다. 필요한 지표는 위와 같이 직접 정의하거나, 사용하는 라이브러리에 맞는 계측 패키지를 `extraInstrumentations` 옵션으로 전달하세요.

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

`OtelErrorInterceptor`는 처리되지 않은 예외를 요청 스팬에 기록합니다. 400번대 `HttpException`은 대부분 클라이언트 측의 문제이므로 기본적으로 제외하며, 위 예시의 `recordHttp4xx: false`는 그 기본값을 그대로 명시한 것입니다. 4xx도 오류로 집계하고 싶다면 `true`로 변경하세요.

`RealIpMiddleware`와 `REAL_IP_OPTIONS`는 `createRealIpMiddleware`를 `MiddlewareConsumer`에서 사용할 수 있도록 감싼 구현입니다. 종료할 때 데이터를 내보내는 처리는 `app.enableShutdownHooks()`와 `OnApplicationShutdown`에 맞추어 구현하면 됩니다.

## API 한눈에 보기

| 진입점 | export | 용도 |
| --- | --- | --- |
| `@cloudjun/otel-kit` | `initObservability`, `getObservability`, `isOtelExportEnabled` | 초기화, 현재 핸들 조회, 신호 상태 확인 |
| | `captureError`, `recordErrorOnSpan`, `toErrorLogRecord` | 오류 기록 형식 통일 |
| | `runWithSpan` | HTTP 요청이 아닌 작업을 스팬으로 감싸기 |
| | `createOtelLogTransport` | Winston 로그를 OTLP로 전송 |
| | `createHttpLoggerMiddleware`, `maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS` | 요청 로깅과 민감 정보 마스킹 |
| | `getClientIp`, `extractIPv4`, `createRealIpMiddleware` | 신뢰하는 프록시 수를 기준으로 IP 판별 |
| | `getMeter`, `getActiveTraceId`, `getActiveSpanId` | 메트릭과 현재 트레이스 정보 조회 |
| | `SpanKind`, `SpanStatusCode`와 타입들 | `@opentelemetry/api`에서 그대로 다시 export |
| `@cloudjun/otel-kit/nest` | `OtelErrorInterceptor`, `OTEL_ERROR_INTERCEPTOR_OPTIONS`, `RealIpMiddleware`, `REAL_IP_OPTIONS` | NestJS용 래퍼 |
| `@cloudjun/otel-kit/register` | `observability` | `--require`로 미리 로드하는 진입점 |

## 예제

- [examples/basic](examples/basic): 순수 `http` 서버와 Winston, 그리고 Docker Compose로 실행하는 OpenTelemetry Collector가 들어 있습니다. 명령을 세 번 실행하면 스팬·로그·메트릭이 도착하는 과정을 직접 확인할 수 있습니다. (한국어 안내: [examples/basic/README.ko.md](examples/basic/README.ko.md))

## 기여

버그 제보, 기능 제안, PR 모두 환영합니다. 개발 환경과 작업 흐름은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에 정리해 두었고, 취약점을 비공개로 알리는 방법은 [SECURITY.ko.md](SECURITY.ko.md)에 정리해 두었습니다.

```bash
npm ci
npm run typecheck && npm run build && npm run test:ci
```

## 라이선스

[MIT](LICENSE) © sistinafibel
