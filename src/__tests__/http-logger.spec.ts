import { EventEmitter } from 'events';
import {
  createHttpLoggerMiddleware,
  IHttpLoggerRequest,
  IHttpLoggerResponse,
  IHttpLogWriter,
  maskSensitiveData,
} from '../http/http-logger.middleware';

type Call = [string, unknown, string | undefined];

const makeLogger = (): IHttpLogWriter & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    log: (m, c) => calls.push(['log', m, c]),
    warn: (m, c) => calls.push(['warn', m, c]),
    error: (m, c) => calls.push(['error', m, c]),
  };
};

const makeRes = (statusCode: number, statusMessage?: string): IHttpLoggerResponse & EventEmitter => {
  const res = new EventEmitter() as IHttpLoggerResponse & EventEmitter;
  res.statusCode = statusCode;
  res.statusMessage = statusMessage;
  return res;
};

const makeReq = (over: Partial<IHttpLoggerRequest> = {}): IHttpLoggerRequest => ({
  method: 'POST',
  url: '/api/login?x=1',
  originalUrl: '/api/login?x=1',
  headers: { 'user-agent': 'jest' },
  socket: { remoteAddress: '::ffff:10.0.0.1' },
  body: { email: 'a@b.c', password: 'pw', nested: { cardNo: '1234', ok: 'keep' }, list: [{ token: 't' }] },
  ...over,
});

describe('maskSensitiveData', () => {
  it('민감 키를 재귀·부분일치·대소문자무시로 마스킹하고 입력은 변경하지 않는다', () => {
    const input = { UserPassword: 'x', profile: { Email: 'e', name: 'n' }, arr: [{ refreshTOKEN: 'r' }, 'str'] };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = maskSensitiveData(input, ['password', 'email', 'token']);

    expect(out).toEqual({
      UserPassword: '********',
      profile: { Email: '********', name: 'n' },
      arr: [{ refreshTOKEN: '********' }, 'str'],
    });
    expect(input).toEqual(snapshot);
  });

  it('순환 참조와 크기 제한을 안전하게 처리한다', () => {
    const circular: Record<string, unknown> = { secret: 'x' };
    circular.self = circular;
    expect(maskSensitiveData(circular, ['secret'])).toEqual({
      secret: '********',
      self: '[Circular]',
    });
    expect(maskSensitiveData({ a: { b: { c: 1 } } }, [], { maxDepth: 2 })).toEqual({
      a: { b: '[Truncated]' },
    });
  });

  it('객체가 아닌 값은 그대로 반환한다', () => {
    expect(maskSensitiveData('raw', ['x'])).toBe('raw');
    expect(maskSensitiveData(null, ['x'])).toBeNull();
    expect(maskSensitiveData(undefined, ['x'])).toBeUndefined();
  });
});

describe('createHttpLoggerMiddleware', () => {
  it('응답 완료 시 구조화 로그를 남기고 body 를 마스킹한다', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({
      logger,
      getTraceId: () => 'abc',
      getSpanId: () => 'def',
      logBody: true,
      logClientIp: true,
      stripQuery: false,
    });
    const req = makeReq({ realIp: '203.0.113.1', user: { idx: 'u1', role: 'admin' } });
    const res = makeRes(200);
    const next = jest.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(logger.calls).toHaveLength(0);

    res.emit('finish');
    const [level, data, context] = logger.calls[0];
    expect(level).toBe('log');
    expect(context).toBe('HTTP');
    expect(data).toMatchObject({
      message: 'HTTP',
      trace_id: 'abc',
      span_id: 'def',
      method: 'POST',
      originalUrl: '/api/login?x=1',
      'url.path': '/api/login',
      statusCode: 200,
      ip: '203.0.113.1',
      userAgent: 'jest',
      user: { id: 'u1', role: 'admin' },
      body: {
        email: '********',
        password: '********',
        nested: { cardNo: '********', ok: 'keep' },
        list: [{ token: '********' }],
      },
    });
    expect(typeof (data as { durationMs: number }).durationMs).toBe('number');
  });

  it('상태코드에 따라 warn/error 로 분기하고 5xx 는 statusMessage 를 context 로 쓴다', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({ logger });

    const res4 = makeRes(404);
    mw(makeReq(), res4, () => undefined);
    res4.emit('finish');

    const res5 = makeRes(503, 'Service Unavailable');
    mw(makeReq(), res5, () => undefined);
    res5.emit('finish');

    expect(logger.calls[0][0]).toBe('warn');
    expect(logger.calls[1][0]).toBe('error');
    expect(logger.calls[1][2]).toBe('HTTP');
  });

  it('logBody=false 면 body 를 생략하고, stripQuery=true 면 쿼리스트링을 제거한다', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({ logger, logBody: false, stripQuery: true });
    const res = makeRes(200);
    mw(makeReq(), res, () => undefined);
    res.emit('finish');

    const data = logger.calls[0][1] as Record<string, unknown>;
    expect(data).not.toHaveProperty('body');
    expect(data.originalUrl).toBe('/api/login');
  });

  it('getUser / extraSensitiveKeys 옵션을 존중하고 realIp 가 없으면 소켓 주소를 쓴다', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({
      logger,
      extraSensitiveKeys: ['nickname'],
      logBody: true,
      logClientIp: true,
      getUser: r => ({ custom: (r.user as { id?: string } | undefined)?.id ?? 'anon' }),
    });
    const res = makeRes(200);
    mw(makeReq({ body: { nickname: 'n', keep: 1 }, user: undefined }), res, () => undefined);
    res.emit('finish');

    const data = logger.calls[0][1] as Record<string, unknown>;
    expect(data.user).toEqual({ custom: 'anon' });
    expect(data.body).toEqual({ nickname: '********', keep: 1 });
    expect(data.ip).toBe('10.0.0.1');
  });

  it('user 없음 → "No User", originalUrl 없음 → url, 활성 스팬 없음 → traceId 생략', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({ logger });
    const res = makeRes(200);
    mw(makeReq({ originalUrl: undefined, url: '/plain', user: undefined }), res, () => undefined);
    res.emit('finish');

    const data = logger.calls[0][1] as Record<string, unknown>;
    expect(data.user).toBe('No User');
    expect(data.originalUrl).toBe('/plain');
    expect(data).not.toHaveProperty('trace_id');
    expect(data).not.toHaveProperty('body');
  });

  it('finish/close 중 최초 이벤트만 기록하고 조기 close는 오류로 기록한다', () => {
    const logger = makeLogger();
    const mw = createHttpLoggerMiddleware({ logger });
    const res = makeRes(200);
    mw(makeReq(), res, () => undefined);

    res.emit('close');
    res.emit('finish');

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0][0]).toBe('error');
    expect(logger.calls[0][1]).toMatchObject({
      outcome: 'aborted',
      'error.type': 'CLIENT_ABORTED',
    });
  });
});

describe('createHttpLoggerMiddleware — 옵션 검증과 마스킹 경계', () => {
  it('크기 제한 옵션이 잘못되면 요청 시점이 아니라 생성 시점에 던진다', () => {
    expect(() => createHttpLoggerMiddleware({ logger: makeLogger(), maxDepth: 0 })).toThrow(RangeError);
    expect(() => createHttpLoggerMiddleware({ logger: makeLogger(), maxEntries: -1 })).toThrow(RangeError);
  });

  it('__proto__ 키는 프로토타입을 오염시키지 않고 자체 속성으로만 남는다', () => {
    const body = JSON.parse('{"__proto__":{"polluted":true},"name":"ok"}');
    const masked = maskSensitiveData(body, []) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(masked)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(masked, '__proto__')).toBe(true);
    expect(masked.name).toBe('ok');
  });

  it('getter 가 던지는 키는 해당 키만 [Unserializable] 로 대체하고 나머지는 유지한다', () => {
    const body = { safe: 1 } as Record<string, unknown>;
    Object.defineProperty(body, 'broken', {
      enumerable: true,
      get() {
        throw new Error('getter failed');
      },
    });
    const masked = maskSensitiveData(body, []) as Record<string, unknown>;
    expect(masked.safe).toBe(1);
    expect(masked.broken).toBe('[Unserializable]');
  });

  it('키 수 한도를 넘는 큰 평면 객체는 한도에서 멈추고 [Truncated] 표시를 남긴다', () => {
    const body: Record<string, number> = {};
    for (let i = 0; i < 1_000; i += 1) {
      body[`k${i}`] = i;
    }
    const masked = maskSensitiveData(body, [], { maxEntries: 10 }) as Record<string, unknown>;
    expect(Object.keys(masked)).toHaveLength(11);
    expect(masked['[Truncated]']).toBe(true);
  });
});
