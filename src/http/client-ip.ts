/**
 * 클라이언트 실제 IP 추출 — 프레임워크 무관 (Express · Fastify(raw) · NestJS 공통).
 *
 * 우선순위: 명시적으로 신뢰한 `X-Forwarded-For` → `X-Real-IP` → 소켓 주소 → `req.ip`.
 *
 * X-Forwarded-For 는 경유한 프록시가 뒤에 값을 덧붙이므로, 클라이언트가 위조한 값은 앞쪽에 남는다.
 * 따라서 "신뢰하는 프록시 개수(`trustedProxyCount`)" 만큼 뒤에서 세어 그 위치의 값을 취한다.
 *   - 프록시 1대(nginx 등): `"spoofed, real"` → 뒤에서 1번째 = `real`
 *   - CDN + nginx 2대: `"spoofed, real, cdnIp"` → 뒤에서 2번째 = `real`
 */
import { trace } from '@opentelemetry/api';
import { isIP } from 'node:net';

/** IP 추출에 필요한 최소 요청 형태. Express/Nest `Request` 가 구조적으로 만족한다 */
export interface IClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}

/** `createRealIpMiddleware` 가 결과를 기록하는 요청 형태 */
export interface IRealIpRequest extends IClientIpRequest {
  /** 추출된 클라이언트 IP. 미들웨어 통과 후 채워진다 */
  realIp?: string;
}

/**
 * IP 추출 옵션.
 * @property trustedProxyCount 앱 앞단에서 신뢰하는 프록시 홉 수. 기본 0이며, 0이면 전달 헤더를 신뢰하지 않는다
 * @property recordSpanAttributes 추출된 IP와 User-Agent를 활성 span에 기록할지 여부 (기본 false)
 */
export interface IRealIpOptions {
  trustedProxyCount?: number;
  recordSpanAttributes?: boolean;
}

/** 기본값은 전달 헤더를 신뢰하지 않는다. */
const DEFAULT_TRUSTED_PROXY_COUNT = 0;

/** IPv4-mapped IPv6(`::ffff:1.2.3.4`)를 IPv4 로 정규화한다 */
export function extractIPv4(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.substring(7) : trimmed;
}

/** 포트/괄호를 제거하고 유효한 IP 주소만 반환한다. */
function normalizeIp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let candidate = value.trim();
  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) {
    candidate = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'));
  }
  candidate = extractIPv4(candidate);
  return isIP(candidate) > 0 ? candidate : undefined;
}

function resolveTrustedProxyCount(value: number | undefined): number {
  const trusted = value ?? DEFAULT_TRUSTED_PROXY_COUNT;
  if (!Number.isSafeInteger(trusted) || trusted < 0) {
    throw new RangeError('trustedProxyCount must be a non-negative safe integer');
  }
  return trusted;
}

/** 헤더 값이 배열이면 첫 요소를, 아니면 그대로 반환한다 */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 요청 헤더/소켓에서 클라이언트 실제 IP 를 추출한다.
 *
 * @param req 헤더·소켓을 가진 요청 객체
 * @param options `trustedProxyCount` (기본 0: 전달 헤더를 신뢰하지 않음)
 * @returns 정규화된 IP 문자열. 어디에서도 얻지 못하면 undefined
 */
export function getClientIp(req: IClientIpRequest, options: IRealIpOptions = {}): string | undefined {
  const trusted = resolveTrustedProxyCount(options.trustedProxyCount);

  const forwardedFor = trusted > 0 ? firstHeader(req.headers['x-forwarded-for']) : undefined;
  if (forwardedFor) {
    const list = forwardedFor
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (list.length >= trusted) {
      const candidate = normalizeIp(list[list.length - trusted]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const realIp = trusted > 0 ? normalizeIp(firstHeader(req.headers['x-real-ip'])) : undefined;
  if (realIp) {
    return realIp;
  }

  const socketIp = normalizeIp(req.socket?.remoteAddress);
  if (socketIp) {
    return socketIp;
  }

  // Express의 req.ip는 앱 전체 trust proxy 설정의 영향을 받을 수 있어 마지막 fallback으로만 쓴다.
  return normalizeIp(req.ip);
}

/** Express 스타일 `(req, res, next)` 미들웨어 시그니처 */
export type RealIpMiddlewareFn = (req: IRealIpRequest, res: unknown, next: () => void) => void;

/**
 * 클라이언트 IP 를 `req.realIp` 에 저장하고, 활성 HTTP 서버 스팬에
 * `client.address` / `user_agent.original` 속성을 기록하는 미들웨어를 만든다.
 *
 * @param options `trustedProxyCount` (기본 0: 전달 헤더를 신뢰하지 않음)
 * @returns Express/Nest 에 그대로 등록할 수 있는 미들웨어 함수
 *
 * @example
 * app.use(createRealIpMiddleware({ trustedProxyCount: 2 })); // CDN + nginx
 */
export function createRealIpMiddleware(options: IRealIpOptions = {}): RealIpMiddlewareFn {
  return (req, _res, next) => {
    const realIp = getClientIp(req, options);
    req.realIp = realIp;

    const span = options.recordSpanAttributes ? trace.getActiveSpan() : undefined;
    if (span) {
      if (realIp) {
        span.setAttribute('client.address', realIp);
      }
      const userAgent = firstHeader(req.headers['user-agent']);
      if (userAgent) {
        span.setAttribute('user_agent.original', userAgent);
      }
    }

    next();
  };
}
