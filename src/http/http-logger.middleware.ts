/**
 * 개인정보 안전 기본값을 갖는 구조화 HTTP 요청 로깅 미들웨어.
 *
 * 기본값: 요청 body 미수집, query string 제거, 클라이언트 IP 미수집.
 * body 수집을 켜면 `maskSensitiveData` 로 알려진 비밀 · 인증 · 개인정보 키를 재귀 마스킹하고
 * 깊이 · 항목 수 · 문자열 길이를 제한한다. 그래도 허용 목록 방식의 별도 DTO 변환이 가장 안전하다.
 */
import { context, diag } from '@opentelemetry/api';
import { getActiveSpanId, getActiveTraceId } from '../trace-context';
import { getClientIp } from './client-ip';

/**
 * 로그를 실제로 쓰는 객체의 최소 형태. NestJS `Logger` 와 winston 호환 래퍼가 구조적으로 만족한다.
 * @property log 2xx · 3xx 완료 로그
 * @property warn 4xx 완료 로그
 * @property error 5xx 또는 클라이언트 중단 로그
 */
export interface IHttpLogWriter {
  log(message: unknown, context?: string): void;
  warn(message: unknown, context?: string): void;
  error(message: unknown, context?: string): void;
}

/**
 * 로깅에 필요한 최소 요청 형태. Express/Nest `Request` 가 구조적으로 만족한다.
 * @property originalUrl Express 가 라우터 mount 전 경로를 보존한 URL. 있으면 `url` 보다 우선한다
 * @property realIp `createRealIpMiddleware` 가 채운 IP. 있으면 재추출하지 않는다
 * @property user 인증 미들웨어가 채운 사용자 객체. `getUser` 옵션으로 로그 형태를 정한다
 * @property route Express 라우트 정보. `route.path` 가 `http.route` 로 기록된다
 */
export interface IHttpLoggerRequest {
  method: string;
  url: string;
  originalUrl?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
  realIp?: string;
  user?: unknown;
  route?: { path?: unknown };
}

/**
 * 로깅에 필요한 최소 응답 형태.
 * @property on `finish`(정상 완료) 와 `close`(소켓 종료) 이벤트 구독. Node `ServerResponse` 가 만족한다
 */
export interface IHttpLoggerResponse {
  statusCode: number;
  statusMessage?: string;
  on(event: 'finish' | 'close', listener: () => void): unknown;
}

/**
 * `maskSensitiveData` 의 크기 제한 옵션. 모두 양의 정수여야 한다.
 * @property maxDepth 재귀 깊이 한도 (기본 8). 초과하는 하위 값은 `[Truncated]` 로 대체
 * @property maxEntries 전체 배열 요소 · 객체 키 수 한도 (기본 500)
 * @property maxStringLength 문자열 길이 한도 (기본 4096). 초과분은 잘라내고 `[Truncated]` 를 붙인다
 */
export interface IRedactionOptions {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
}

/**
 * `createHttpLoggerMiddleware` 옵션.
 *
 * @property logger 로그를 쓸 객체 (필수)
 * @property getTraceId 로그에 넣을 trace ID 추출기. 기본은 활성 span 의 traceId
 * @property getSpanId 로그에 넣을 span ID 추출기. 기본은 활성 span 의 spanId
 * @property getUser 로그의 `user` 필드를 만드는 함수. 기본은 `id`(`idx` 또는 `id`) · `role` · `isAnon` 만 뽑는다.
 *   사용자 객체 구조가 다르면 반드시 지정한다. 개인정보를 통째로 넘기지 않는다
 * @property getRoute `http.route` 로 기록할 라우트 패턴 추출기. 기본은 Express `req.route.path`
 * @property extraSensitiveKeys `DEFAULT_SENSITIVE_KEYS` 에 더해 마스킹할 키 (부분 일치 · 대소문자 무시)
 * @property logBody 요청 body 기록 여부. 기본 false. 켜면 마스킹과 크기 제한이 적용된다
 * @property stripQuery URL 에서 query string 을 제거할지 여부. 기본 true
 * @property logClientIp 클라이언트 IP 기록 여부. 기본 false
 * @property onError 로그 작성이나 사용자 정의 extractor 실패 보고. 기본은 OTel diagnostic logger
 */
export interface IHttpLoggerOptions extends IRedactionOptions {
  logger: IHttpLogWriter;
  getTraceId?: (req: IHttpLoggerRequest) => string | undefined;
  getSpanId?: (req: IHttpLoggerRequest) => string | undefined;
  getUser?: (req: IHttpLoggerRequest) => unknown;
  getRoute?: (req: IHttpLoggerRequest) => string | undefined;
  extraSensitiveKeys?: string[];
  logBody?: boolean;
  stripQuery?: boolean;
  logClientIp?: boolean;
  onError?: (error: unknown) => void;
}

/**
 * 기본 마스킹 키 목록. 키 이름에 이 문자열이 포함되면(대소문자 무시) 값을 `********` 로 바꾼다.
 * 인증 정보 · 개인 식별 정보 · 결제 정보 · 송금 정보를 포괄한다. `extraSensitiveKeys` 로 확장한다.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  'password',
  'accessToken',
  'refreshToken',
  'authCode',
  'authorization',
  'apiKey',
  'token',
  'secret',
  'credential',
  'privateKey',
  'cookie',
  'session',
  'phone',
  'email',
  'firstName',
  'lastName',
  'fullName',
  'surName',
  'givenName',
  'birthday',
  'passportNumber',
  'cardPassword',
  'cardNo',
  'cardNumber',
  'validThru',
  'cvc',
  'cardId',
  'paymentToken',
  'txTid',
  'beneficiaryAC',
  'beneficiaryName',
  'beneficiaryBank',
  'swift',
];

const MASK = '********';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';
const UNSERIALIZABLE = '[Unserializable]';
const NO_USER = 'No User';
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_STRING_LENGTH = 4_096;

/** 양의 안전 정수만 허용한다. 미지정이면 기본값을 쓴다 */
function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

/** `toString` 이 던져도 예외를 내지 않는 문자열화 */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return UNSERIALIZABLE;
  }
}

/** 검증이 끝난 제한값 */
interface IRedactionLimits {
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
}

/** 옵션을 검증해 제한값 객체로 만든다 */
function resolveLimits(options: IRedactionOptions): IRedactionLimits {
  return {
    maxDepth: positiveInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 'maxDepth'),
    maxEntries: positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 'maxEntries'),
    maxStringLength: positiveInteger(
      options.maxStringLength,
      DEFAULT_MAX_STRING_LENGTH,
      'maxStringLength',
    ),
  };
}

/**
 * 객체 · 배열이 아닌 값(원시값 · Buffer · Date 등)을 로그에 안전한 형태로 바꾼다.
 * @returns 변환된 값. 재귀가 필요한 객체면 undefined 를 돌려줘 호출자가 이어서 처리하게 한다
 */
function visitLeaf(current: unknown, maxStringLength: number): unknown {
  if (typeof current === 'string') {
    return current.length > maxStringLength
      ? `${current.slice(0, maxStringLength)}${TRUNCATED}`
      : current;
  }
  if (
    current === null ||
    current === undefined ||
    typeof current === 'number' ||
    typeof current === 'boolean'
  ) {
    return current;
  }
  if (typeof current === 'bigint' || typeof current === 'symbol' || typeof current === 'function') {
    return safeString(current);
  }
  if (Buffer.isBuffer(current)) {
    return `[Buffer ${current.byteLength} bytes]`;
  }
  if (current instanceof Date) {
    return Number.isNaN(current.valueOf()) ? 'Invalid Date' : current.toISOString();
  }
  return undefined;
}

/**
 * 민감 키 마스킹과 크기 제한을 적용한 **새 값**을 반환한다. 입력은 변경하지 않는다.
 *
 * 방어 내용:
 * - 순환 참조는 `[Circular]`, 깊이 · 항목 수 초과는 `[Truncated]` 로 대체해 무한 재귀와 메모리 폭주를 막는다
 * - getter 가 던지거나 `toString` 이 실패해도 예외를 내지 않는다
 * - 출력 키는 `Object.defineProperty` 로 정의해 `__proto__` 같은 키가 프로토타입을 오염시키지 못한다
 * - 객체 키는 `Object.keys` 로 한 번에 배열화하지 않고 `for...in` 으로 순회하며 한도에서 즉시 멈춘다
 *
 * @param value 마스킹할 값 (보통 요청 body)
 * @param sensitiveKeys 마스킹할 키 목록. 키 이름에 부분 일치(대소문자 무시)하면 값을 가린다
 * @param options 깊이 · 항목 수 · 문자열 길이 한도
 * @returns 마스킹과 절단이 적용된 새 값
 * @throws RangeError 한도 옵션이 양의 정수가 아닐 때
 */
export function maskSensitiveData(
  value: unknown,
  sensitiveKeys: readonly string[],
  options: IRedactionOptions = {},
): unknown {
  return new Redactor(sensitiveKeys, resolveLimits(options)).redact(value);
}

/**
 * 마스킹 1회 실행의 상태(방문한 객체 · 누적 항목 수)를 담는 내부 방문자.
 * 호출마다 새 인스턴스를 만들어 상태가 요청 간에 공유되지 않게 한다.
 */
class Redactor {
  private readonly visited = new WeakSet<object>();
  private readonly lowered: readonly string[];
  private entries = 0;

  constructor(
    sensitiveKeys: readonly string[],
    private readonly limits: IRedactionLimits,
  ) {
    this.lowered = sensitiveKeys.map(key => key.toLowerCase());
  }

  /** 최상위 값부터 재귀 마스킹을 시작한다 */
  redact(value: unknown): unknown {
    return this.visit(value, 0);
  }

  /** 키 이름에 민감 키가 부분 일치(대소문자 무시)하는지 */
  private isSensitive(key: string): boolean {
    const loweredKey = key.toLowerCase();
    return this.lowered.some(sensitive => loweredKey.includes(sensitive));
  }

  /** 항목 수 한도를 넘었는지 세면서 확인한다 */
  private exceedsEntries(): boolean {
    this.entries += 1;
    return this.entries > this.limits.maxEntries;
  }

  /** 값 종류에 따라 leaf 변환 · 한도 검사 · 순환 검사 후 배열/객체 방문으로 분기한다 */
  private visit(current: unknown, depth: number): unknown {
    const leaf = visitLeaf(current, this.limits.maxStringLength);
    if (leaf !== undefined || current === undefined) {
      return leaf;
    }
    if (depth >= this.limits.maxDepth || this.entries >= this.limits.maxEntries) {
      return TRUNCATED;
    }
    if (typeof current !== 'object' || current === null) {
      return safeString(current);
    }
    if (this.visited.has(current)) {
      return CIRCULAR;
    }
    this.visited.add(current);
    return Array.isArray(current)
      ? this.visitArray(current, depth)
      : this.visitObject(current, depth);
  }

  /** 배열은 요소 순서대로 방문하며 한도에서 `[Truncated]` 를 넣고 멈춘다 */
  private visitArray(current: unknown[], depth: number): unknown[] {
    const output: unknown[] = [];
    for (const item of current) {
      if (this.exceedsEntries()) {
        output.push(TRUNCATED);
        break;
      }
      output.push(this.visit(item, depth + 1));
    }
    return output;
  }

  /**
   * 객체는 `for...in` 으로 자체 키만 순회한다. 키 전체를 먼저 배열로 만들지 않으므로
   * 큰 객체에서도 한도에서 바로 멈춘다. getter 가 던지면 그 키만 `[Unserializable]` 로 남긴다.
   */
  private visitObject(current: object, depth: number): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const key in current) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        continue;
      }
      if (this.exceedsEntries()) {
        defineOwn(output, TRUNCATED, true);
        break;
      }
      if (this.isSensitive(key)) {
        defineOwn(output, key, MASK);
        continue;
      }
      let inner: unknown;
      try {
        inner = (current as Record<string, unknown>)[key];
      } catch {
        defineOwn(output, key, UNSERIALIZABLE);
        continue;
      }
      defineOwn(output, key, this.visit(inner, depth + 1));
    }
    return output;
  }
}

/** `__proto__` 같은 키도 프로토타입을 건드리지 않고 자체 속성으로만 정의한다 */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** 기본 사용자 요약: 식별자 · 역할 · 익명 여부만 남긴다 */
function defaultGetUser(req: IHttpLoggerRequest): unknown {
  const user = req.user as { idx?: unknown; id?: unknown; role?: unknown; isAnon?: unknown } | undefined;
  if (!user) {
    return NO_USER;
  }
  return {
    id: user.idx ?? user.id,
    ...(user.role !== undefined ? { role: user.role } : {}),
    ...(user.isAnon !== undefined ? { isAnon: user.isAnon } : {}),
  };
}

/** Express `req.route.path` 를 라우트 패턴으로 쓴다 */
function defaultGetRoute(req: IHttpLoggerRequest): string | undefined {
  return typeof req.route?.path === 'string' ? req.route.path : undefined;
}

/** 헤더 값이 배열이면 첫 요소를, 아니면 그대로 반환한다 */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Express 스타일 `(req, res, next)` 미들웨어 시그니처 */
export type HttpLoggerMiddlewareFn = (
  req: IHttpLoggerRequest,
  res: IHttpLoggerResponse,
  next: () => void,
) => void;

/** 요청 시작 시점에 확정되는 값. 응답 완료 시 로그 레코드로 합쳐진다 */
interface IRequestSnapshot {
  method: string;
  originalUrl: string;
  urlPath: string;
  userAgent: string | undefined;
  clientIp: string | undefined;
  traceId: string | undefined;
  spanId: string | undefined;
  maskedBody: unknown;
  start: number;
}

/** 검증과 기본값 적용이 끝난 옵션 */
interface IResolvedLoggerOptions {
  sensitiveKeys: readonly string[];
  getUser: (req: IHttpLoggerRequest) => unknown;
  getTraceId: (req: IHttpLoggerRequest) => string | undefined;
  getSpanId: (req: IHttpLoggerRequest) => string | undefined;
  getRoute: (req: IHttpLoggerRequest) => string | undefined;
  logBody: boolean;
  stripQuery: boolean;
  logClientIp: boolean;
  onError: (error: unknown) => void;
}

/** 옵션 기본값을 채우고 크기 제한을 미리 검증해 잘못된 설정이 시작 시점에 드러나게 한다 */
function resolveLoggerOptions(options: IHttpLoggerOptions): IResolvedLoggerOptions {
  resolveLimits(options);
  return {
    sensitiveKeys: [...DEFAULT_SENSITIVE_KEYS, ...(options.extraSensitiveKeys ?? [])],
    getUser: options.getUser ?? defaultGetUser,
    getTraceId: options.getTraceId ?? (() => getActiveTraceId()),
    getSpanId: options.getSpanId ?? (() => getActiveSpanId()),
    getRoute: options.getRoute ?? defaultGetRoute,
    logBody: options.logBody === true,
    stripQuery: options.stripQuery !== false,
    logClientIp: options.logClientIp === true,
    onError: options.onError ?? (error => diag.error('HTTP log middleware failed', error)),
  };
}

/** 응답이 끝난 뒤 바뀔 수 있는 값(body · trace 컨텍스트)을 요청 시작 시점에 고정한다 */
function snapshotRequest(
  req: IHttpLoggerRequest,
  options: IHttpLoggerOptions,
  resolved: IResolvedLoggerOptions,
): IRequestSnapshot {
  const rawUrl = req.originalUrl ?? req.url;
  const urlPath = rawUrl.split('?')[0];
  const snapshot: IRequestSnapshot = {
    method: req.method,
    originalUrl: resolved.stripQuery ? urlPath : rawUrl,
    urlPath,
    userAgent: firstHeader(req.headers['user-agent']),
    clientIp: resolved.logClientIp ? req.realIp ?? getClientIp(req) : undefined,
    traceId: undefined,
    spanId: undefined,
    maskedBody: undefined,
    start: performance.now(),
  };
  try {
    return {
      ...snapshot,
      maskedBody: resolved.logBody
        ? maskSensitiveData(req.body, resolved.sensitiveKeys, options)
        : undefined,
      traceId: resolved.getTraceId(req),
      spanId: resolved.getSpanId(req),
    };
  } catch (error) {
    resolved.onError(error);
    return snapshot;
  }
}

/** 완료 로그 레코드를 만든다. OTel 시맨틱 컨벤션 키와 기존 필드 이름을 함께 남긴다 */
function buildLogRecord(
  req: IHttpLoggerRequest,
  res: IHttpLoggerResponse,
  snapshot: IRequestSnapshot,
  resolved: IResolvedLoggerOptions,
  aborted: boolean,
): Record<string, unknown> {
  const statusCode = res.statusCode;
  const route = resolved.getRoute(req);
  return {
    message: 'HTTP',
    'event.name': 'http.request',
    ...(snapshot.traceId ? { trace_id: snapshot.traceId } : {}),
    ...(snapshot.spanId ? { span_id: snapshot.spanId } : {}),
    method: snapshot.method,
    'http.request.method': snapshot.method,
    originalUrl: snapshot.originalUrl,
    'url.path': snapshot.urlPath,
    ...(route ? { 'http.route': route } : {}),
    statusCode,
    'http.response.status_code': statusCode,
    ...(aborted ? { 'error.type': 'CLIENT_ABORTED', outcome: 'aborted' } : {}),
    user: resolved.getUser(req),
    ...(resolved.logBody ? { body: snapshot.maskedBody } : {}),
    ...(snapshot.clientIp ? { ip: snapshot.clientIp, 'client.address': snapshot.clientIp } : {}),
    userAgent: snapshot.userAgent,
    'user_agent.original': snapshot.userAgent,
    durationMs: Math.max(0, performance.now() - snapshot.start),
  };
}

/**
 * 응답 완료 시 구조화 로그 한 줄을 남기는 미들웨어를 만든다.
 *
 * - 상태 코드별 레벨: 5xx 또는 클라이언트 중단 → `error`, 4xx → `warn`, 그 외 → `log`
 * - `finish` 와 `close` 중 먼저 온 이벤트 한 번만 기록한다. `close` 만 온 경우는 클라이언트 중단으로 본다
 * - 로그는 요청 시점의 OTel 컨텍스트 안에서 기록되어 winston OTLP transport 가 trace 와 연결할 수 있다
 * - 로깅 중 예외는 `onError` 로 보고하고 요청 처리에는 영향을 주지 않는다
 *
 * @param options 로거와 수집 범위 옵션
 * @returns Express/Nest 에 그대로 등록할 수 있는 미들웨어 함수
 * @throws RangeError 크기 제한 옵션이 양의 정수가 아닐 때 (미들웨어 생성 시점에 검증)
 *
 * @example
 * app.use(createHttpLoggerMiddleware({ logger: new Logger('HTTP'), logBody: false }));
 */
export function createHttpLoggerMiddleware(options: IHttpLoggerOptions): HttpLoggerMiddlewareFn {
  const resolved = resolveLoggerOptions(options);

  return (req, res, next) => {
    const requestContext = context.active();
    const snapshot = snapshotRequest(req, options, resolved);

    let recorded = false;
    const write = (aborted: boolean): void => {
      if (recorded) {
        return;
      }
      recorded = true;
      try {
        const logData = buildLogRecord(req, res, snapshot, resolved, aborted);
        context.with(requestContext, () => {
          if (aborted || res.statusCode >= 500) {
            options.logger.error(logData, 'HTTP');
          } else if (res.statusCode >= 400) {
            options.logger.warn(logData, 'HTTP');
          } else {
            options.logger.log(logData, 'HTTP');
          }
        });
      } catch (error) {
        resolved.onError(error);
      }
    };

    res.on('finish', () => write(false));
    res.on('close', () => write(true));
    next();
  };
}
