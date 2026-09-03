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

<p align="center"><b>English</b> · <a href="README.ko.md">한국어</a></p>

**otel-kit** takes the tedious part of adding OpenTelemetry to a Node.js service off your hands. One import and the standard `OTEL_*` environment variables wire up all three signals: **traces, logs and metrics**.

The pieces that are fiddly to build yourself are already here — error capture, spans for background jobs, a Winston OTLP transport, HTTP request logging and client IP resolution behind proxies — with defaults chosen so nothing private leaks by accident. NestJS wrappers are included if you need them.

Send the data anywhere that speaks OTLP/HTTP: **SigNoz**, **Grafana (Tempo / Loki / Mimir)**, the **OpenTelemetry Collector**, or your own endpoint.

<details>
<summary><b>Terms used in this README</b></summary>

<br>

| Term | What it means |
| --- | --- |
| Trace | The full path one request takes through your services |
| Span | One unit of work inside a trace, such as "DB query, 12ms" |
| Signal | A kind of data OpenTelemetry handles: traces, logs or metrics |
| Instrumentation | Code that hooks into a library and creates spans for you |
| Exporter | The part that actually ships collected data to a backend |
| Collector | A server that receives data from many services, processes it and forwards it |

</details>

## Why otel-kit?

Wiring up the OpenTelemetry SDK by hand is a lot of work. You install a dozen packages, configure exporters, samplers and resources, keep track of a different environment variable per signal, and get the shutdown ordering right so nothing is lost on exit. otel-kit settles all of that once and reuses it in every service.

- **One call, three signals.** `initObservability()` sets up trace, log and metric providers. Only the signals that actually have an endpoint are turned on, so you can ignore the ones you don't use.
- **No config format to learn.** It honors the standard OpenTelemetry variables — `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`, `OTEL_TRACES_SAMPLER` and friends. There is nothing otel-kit-specific to memorize.
- **Safe defaults.** The HTTP logger records no request bodies, no query strings and no client IPs until you opt in. Secret-looking keys are masked even inside nested objects, and error objects are serialized with depth and size limits.
- **You decide what to trust.** `X-Forwarded-For` can be forged, so it is ignored until you say how many proxies sit in front of your app.
- **Shutdown stays yours.** otel-kit never installs its own `SIGTERM` handler. You call `await observability.shutdown()` wherever it belongs in your app.
- **Framework agnostic.** The core helpers work with plain `http`, Express or Fastify. On NestJS, the `/nest` entry point adds a middleware and an interceptor.

## What it does and doesn't do

**It does**

- Initialize the OpenTelemetry SDK and flush what's pending on shutdown
- Instrument HTTP server and client requests automatically
- Record errors in the same shape on both log fields and spans
- Ship Winston logs over OTLP
- Write one structured log line per request, with sensitive values masked
- Resolve the client IP based on how many proxies you trust

**It doesn't**

- Ship a backend. You still need somewhere to store and view the data
- Instrument libraries like your database or Redis. Pass the instrumentation packages you need via `extraInstrumentations`
- Emit runtime metrics such as CPU or memory. It sets up the tooling; the metrics are yours to define
- Touch `console.log` or the NestJS default logger. Only Winston logs are forwarded
- Handle termination signals for you

## Requirements

| | |
| --- | --- |
| Node.js | 22 or newer |
| Backend | Anything that accepts OTLP/HTTP protobuf (SigNoz, OTel Collector, Grafana...) |
| Optional | `winston` 3.x for the log transport; `@nestjs/common` 10 to 12 and `rxjs` 7.x for the NestJS helpers |

## Installation

```bash
npm install @cloudjun/otel-kit @opentelemetry/api
```

There is a reason `@opentelemetry/api` is installed alongside. It holds the process-wide tracer, meter and logger registries, so exactly one copy must exist in your dependency tree. That is why otel-kit declares it as a peer dependency — a dependency the consuming app installs itself — which npm 7 and newer add automatically with the command above.

If you combine otel-kit with other instrumentation packages, run `npm ls @opentelemetry/api` to confirm it isn't duplicated. Two copies means spans land in two different registries, and traces break apart.

## Quick start

### 1. Point it at your backend

```dotenv
OTEL_SERVICE_NAME=my-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.version=1.2.3
```

### 2. Load it before anything else

OpenTelemetry has to be initialised **before** the modules it instruments (`http`, frameworks, DB drivers) are loaded, because a module that is already loaded can no longer be hooked.

The simplest way is the preload entry point:

```bash
node --require @cloudjun/otel-kit/register dist/main.js
# or
NODE_OPTIONS="--require=@cloudjun/otel-kit/register" node dist/main.js
```

Prefer to pass options in code? Put the setup in its own file and make it the **first import** of your entry point:

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
import { observability } from './instrumentation'; // must stay first
import { NestFactory } from '@nestjs/core';
```

`initObservability()` runs once per process. With no OTLP endpoint configured, or with `OTEL_SDK_DISABLED=true`, it returns a handle that does nothing at all — so local development works without a collector and without code changes.

### 3. Flush on shutdown

```ts
process.on('SIGTERM', async () => {
  await server.close();
  await observability.shutdown(); // sends any spans, logs and metrics still pending
  process.exit(0);
});
```

That is it. HTTP server and client requests are now traced. Logs, metrics and the error helpers are covered below — or jump straight to the [runnable example](examples/basic), which includes a local collector.

## Configuration

Everything is driven by standard OpenTelemetry environment variables.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | Service name attached to every signal | the `defaultServiceName` option, otherwise `unknown_service` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL; `/v1/traces`, `/v1/logs` and `/v1/metrics` are appended for you | none (the SDK stays off) |
| `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_ENDPOINT` | Per-signal URL, path included | falls back to the base URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth and other headers, e.g. `signoz-ingestion-key=...` | none |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Only `http/protobuf` is supported; anything else fails at startup | `http/protobuf` |
| `OTEL_{TRACES,LOGS,METRICS}_EXPORTER` | Set to `none` to turn that signal off | `otlp` |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, comma separated | none |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sampling strategy and its argument, e.g. `parentbased_traceidratio` + `0.2` | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` / `OTEL_METRIC_EXPORT_TIMEOUT` | How often metrics are exported and the time limit per export, in milliseconds. An explicit timeout must not exceed the interval; the default one is capped at the interval automatically | `60000` / `30000` |
| `OTEL_SDK_DISABLED` | `true` turns everything into a no-op | `false` |
| `OTEL_LOG_LEVEL` | The SDK's own diagnostic log level (`error`, `warn`, `info`, `debug`, ...) | `error` |

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

By default every request is recorded. Under heavy traffic you can keep a fraction instead:

```dotenv
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

Keep in mind that this approach — head sampling — decides the moment a request **starts**, before the outcome is known, so failed requests are dropped at the same rate as everything else. If you can't afford to lose errors, pair the ratio sampler with tail sampling in your collector (which decides after the request finishes), or pass your own `sampler` option.

### Programmatic options

```ts
initObservability({
  defaultServiceName?: string;          // used when OTEL_SERVICE_NAME is unset
  resourceAttributes?: Record<string, string | number | boolean>;
  sampler?: Sampler;                    // takes precedence over OTEL_TRACES_SAMPLER
  extraInstrumentations?: Instrumentation[]; // e.g. @opentelemetry/instrumentation-pg
  enableTraces?: boolean; enableLogs?: boolean; enableMetrics?: boolean;
  metricExportIntervalMs?: number; metricExportTimeoutMs?: number;
});
// -> { enabled, signals: { traces, logs, metrics }, forceFlush(), shutdown() }
```

## Usage

### Errors: log fields and span status in one call

```ts
import { captureError } from '@cloudjun/otel-kit';

try {
  await paymentGateway.charge(order);
} catch (error) {
  logger.error('Payment failed', captureError(error, {
    errorCode: 'PAYMENT_CHARGE_FAILED', // few distinct values, good for alerts and grouping
    orderId: order.id,                  // fine on logs and spans, keep it out of metric labels
  }));
  throw error;
}
```

`captureError` does two things at once. It returns a record you can drop straight into a log (`exception.type`, `exception.message`, `exception.stacktrace`, plus whatever meta you passed), and it records the exception and an `ERROR` status on the span that is currently open. The record is bounded in depth and size, so even a circular or very large error object serializes safely. If you only need one half, use `recordErrorOnSpan` (span only) or `toErrorLogRecord` (record only).

The exception message and stack trace always land on the span as an exception event; `includeStatusDescription` only affects the span's *status description*. If an error message might contain secrets, sanitise it before throwing.

### Background work: polling, queues, cron

Work that isn't an HTTP request isn't instrumented automatically, so wrap it in a span yourself:

```ts
import { runWithSpan, SpanKind } from '@cloudjun/otel-kit';

await runWithSpan('orders.sync', () => syncOrders(), {
  kind: SpanKind.CONSUMER,
  attributes: { 'messaging.destination.name': 'orders' },
  errorType: 'ORDER_SYNC_FAILED',
});
```

The span closes on its own when the work finishes. Errors are recorded on the span and then re-thrown unchanged, so your surrounding error handling behaves exactly as before.

### Logs: Winston OTLP transport

```ts
import winston from 'winston';
import { createOtelLogTransport } from '@cloudjun/otel-kit';

const transports: winston.transport[] = [new winston.transports.Console()];
const otel = createOtelLogTransport('info');
if (otel) transports.push(otel); // null when the logs signal is disabled

export const logger = winston.createLogger({ transports });
```

Anything logged while a span is open automatically carries `trace_id` and `span_id`, which lets you jump from a log line to its trace. Only Winston logs are forwarded; `console.*` and the NestJS default logger are left alone.

### HTTP request logging

```ts
import { createHttpLoggerMiddleware } from '@cloudjun/otel-kit';

app.use(createHttpLoggerMiddleware({
  logger,            // anything with log/warn/error(message, context)
  logBody: false,    // default: request bodies are never logged
  stripQuery: true,  // default: query strings are removed
  logClientIp: false // default: no IPs
}));
```

Each response produces one structured line with the method, route, status code, duration, `trace_id` and user agent.

Turn on `logBody` and request bodies are included too — but keys known to hold passwords, auth tokens or personal data are masked, nested objects included, with caps on depth, entry count and string length. Add keys specific to your project through `extraSensitiveKeys`.

The `user` field picks only `id` (or `idx`), `role` and `isAnon` off `req.user` by default. If your user object has a different shape, pass `getUser` and return a small summary. Returning the whole object puts all of it in your logs.

### Client IP behind proxies

```ts
import { createRealIpMiddleware } from '@cloudjun/otel-kit';

// Set this only if you know the hop count exactly (e.g. CDN + ingress = 2)
app.use(createRealIpMiddleware({ trustedProxyCount: 2 }));
```

Clients can put whatever they like in `X-Forwarded-For`, so the header is ignored entirely until you set `trustedProxyCount`.

Once you do, otel-kit counts that many entries **from the end** of the list and treats that address as the real client. Each proxy appends its view to the right, so a forged value always stays on the left and falls out of range. The result is exposed as `req.realIp` and, optionally, as span attributes.

### Metrics

```ts
import { getMeter } from '@cloudjun/otel-kit';

const meter = getMeter('orders');
const failures = meter.createCounter('orders.sync.failures');
failures.add(1, { 'error.type': 'RATE_LIMITED' });
```

otel-kit sets up the `MeterProvider` and the exporter, but it doesn't invent metrics for you. Define the ones you need as above, or pass the instrumentation packages for your libraries via `extraInstrumentations`.

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

`OtelErrorInterceptor` records unhandled exceptions on the request span. 4xx `HttpException`s are usually the client's doing, so they are skipped by default — the `recordHttp4xx: false` above just spells that default out. Flip it to `true` if you want 4xx counted as errors.

`RealIpMiddleware` and `REAL_IP_OPTIONS` wrap `createRealIpMiddleware` so it can be registered through `MiddlewareConsumer`. Flushing on shutdown fits naturally into `OnApplicationShutdown` together with `app.enableShutdownHooks()`.

## API overview

| Entry point | Export | Purpose |
| --- | --- | --- |
| `@cloudjun/otel-kit` | `initObservability`, `getObservability`, `isOtelExportEnabled` | Bootstrap, current handle, signal status |
| | `captureError`, `recordErrorOnSpan`, `toErrorLogRecord` | Consistent error records |
| | `runWithSpan` | Spans for non-HTTP work |
| | `createOtelLogTransport` | Winston logs over OTLP |
| | `createHttpLoggerMiddleware`, `maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS` | Request logging and redaction |
| | `getClientIp`, `extractIPv4`, `createRealIpMiddleware` | Trusted-proxy IP resolution |
| | `getMeter`, `getActiveTraceId`, `getActiveSpanId` | Metrics and current trace context |
| | `SpanKind`, `SpanStatusCode` and types | Re-exported from `@opentelemetry/api` |
| `@cloudjun/otel-kit/nest` | `OtelErrorInterceptor`, `OTEL_ERROR_INTERCEPTOR_OPTIONS`, `RealIpMiddleware`, `REAL_IP_OPTIONS` | NestJS wrappers |
| `@cloudjun/otel-kit/register` | `observability` | Preload entry point for `--require` |

## Examples

- [examples/basic](examples/basic): a plain `http` server, Winston, and an OpenTelemetry Collector started with Docker Compose. Three commands and you can watch spans, logs and metrics arrive.

## Contributing

Bug reports, feature ideas and pull requests are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup and workflow, and [SECURITY.md](SECURITY.md) explains how to report a vulnerability privately.

```bash
npm ci
npm run typecheck && npm run build && npm run test:ci
```

## License

[MIT](LICENSE) © sistinafibel
