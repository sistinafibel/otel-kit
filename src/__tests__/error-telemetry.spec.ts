import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { captureError, recordErrorOnSpan } from '../error-telemetry';
import { runWithSpan } from '../tracing';

afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

describe('error telemetry', () => {
  it('활성 span에 exception, status, error.type을 기록한다', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    provider.getTracer('test').startActiveSpan('operation', span => {
      expect(recordErrorOnSpan(new TypeError('boom'), { errorType: 'CHZZK_API_FAILED' })).toBe(true);
      span.end();
    });
    await provider.forceFlush();

    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['error.type']).toBe('CHZZK_API_FAILED');
    expect(span.events.some(event => event.name === 'exception')).toBe(true);
    await provider.shutdown();
  });

  it('활성 span이 없어도 captureError는 구조화 레코드를 반환한다', () => {
    expect(captureError(new Error('failed'), { errorCode: 'TRACKER_FAILED' })).toMatchObject({
      'exception.type': 'Error',
      'exception.message': 'failed',
      'error.type': 'TRACKER_FAILED',
    });
  });

  it('runWithSpan은 작업 오류를 기록한 뒤 같은 오류를 다시 던진다', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const error = new Error('poll failed');

    await expect(
      runWithSpan(
        'chzzk.poll',
        async () => {
          throw error;
        },
        { errorType: 'CHZZK_POLL_FAILED' },
      ),
    ).rejects.toBe(error);
    await provider.forceFlush();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('chzzk.poll');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['error.type']).toBe('CHZZK_POLL_FAILED');
    await provider.shutdown();
  });
});
