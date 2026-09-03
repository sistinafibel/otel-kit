<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-dark.svg">
    <img alt="otel-kit — Zero-config OpenTelemetry for Node.js" src="https://raw.githubusercontent.com/sistinafibel/otel-kit/main/assets/banner-light.svg" width="640">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sistinafibel/otel-kit"><img alt="npm version" src="https://img.shields.io/npm/v/%40sistinafibel%2Fotel-kit?logo=npm&color=cb3837"></a>
  <a href="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sistinafibel/otel-kit/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js >= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center"><b>English</b> · <a href="README.ko.md">한국어</a></p>

**otel-kit** wires up OpenTelemetry **traces, logs and metrics** for a Node.js service with a single import and standard `OTEL_*` environment variables. It ships opinionated, privacy-safe helpers for the boring parts: error capture, background-job spans, a Winston OTLP transport, an HTTP request logger and trusted-proxy client IP handling. Optional NestJS wrappers included.

Works with **SigNoz**, **Grafana (Tempo / Loki / Mimir)**, the **OpenTelemetry Collector** or any OTLP/HTTP backend.

## Why otel-kit?

Setting up the OpenTelemetry SDK correctly means juggling a dozen packages, exporter/sampler/resource configuration, signal-specific environment variables and shutdown ordering. otel-kit does that once, the same way, for every service:

- **One call, three signals.** `initObservability()` configures trace, log and metric providers and only enables the signals that actually have an endpoint.
- **Standard configuration.** Honors `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`, `OTEL_TRACES_SAMPLER`, `OTEL_SDK_DISABLED` and friends. No custom config format to learn.
- **Safe by default.** The HTTP logger records no bodies, no query strings and no client IPs unless you opt in. Sensitive keys are masked recursively; error objects are serialized with depth and size limits.
- **Explicit trust boundaries.** `X-Forwarded-For` is ignored unless you declare how many proxies you control.
- **No hidden signal handlers.** Your app owns shutdown. You `await observability.shutdown()` where it makes sense.
- **Framework agnostic, NestJS friendly.** Core helpers work with plain `http`, Express, Fastify, etc. The `/nest` entry point adds a middleware and an interceptor.

## Requirements

| | |
| --- | --- |
| Node.js | 22 or newer |
| Backend | Anything that accepts OTLP/HTTP protobuf (SigNoz, OTel Collector, Grafana...) |
| Optional | `winston` 3.x for the log transport, `@nestjs/common` 10 to 12 and `rxjs` 7.x for the NestJS helpers |

## Installation

```bash
npm install @sistinafibel/otel-kit @opentelemetry/api
```

`@opentelemetry/api` is a thin package that holds the process-wide tracer, meter and logger registries, so exactly one copy must exist in your dependency tree. That is why it is a peer dependency (npm 7+ installs it automatically). When you combine otel-kit with other instrumentation packages, run `npm ls @opentelemetry/api` to make sure it is not duplicated.

## Quick start

### 1. Point it at your backend

```dotenv
OTEL_SERVICE_NAME=my-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.version=1.2.3
```

### 2. Load it before anything else

OpenTelemetry must be initialised **before** the modules it instruments (`http`, frameworks, DB drivers) are loaded. The easiest way is the preload entry point:

```bash
node --require @sistinafibel/otel-kit/register dist/main.js
# or
NODE_OPTIONS="--require=@sistinafibel/otel-kit/register" node dist/main.js
```

Prefer to pass options in code? Create a file and make it the **first import** of your entry point:

```ts
// instrumentation.ts
import { initObservability } from '@sistinafibel/otel-kit';

export const observability = initObservability({
  defaultServiceName: 'my-api',
  resourceAttributes: { 'service.version': process.env.APP_VERSION ?? 'unknown' },
});
```

```ts
// main.ts
import { observability } from './instrumentation'; // must stay first
import { NestFactory } from '@nestjs/core';
```

`initObservability()` runs once per process. If no OTLP endpoint is configured, or `OTEL_SDK_DISABLED=true`, it returns a safe no-op handle so local development works without a collector.

### 3. Flush on shutdown

```ts
process.on('SIGTERM', async () => {
  await server.close();
  await observability.shutdown(); // flushes pending spans, logs and metrics
  process.exit(0);
});
```

That is it. HTTP server and client requests are now traced. Keep reading for logs, metrics and error helpers, or jump to the [runnable example](examples/basic) with a local collector.

## Configuration

Everything is driven by standard OpenTelemetry environment variables.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | Service name in every signal | `defaultServiceName` option, else `unknown_service` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL; `/v1/traces`, `/v1/logs`, `/v1/metrics` are appended | none (SDK stays off) |
| `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_ENDPOINT` | Per-signal full URL (include the path) | inherits base |
| `OTEL_EXPORTER_OTLP_HEADERS` | e.g. `signoz-ingestion-key=...` | none |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Only `http/protobuf` is supported; others fail fast at startup | `http/protobuf` |
| `OTEL_{TRACES,LOGS,METRICS}_EXPORTER` | Set to `none` to disable a signal | `otlp` |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, comma separated | none |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | e.g. `parentbased_traceidratio` + `0.2` | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` / `OTEL_METRIC_EXPORT_TIMEOUT` | Milliseconds. An explicit timeout must not exceed the interval; the default timeout is capped at the interval automatically | `60000` / `30000` |
| `OTEL_SDK_DISABLED` | `true` turns everything into a no-op | `false` |
| `OTEL_LOG_LEVEL` | SDK diagnostic log level (`error`, `warn`, `info`, `debug`, ...) | `error` |

### SigNoz

Self-hosted:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-otel-collector:4318
```

SigNoz Cloud:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<ingestion-key>
```

### Sampling

```dotenv
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

Head sampling drops error spans along with everything else. If preserving errors matters, pair a ratio sampler with tail sampling in your collector, or pass a custom `sampler` option.

### Programmatic options

```ts
initObservability({
  defaultServiceName?: string;          // fallback when OTEL_SERVICE_NAME is unset
  resourceAttributes?: Record<string, string | number | boolean>;
  sampler?: Sampler;                    // overrides OTEL_TRACES_SAMPLER
  extraInstrumentations?: Instrumentation[]; // e.g. @opentelemetry/instrumentation-pg
  enableTraces?: boolean; enableLogs?: boolean; enableMetrics?: boolean;
  metricExportIntervalMs?: number; metricExportTimeoutMs?: number;
});
// -> { enabled, signals: { traces, logs, metrics }, forceFlush(), shutdown() }
```

## Usage

### Errors: log fields + span status in one call

```ts
import { captureError } from '@sistinafibel/otel-kit';

try {
  await paymentGateway.charge(order);
} catch (error) {
  logger.error('Payment failed', captureError(error, {
    errorCode: 'PAYMENT_CHARGE_FAILED', // low-cardinality, good for alerts
    orderId: order.id,                  // fine on logs/spans, keep out of metric labels
  }));
  throw error;
}
```

`captureError` returns a bounded, serialization-safe record (`exception.type`, `exception.message`, `exception.stacktrace`, your meta) **and** records the exception plus `ERROR` status on the active span. Use `recordErrorOnSpan` or `toErrorLogRecord` if you only need one half.

The span always receives the exception message and stack trace as an exception event; `includeStatusDescription` only controls the span *status description*. If an error message might contain secrets, sanitise it before throwing.

### Background work: polling, queues, cron

```ts
import { runWithSpan, SpanKind } from '@sistinafibel/otel-kit';

await runWithSpan('orders.sync', () => syncOrders(), {
  kind: SpanKind.CONSUMER,
  attributes: { 'messaging.destination.name': 'orders' },
  errorType: 'ORDER_SYNC_FAILED',
});
```

The span is ended for you. Errors are recorded on the span and re-thrown unchanged.

### Logs: Winston OTLP transport

```ts
import winston from 'winston';
import { createOtelLogTransport } from '@sistinafibel/otel-kit';

const transports: winston.transport[] = [new winston.transports.Console()];
const otel = createOtelLogTransport('info');
if (otel) transports.push(otel); // null when the logs signal is disabled

export const logger = winston.createLogger({ transports });
```

Log records automatically carry `trace_id` / `span_id` when written inside an active span. Only Winston logs are forwarded; `console.*` and the NestJS default logger are not touched.

### HTTP request logging

```ts
import { createHttpLoggerMiddleware } from '@sistinafibel/otel-kit';

app.use(createHttpLoggerMiddleware({
  logger,            // anything with log/warn/error(message, context)
  logBody: false,    // default: bodies are never logged
  stripQuery: true,  // default: query strings are removed
  logClientIp: false // default: no IPs
}));
```

One structured line per response with method, route, status, duration, `trace_id`, and user agent. Enable `logBody` and known secret / auth / PII keys are masked recursively with depth, entry and string-length limits. Add your own with `extraSensitiveKeys`.

The `user` field defaults to `id` (or `idx`), `role` and `isAnon` picked from `req.user`. If your user object looks different, pass `getUser` and return a small summary rather than the whole object.

### Client IP behind proxies

```ts
import { createRealIpMiddleware } from '@sistinafibel/otel-kit';

// Only when you control exactly this many hops (e.g. CDN + ingress)
app.use(createRealIpMiddleware({ trustedProxyCount: 2 }));
```

Forwarded headers are spoofable, so they are ignored until you set `trustedProxyCount`. The resolved address is exposed as `req.realIp` and, optionally, as span attributes.

### Metrics

```ts
import { getMeter } from '@sistinafibel/otel-kit';

const meter = getMeter('orders');
const failures = meter.createCounter('orders.sync.failures');
failures.add(1, { 'error.type': 'RATE_LIMITED' });
```

otel-kit configures the `MeterProvider` and exporter but does not emit runtime metrics on its own. Add `extraInstrumentations` for the libraries you use.

### NestJS

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OTEL_ERROR_INTERCEPTOR_OPTIONS, OtelErrorInterceptor } from '@sistinafibel/otel-kit/nest';

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: OtelErrorInterceptor },
    { provide: OTEL_ERROR_INTERCEPTOR_OPTIONS, useValue: { recordHttp4xx: false } },
  ],
})
export class AppModule {}
```

`OtelErrorInterceptor` records unhandled exceptions on the request span (4xx `HttpException`s are skipped by default). `RealIpMiddleware` / `REAL_IP_OPTIONS` wrap `createRealIpMiddleware` for `MiddlewareConsumer`. Graceful shutdown fits in `OnApplicationShutdown` together with `app.enableShutdownHooks()`.

## API overview

| Entry point | Export | Purpose |
| --- | --- | --- |
| `@sistinafibel/otel-kit` | `initObservability`, `getObservability`, `isOtelExportEnabled` | Bootstrap, current handle and signal status |
| | `captureError`, `recordErrorOnSpan`, `toErrorLogRecord` | Error normalisation |
| | `runWithSpan` | Spans for non-HTTP work |
| | `createOtelLogTransport` | Winston OTLP transport |
| | `createHttpLoggerMiddleware`, `maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS` | Request logging and redaction |
| | `getClientIp`, `extractIPv4`, `createRealIpMiddleware` | Trusted-proxy IP resolution |
| | `getMeter`, `getActiveTraceId`, `getActiveSpanId` | Metrics and trace context |
| | `SpanKind`, `SpanStatusCode` and types | Re-exported from `@opentelemetry/api` |
| `@sistinafibel/otel-kit/nest` | `OtelErrorInterceptor`, `OTEL_ERROR_INTERCEPTOR_OPTIONS`, `RealIpMiddleware`, `REAL_IP_OPTIONS` | NestJS wrappers |
| `@sistinafibel/otel-kit/register` | `observability` | Preload entry for `--require` |

## Examples

- [examples/basic](examples/basic): plain `http` server + Winston + a local OpenTelemetry Collector via Docker Compose. Run it in three commands and watch spans, logs and metrics arrive.

## Contributing

Bug reports, feature ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and workflow, and [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.

```bash
npm ci
npm run typecheck && npm run build && npm run test:ci
```

## License

[MIT](LICENSE) © sistinafibel
