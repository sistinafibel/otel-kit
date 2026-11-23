import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  createHttpQueryRedactionHook,
  redactQueryString,
  redactUrlQuery,
  resolveQueryRedaction,
} from '../http/query-redaction';

describe('redactQueryString', () => {
  it('all: 모든 값을 가리고 키와 순서는 남긴다', () => {
    expect(redactQueryString('client_id=abc&client_secret=xyz&page=2', 'all')).toBe(
      'client_id=REDACTED&client_secret=REDACTED&page=REDACTED',
    );
  });

  it('sensitive: 민감한 이름의 값만 가린다', () => {
    expect(redactQueryString('q=포카&page=2&code=abc&state=xyz&accessToken=t', 'sensitive')).toBe(
      'q=포카&page=2&code=REDACTED&state=REDACTED&accessToken=REDACTED',
    );
  });

  it('sensitive: 부분 일치하고 대소문자를 가리지 않는다 (bank_num, Client_Secret)', () => {
    expect(redactQueryString('bank_code=088&bank_num=110123&Client_Secret=s', 'sensitive')).toBe(
      'bank_code=REDACTED&bank_num=REDACTED&Client_Secret=REDACTED',
    );
  });

  it('none: 그대로 둔다', () => {
    expect(redactQueryString('code=abc', 'none')).toBe('code=abc');
  });

  it('값이 없는 항목 · 빈 값 · 빈 문자열은 건드리지 않는다', () => {
    expect(redactQueryString('flag&a=&b=1', 'all')).toBe('flag&a=&b=REDACTED');
    expect(redactQueryString('', 'all')).toBe('');
  });

  it('중복 키와 값 안의 = 를 보존한다', () => {
    expect(redactQueryString('id=1&id=2&token=a=b', 'sensitive')).toBe('id=1&id=2&token=REDACTED');
  });

  it('percent-encoding 된 키도 풀어서 비교한다', () => {
    expect(redactQueryString('access%5Ftoken=abc&q=1', 'sensitive')).toBe('access%5Ftoken=REDACTED&q=1');
  });

  it('잘못된 percent-encoding 키는 원문으로 비교한다', () => {
    expect(redactQueryString('%E0%A4%A=1&secret%=2', 'sensitive')).toBe('%E0%A4%A=1&secret%=REDACTED');
  });

  it('extraSensitiveKeys 와 allowedKeys 를 적용한다', () => {
    const config = resolveQueryRedaction({ extraSensitiveKeys: ['memberNo'], allowedKeys: ['page'] });
    expect(redactQueryString('memberno=7&q=a', 'sensitive', config)).toBe('memberno=REDACTED&q=a');
    expect(redactQueryString('page=2&q=a', 'all', config)).toBe('page=2&q=REDACTED');
  });
});

describe('redactUrlQuery', () => {
  it('전체 URL 에서 query 만 가리고 fragment 는 남긴다', () => {
    expect(redactUrlQuery('https://api.example.com/v1/token?code=abc&x=1#top', 'all')).toBe(
      'https://api.example.com/v1/token?code=REDACTED&x=REDACTED#top',
    );
  });

  it('기본 방식은 sensitive 다', () => {
    expect(redactUrlQuery('/api/search?q=포카&code=abc')).toBe('/api/search?q=포카&code=REDACTED');
  });

  it('query 가 없으면 그대로 돌려준다', () => {
    expect(redactUrlQuery('/api/packs/1')).toBe('/api/packs/1');
    expect(redactUrlQuery('/api/packs?', 'all')).toBe('/api/packs?');
  });
});

describe('resolveQueryRedaction', () => {
  it('기본값은 나가는 요청 all, 들어오는 요청 sensitive 다', () => {
    const config = resolveQueryRedaction();
    expect(config.outgoing).toBe('all');
    expect(config.incoming).toBe('sensitive');
  });

  it('알 수 없는 방식은 거부한다', () => {
    expect(() => resolveQueryRedaction({ outgoing: 'everything' as never })).toThrow(TypeError);
    expect(() => resolveQueryRedaction({ incoming: 'off' as never })).toThrow(TypeError);
  });
});

describe('createHttpQueryRedactionHook', () => {
  it('두 방향 모두 none 이면 훅을 만들지 않는다', () => {
    expect(createHttpQueryRedactionHook({ outgoing: 'none', incoming: 'none' })).toBeUndefined();
  });

  it('속성을 읽을 수 없는 span 은 건드리지 않는다', () => {
    const hook = createHttpQueryRedactionHook()!;
    const setAttribute = jest.fn();
    hook({ setAttribute } as never);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('한 방향만 none 이면 그 방향은 그대로 둔다', () => {
    const hook = createHttpQueryRedactionHook({ outgoing: 'none' })!;
    const setAttribute = jest.fn();
    hook({ kind: SpanKind.CLIENT, attributes: { 'url.full': 'http://x/?code=1' }, setAttribute } as never);
    expect(setAttribute).not.toHaveBeenCalled();
    hook({ kind: SpanKind.SERVER, attributes: { 'url.query': 'code=1&q=a' }, setAttribute } as never);
    expect(setAttribute).toHaveBeenCalledWith('url.query', 'code=REDACTED&q=a');
  });

  it('옛 속성 이름(http.url · http.target)도 가린다', () => {
    const hook = createHttpQueryRedactionHook()!;
    const setAttribute = jest.fn();
    hook({ kind: SpanKind.SERVER, attributes: { 'http.target': '/cb?code=1&q=a', 'http.url': 'http://x/cb?code=1' }, setAttribute } as never);
    expect(setAttribute).toHaveBeenCalledWith('http.target', '/cb?code=REDACTED&q=a');
    expect(setAttribute).toHaveBeenCalledWith('http.url', 'http://x/cb?code=REDACTED');
  });
});

describe('실제 SDK span 에 훅을 적용', () => {
  // jest 는 모듈을 자체 레지스트리로 불러와 HttpInstrumentation 의 require 훅이 걸리지 않는다.
  // 실제 HTTP 요청으로 하는 검증은 패키지 스모크 테스트(scripts/smoke-package.check.js)가 일반 Node 에서 한다.
  // 여기서는 훅이 기대는 전제(SDK span 에 kind · attributes 가 있고 setAttribute 로 덮어쓸 수 있다)를 확인한다.
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer('query-redaction-test');

  afterAll(async () => {
    await provider.shutdown();
  });

  it('나가는 요청은 값을 전부, 들어오는 요청은 민감한 값만 가린 채 내보낸다', async () => {
    const hook = createHttpQueryRedactionHook()!;
    const client = tracer.startSpan('GET', {
      kind: SpanKind.CLIENT,
      attributes: { 'url.full': 'https://oauth.example.com/token?client_id=app&client_secret=TOPSECRET&code=AUTHCODE' },
    });
    hook(client);
    client.end();
    const server = tracer.startSpan('GET /cb', {
      kind: SpanKind.SERVER,
      attributes: { 'url.path': '/cb', 'url.query': 'code=AUTHCODE&state=XYZ&q=hello' },
    });
    hook(server);
    server.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const exported = JSON.stringify(spans.map(span => span.attributes));
    expect(exported).not.toContain('TOPSECRET');
    expect(exported).not.toContain('AUTHCODE');
    expect(spans[0].attributes['url.full']).toBe(
      'https://oauth.example.com/token?client_id=REDACTED&client_secret=REDACTED&code=REDACTED',
    );
    expect(spans[1].attributes['url.query']).toBe('code=REDACTED&state=REDACTED&q=hello');
    expect(spans[1].attributes['url.path']).toBe('/cb');
  });
});
