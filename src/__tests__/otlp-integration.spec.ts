import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { initObservability } from '../init-observability';

const ORIGINAL_ENV = { ...process.env };

describe('OTLP/HTTP integration', () => {
  let server: Server;
  const requests: Array<{ path: string; bytes: number }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let bytes = 0;
      req.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
      });
      req.on('end', () => {
        requests.push({ path: req.url ?? '', bytes });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/x-protobuf');
        res.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    trace.disable();
    metrics.disable();
    logs.disable();
    context.disable();
    propagation.disable();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  it('trace, log, metric을 표준 OTLP 경로로 내보낸다', async () => {
    trace.disable();
    metrics.disable();
    logs.disable();
    context.disable();
    propagation.disable();

    const port = (server.address() as AddressInfo).port;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
    process.env.OTEL_TRACES_EXPORTER = 'otlp';
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
    process.env.OTEL_METRICS_EXPORTER = 'otlp';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;

    const handle = initObservability({
      defaultServiceName: 'otel-kit-integration-test',
      metricExportIntervalMs: 60_000,
    });
    expect(handle.signals).toEqual({ traces: true, logs: true, metrics: true });

    const span = trace.getTracer('integration').startSpan('integration.span');
    span.setAttribute('test.case', 'otlp');
    span.end();

    logs.getLogger('integration').emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: 'integration log',
      attributes: { 'error.type': 'INTEGRATION_TEST' },
    });

    metrics.getMeter('integration').createCounter('integration.counter').add(1);

    try {
      await handle.forceFlush();
    } catch (error) {
      const causes =
        error instanceof AggregateError
          ? error.errors.map(cause => (cause instanceof Error ? cause.stack ?? cause.message : String(cause)))
          : [error instanceof Error ? error.stack ?? error.message : String(error)];
      throw new Error(`OTLP forceFlush failed:\n${causes.join('\n---\n')}`);
    }

    expect(requests.map(request => request.path)).toEqual(
      expect.arrayContaining(['/v1/traces', '/v1/logs', '/v1/metrics']),
    );
    expect(requests.every(request => request.bytes > 0)).toBe(true);

    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
