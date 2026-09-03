import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { getActiveSpanId, getActiveTraceId } from '../trace-context';
import { getMeter } from '../metrics';

describe('trace-context', () => {
  it('활성 스팬이 없으면 undefined 를 반환한다', () => {
    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });

  it('활성 스팬 안에서는 traceId/spanId 를 반환한다', () => {
    const provider = new NodeTracerProvider();
    provider.register();
    try {
      provider.getTracer('test').startActiveSpan('op', span => {
        expect(getActiveTraceId()).toMatch(/^[0-9a-f]{32}$/);
        expect(getActiveSpanId()).toMatch(/^[0-9a-f]{16}$/);
        span.end();
      });
    } finally {
      void provider.shutdown();
    }
  });
});

describe('getMeter', () => {
  it('MeterProvider 미등록 상태에서도 no-op Meter 를 돌려주어 계측 코드가 예외 없이 동작한다', () => {
    const meter = getMeter('test-scope');
    const gauge = meter.createObservableGauge('test.gauge');
    expect(() => gauge.addCallback(result => result.observe(1))).not.toThrow();
    expect(() => meter.createCounter('test.counter').add(1)).not.toThrow();
  });
});
