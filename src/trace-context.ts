/**
 * 활성 스팬 컨텍스트 조회 헬퍼.
 * 소비 프로젝트가 `@opentelemetry/api` 를 직접 의존하지 않고 로그에 traceId 를 넣을 수 있게 한다.
 */
import { isSpanContextValid, trace } from '@opentelemetry/api';

/**
 * 현재 비동기 컨텍스트의 활성 스팬 traceId 를 반환한다.
 * @returns 32자리 hex traceId. 활성 스팬이 없거나 계측이 꺼져 있으면 undefined
 */
export function getActiveTraceId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.traceId : undefined;
}

/**
 * 현재 비동기 컨텍스트의 활성 스팬 spanId 를 반환한다.
 * @returns 16자리 hex spanId. 활성 스팬이 없으면 undefined
 */
export function getActiveSpanId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.spanId : undefined;
}
