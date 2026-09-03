import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createRealIpMiddleware, extractIPv4, getClientIp, IRealIpRequest } from '../http/client-ip';

const req = (
  headers: Record<string, string | string[] | undefined>,
  extra: Partial<IRealIpRequest> = {},
): IRealIpRequest => ({ headers, ...extra });

describe('extractIPv4', () => {
  it('IPv4-mapped IPv6 를 IPv4 로 정규화한다', () => {
    expect(extractIPv4('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(extractIPv4('10.0.0.1')).toBe('10.0.0.1');
    expect(extractIPv4('2001:db8::1')).toBe('2001:db8::1');
  });
});

describe('getClientIp', () => {
  it('기본적으로 전달 헤더를 신뢰하지 않는다', () => {
    expect(
      getClientIp(
        req(
          { 'x-forwarded-for': '198.51.100.10, 203.0.113.9' },
          { socket: { remoteAddress: '10.0.0.2' } },
        ),
      ),
    ).toBe('10.0.0.2');
  });

  it('trustedProxyCount 만큼 뒤에서 센 위치를 취한다 (CDN + nginx)', () => {
    const r = req({ 'x-forwarded-for': '192.0.2.10, 203.0.113.9, 198.51.100.1' });
    expect(getClientIp(r, { trustedProxyCount: 2 })).toBe('203.0.113.9');
    // 프록시 수보다 값이 적으면 위조 가능성이 있으므로 사용하지 않는다
    expect(getClientIp(r, { trustedProxyCount: 10 })).toBeUndefined();
  });

  it('배열 헤더·공백·빈 항목을 처리한다', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': ['  ::ffff:1.2.3.4 , 5.6.7.8  '] }), {
        trustedProxyCount: 1,
      }),
    ).toBe('5.6.7.8');
    expect(
      getClientIp(req({ 'x-forwarded-for': ' , ', 'x-real-ip': '9.9.9.9' }), {
        trustedProxyCount: 1,
      }),
    ).toBe('9.9.9.9');
  });

  it('신뢰된 X-Real-IP → 소켓 → req.ip 순으로 폴백한다', () => {
    expect(
      getClientIp(req({ 'x-real-ip': '::ffff:7.7.7.7' }), { trustedProxyCount: 1 }),
    ).toBe('7.7.7.7');
    expect(getClientIp(req({}, { socket: { remoteAddress: '::ffff:8.8.8.8' } }))).toBe('8.8.8.8');
    expect(
      getClientIp(req({}, { ip: '198.51.100.99', socket: { remoteAddress: '10.0.0.2' } })),
    ).toBe('10.0.0.2');
    expect(getClientIp(req({}, { ip: '6.6.6.6' }))).toBe('6.6.6.6');
    expect(getClientIp(req({}))).toBeUndefined();
  });

  it('잘못된 IP와 proxy count를 거부한다', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': 'not-an-ip' }), { trustedProxyCount: 1 }),
    ).toBeUndefined();
    expect(() => getClientIp(req({}), { trustedProxyCount: 1.5 })).toThrow(RangeError);
    expect(() => getClientIp(req({}), { trustedProxyCount: Number.NaN })).toThrow(RangeError);
  });
});

describe('createRealIpMiddleware', () => {
  it('req.realIp 를 채우고 next 를 호출한다', () => {
    const r = req({ 'x-forwarded-for': '1.1.1.1' });
    const next = jest.fn();
    createRealIpMiddleware({ trustedProxyCount: 1 })(r, {}, next);
    expect(r.realIp).toBe('1.1.1.1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('활성 스팬에 client.address / user_agent.original 을 기록한다', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    provider.getTracer('t').startActiveSpan('http', span => {
      createRealIpMiddleware({ trustedProxyCount: 1, recordSpanAttributes: true })(
        req({ 'x-real-ip': '2.2.2.2', 'user-agent': 'jest' }),
        {},
        () => undefined,
      );
      span.end();
    });
    await provider.forceFlush();
    const [span] = exporter.getFinishedSpans();
    await provider.shutdown();
    expect(span.attributes['client.address']).toBe('2.2.2.2');
    expect(span.attributes['user_agent.original']).toBe('jest');
  });
});
