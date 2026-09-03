/**
 * 활성 span 에 오류를 표준 방식으로 기록하는 헬퍼.
 *
 * `toErrorLogRecord` 가 만드는 로그 필드와 같은 규약(`exception.*`, `error.type`)을 span 에도 적용해
 * 로그와 트레이스에서 같은 키로 오류를 찾을 수 있게 한다.
 */
import { Attributes, Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { IErrorLogMeta, IErrorLogRecord, toErrorLogRecord } from './error-record';

/**
 * `recordErrorOnSpan` 옵션.
 *
 * @property errorType `error.type` 속성으로 기록할 저카디널리티 분류 코드. 없으면 Error 클래스명을 쓴다
 * @property attributes 함께 기록할 추가 span 속성
 * @property includeStatusDescription span **status description** 에 exception message 를 넣을지 여부 (기본 false).
 *   주의: 이 옵션과 무관하게 `span.recordException` 은 항상 message 와 stack 을 exception 이벤트로 기록한다.
 *   오류 메시지에 비밀값이 섞일 수 있다면 throw 하기 전에 메시지를 정제해야 한다
 * @property span 기록 대상 span. 생략하면 현재 활성 span 을 쓴다
 */
export interface IRecordErrorOnSpanOptions {
  errorType?: string;
  attributes?: Attributes;
  includeStatusDescription?: boolean;
  span?: Span;
}

/**
 * 오류를 지정 span 또는 활성 span 에 기록한다.
 *
 * 기록 내용: exception 이벤트(name · message · stack), `error.type` 속성, 추가 속성, ERROR 상태.
 * Error 가 아닌 값(문자열 · 객체 등)은 `toErrorLogRecord` 로 정규화한 뒤 기록한다.
 *
 * @param error catch 한 값. Error 인스턴스가 아니어도 된다
 * @param options 분류 코드 · 추가 속성 · 대상 span
 * @returns 기록할 span 이 있어 실제로 기록했으면 true, 활성 span 이 없으면 false
 */
export function recordErrorOnSpan(
  error: unknown,
  options: IRecordErrorOnSpanOptions = {},
): boolean {
  const span = options.span ?? trace.getActiveSpan();
  if (!span) {
    return false;
  }

  const record = toErrorLogRecord(error, { errorCode: options.errorType });
  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException({
      name: record['exception.type'],
      message: record['exception.message'],
      stack: record['exception.stacktrace'],
    });
  }
  span.setAttribute('error.type', record['error.type']);
  if (options.attributes) {
    span.setAttributes(options.attributes);
  }
  span.setStatus({
    code: SpanStatusCode.ERROR,
    ...(options.includeStatusDescription
      ? { message: record['exception.message'] }
      : {}),
  });
  return true;
}

/**
 * span 기록과 구조화 로그 레코드 생성을 한 번에 수행한다.
 *
 * `meta.errorCode` 가 로그의 `error.type` 과 span 의 `error.type` 에 같은 값으로 들어가므로
 * 알림 규칙과 대시보드에서 하나의 키로 묶인다. 활성 span 이 없어도 로그 레코드는 정상 반환한다.
 *
 * @param error catch 한 값
 * @param meta 로그에 함께 남길 컨텍스트. `errorCode` 는 `error.type` 으로 매핑된다
 * @param spanOptions span 기록 옵션 (`errorType` 은 `meta.errorCode` 에서 결정되므로 제외)
 * @returns winston · Nest Logger 의 메타 인자로 그대로 넘길 수 있는 평면 객체
 *
 * @example
 * logger.error('CHZZK 채널 조회 실패', captureError(error, { errorCode: 'CHZZK_CHANNEL_FETCH_FAILED', channelId }));
 */
export function captureError(
  error: unknown,
  meta: IErrorLogMeta = {},
  spanOptions: Omit<IRecordErrorOnSpanOptions, 'errorType'> = {},
): IErrorLogRecord {
  const record = toErrorLogRecord(error, meta);
  recordErrorOnSpan(error, { ...spanOptions, errorType: record['error.type'] });
  return record;
}
