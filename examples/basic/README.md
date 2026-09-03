# Basic example

<b>English</b> · <a href="README.ko.md">한국어</a>

A plain Node.js HTTP server that sends traces, logs and metrics to a local OpenTelemetry Collector. No framework required.

## 1. Build the library

The example depends on the package via `file:../..`, so build it once from the repository root:

```bash
npm ci
npm run build
```

## 2. Start a collector

```bash
cd examples/basic
docker compose up
```

The collector listens on `http://localhost:4318` and prints every span, log record and metric it receives.

Already running SigNoz or another OTLP backend? Skip this step and point `OTEL_EXPORTER_OTLP_ENDPOINT` at it instead.

## 3. Run the app

```bash
npm install
cp .env.example .env
npm start
```

Then hit it:

```bash
curl "http://localhost:3000/hello?name=otel"
curl http://localhost:3000/fail
```

Watch the collector terminal. You should see:

- an HTTP server span for each request (from the built-in `http` instrumentation)
- a child `example.build-greeting` span under `/hello`
- an error log record with `trace_id` under `/fail`, plus the span marked as ERROR
- the `example.requests` counter every 5 seconds

Press `Ctrl+C` to stop. The app awaits `observability.shutdown()` so the last batch is flushed before exit.

## What to look at

| File | Purpose |
| --- | --- |
| `index.js` | The whole app: logger, meter, spans, error capture, graceful shutdown |
| `.env.example` | Standard `OTEL_*` variables that configure everything |
| `otel-collector.yaml` | Collector config with the `debug` exporter |
