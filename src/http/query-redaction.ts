/**
 * HTTP span 에 실리는 URL 의 query string 값을 가리는 헬퍼.
 *
 * HttpInstrumentation 은 나가는 요청의 `url.full` 과 들어오는 요청의 `url.query` 에 query string 을 그대로 싣고,
 * 기본으로 가리는 키는 서명 관련 네 개뿐이다. 그래서 OAuth 토큰 요청의 `client_secret` 이나 조회 API 의 계좌번호처럼
 * query 로 보내는 값이 트레이스 저장소로 새어 나간다.
 *
 * 방향마다 기본값이 다르다.
 * - 나가는 요청(`outgoing`): `all` — 값을 전부 가린다. 외부 API 에 넘기는 값은 디버깅에 거의 쓰이지 않고,
 *   이름을 미리 알 수 없는 비밀(서비스마다 다른 키 이름)이 섞여 있다.
 * - 들어오는 요청(`incoming`): `sensitive` — 민감한 이름의 값만 가린다. 검색어나 페이지 번호처럼
 *   "사용자가 무엇을 했는지" 를 알려 주는 값은 남긴다.
 *
 * 어느 쪽이든 키 이름은 남긴다 (`?code=REDACTED&page=2`). 어떤 파라미터가 오갔는지는 알 수 있다.
 */
import { Span, SpanKind } from '@opentelemetry/api';
import { DEFAULT_SENSITIVE_KEYS } from './http-logger.middleware';

/** 가린 값 자리에 넣는 글자. HttpInstrumentation 의 표기와 맞춘다 */
export const REDACTED_QUERY_VALUE = 'REDACTED';

/**
 * query 값을 가리는 방식.
 * - `all`: 모든 값을 가린다
 * - `sensitive`: 키 이름에 민감 키가 포함된(대소문자 무시) 값만 가린다
 * - `none`: 가리지 않는다
 */
export type QueryRedactionMode = 'all' | 'sensitive' | 'none';

/**
 * `initObservability` 의 `httpQueryRedaction` 옵션.
 *
 * @property outgoing 나가는 요청(`url.full`)의 방식. 기본 `all`
 * @property incoming 들어오는 요청(`url.query`)의 방식. 기본 `sensitive`
 * @property extraSensitiveKeys `DEFAULT_QUERY_SENSITIVE_KEYS` 에 더할 키 (부분 일치 · 대소문자 무시)
 * @property allowedKeys 방식과 무관하게 값을 그대로 둘 키 (정확히 일치 · 대소문자 무시). `all` 에서 `page` 같은 값을 살릴 때 쓴다
 */
export interface IHttpQueryRedactionOptions {
  outgoing?: QueryRedactionMode;
  incoming?: QueryRedactionMode;
  extraSensitiveKeys?: string[];
  allowedKeys?: string[];
}

/**
 * query 에서 민감하다고 보는 키 목록. 본문 마스킹용 `DEFAULT_SENSITIVE_KEYS` 에 query 로 자주 오가는 것을 더했다:
 * OAuth 의 `code` · `state`, 서명(`signature`), 일회용 번호(`otp`), 계좌(`account` · `bank`).
 */
export const DEFAULT_QUERY_SENSITIVE_KEYS: readonly string[] = [
  ...DEFAULT_SENSITIVE_KEYS,
  'code',
  'state',
  'signature',
  'otp',
  'account',
  'bank',
];

/** 방식 · 키 목록을 미리 풀어 둔 설정 */
interface IResolvedQueryRedaction {
  outgoing: QueryRedactionMode;
  incoming: QueryRedactionMode;
  sensitive: string[];
  allowed: Set<string>;
}

const MODES: readonly QueryRedactionMode[] = ['all', 'sensitive', 'none'];

/**
 * 옵션을 검증하고 기본값을 채운다.
 * @throws TypeError 알 수 없는 방식 이름일 때 (조용히 가리지 않는 것보다 시작 시 실패하는 편이 안전하다)
 */
export function resolveQueryRedaction(options: IHttpQueryRedactionOptions = {}): IResolvedQueryRedaction {
  const outgoing = options.outgoing ?? 'all';
  const incoming = options.incoming ?? 'sensitive';
  for (const [name, mode] of [['outgoing', outgoing], ['incoming', incoming]] as const) {
    if (!MODES.includes(mode)) {
      throw new TypeError(`httpQueryRedaction.${name} must be one of ${MODES.join(', ')}`);
    }
  }
  return {
    outgoing,
    incoming,
    sensitive: [...DEFAULT_QUERY_SENSITIVE_KEYS, ...(options.extraSensitiveKeys ?? [])].map(key => key.toLowerCase()),
    allowed: new Set((options.allowedKeys ?? []).map(key => key.toLowerCase())),
  };
}

/** percent-encoding 된 키를 비교용으로 풀고 소문자로 만든다. 풀 수 없으면 원문을 쓴다 */
function normalizeKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' ')).toLowerCase();
  } catch {
    return rawKey.toLowerCase();
  }
}

/**
 * query string(앞의 `?` 제외)의 값을 방식에 맞게 가린다.
 *
 * `URLSearchParams` 로 다시 조립하지 않고 `&` 로 잘라 값만 바꾼다. 키 순서 · 중복 키 · 원래 인코딩이 그대로 남는다.
 * 값이 없는 항목(`?flag`)과 빈 값(`?a=`)은 건드리지 않는다.
 *
 * @param query 앞의 `?` 를 뗀 query string
 * @param mode 가리는 방식
 * @param config `resolveQueryRedaction` 결과. 생략하면 기본 민감 키를 쓴다
 * @returns 값을 가린 query string
 */
export function redactQueryString(
  query: string,
  mode: QueryRedactionMode,
  config: Pick<IResolvedQueryRedaction, 'sensitive' | 'allowed'> = resolveQueryRedaction(),
): string {
  if (mode === 'none' || query === '') {
    return query;
  }
  return query
    .split('&')
    .map(pair => {
      const separator = pair.indexOf('=');
      if (separator === -1 || separator === pair.length - 1) {
        return pair;
      }
      const rawKey = pair.slice(0, separator);
      const key = normalizeKey(rawKey);
      if (config.allowed.has(key)) {
        return pair;
      }
      const hide = mode === 'all' || config.sensitive.some(sensitive => key.includes(sensitive));
      return hide ? `${rawKey}=${REDACTED_QUERY_VALUE}` : pair;
    })
    .join('&');
}

/**
 * URL 이나 경로(`/path?a=1#frag`)에서 query 값만 가린다. query 가 없으면 그대로 돌려준다.
 * 앱이 직접 남기는 접근 로그의 URL 에도 같은 규칙을 적용할 수 있게 공개한다.
 *
 * @param url 전체 URL 또는 경로
 * @param mode 가리는 방식. 기본 `sensitive`
 * @param options 추가 민감 키 · 허용 키
 * @returns query 값을 가린 URL
 */
export function redactUrlQuery(
  url: string,
  mode: QueryRedactionMode = 'sensitive',
  options: Pick<IHttpQueryRedactionOptions, 'extraSensitiveKeys' | 'allowedKeys'> = {},
): string {
  return redactUrlWith(url, mode, resolveQueryRedaction(options));
}

function redactUrlWith(url: string, mode: QueryRedactionMode, config: IResolvedQueryRedaction): string {
  const queryStart = url.indexOf('?');
  if (mode === 'none' || queryStart === -1) {
    return url;
  }
  const fragmentStart = url.indexOf('#', queryStart);
  const end = fragmentStart === -1 ? url.length : fragmentStart;
  return url.slice(0, queryStart + 1) + redactQueryString(url.slice(queryStart + 1, end), mode, config) + url.slice(end);
}

/** URL 전체가 실리는 span 속성 (새 이름 · 옛 이름) */
const URL_ATTRIBUTES = ['url.full', 'http.url', 'http.target'];
/** query string 만 실리는 span 속성 */
const QUERY_ATTRIBUTES = ['url.query'];

/** SDK span 이 가진 읽기용 필드. API 의 `Span` 타입에는 없어 구조만 확인하고 쓴다 */
interface IReadableSpanLike {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
}

/**
 * HttpInstrumentation 의 `requestHook` 으로 쓸 함수를 만든다.
 *
 * span 이 만들어진 직후에 불려, 이미 실린 URL 속성을 가린 값으로 덮어쓴다. span 이 끝나 내보내지기 전이므로
 * 가리지 않은 값은 프로세스 밖으로 나가지 않는다.
 *
 * @param options 방식 · 키 설정
 * @returns `requestHook` 함수. 두 방향 모두 `none` 이면 undefined (훅을 걸 필요가 없다)
 * @throws TypeError 알 수 없는 방식 이름일 때
 */
export function createHttpQueryRedactionHook(
  options: IHttpQueryRedactionOptions = {},
): ((span: Span) => void) | undefined {
  const config = resolveQueryRedaction(options);
  if (config.outgoing === 'none' && config.incoming === 'none') {
    return undefined;
  }
  return (span: Span): void => {
    const readable = span as unknown as IReadableSpanLike;
    const attributes = readable.attributes;
    if (!attributes) {
      return;
    }
    const mode = readable.kind === SpanKind.CLIENT ? config.outgoing : config.incoming;
    if (mode === 'none') {
      return;
    }
    for (const name of URL_ATTRIBUTES) {
      const value = attributes[name];
      if (typeof value === 'string' && value.includes('?')) {
        span.setAttribute(name, redactUrlWith(value, mode, config));
      }
    }
    for (const name of QUERY_ATTRIBUTES) {
      const value = attributes[name];
      if (typeof value === 'string' && value !== '') {
        span.setAttribute(name, redactQueryString(value, mode, config));
      }
    }
  };
}
