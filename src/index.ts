/**
 * @sistinafibel/otel-kit — 프레임워크 무관 진입점.
 * NestJS 전용 미들웨어는 `@sistinafibel/otel-kit/nest` 에서 import 한다.
 */
export {
  initObservability,
  getObservability,
  isOtelExportEnabled,
  IInitObservabilityOptions,
  IObservabilityHandle,
  IObservabilitySignals,
  OtelSignal,
  ResourceAttributeValue,
} from './init-observability';
export { getActiveTraceId, getActiveSpanId } from './trace-context';
export { getMeter } from './metrics';
export { toErrorLogRecord, IErrorLogMeta, IErrorLogRecord } from './error-record';
export {
  captureError,
  recordErrorOnSpan,
  IRecordErrorOnSpanOptions,
} from './error-telemetry';
export { runWithSpan, IRunWithSpanOptions } from './tracing';
export { createOtelLogTransport } from './winston/otel-log-transport';
export {
  extractIPv4,
  getClientIp,
  createRealIpMiddleware,
  IClientIpRequest,
  IRealIpRequest,
  IRealIpOptions,
  RealIpMiddlewareFn,
} from './http/client-ip';
export {
  createHttpLoggerMiddleware,
  maskSensitiveData,
  DEFAULT_SENSITIVE_KEYS,
  IHttpLoggerOptions,
  IHttpLogWriter,
  IHttpLoggerRequest,
  IHttpLoggerResponse,
  HttpLoggerMiddlewareFn,
} from './http/http-logger.middleware';

// 소비 프로젝트가 @opentelemetry/api 를 직접 설치하지 않아도 타입을 쓸 수 있도록 재export
export { SpanKind, SpanStatusCode } from '@opentelemetry/api';
export type { Meter, Attributes, Span, ObservableResult } from '@opentelemetry/api';
