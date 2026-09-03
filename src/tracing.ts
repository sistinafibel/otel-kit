/**
 * HTTP 요청 밖의 폴링 · 큐 소비 · 배치 작업을 활성 span 으로 감싸는 헬퍼.
 *
 * HttpInstrumentation 은 들어오는 HTTP 요청에만 span 을 만들기 때문에, 스케줄러나
 * 메시지 consumer 처럼 요청이 없는 작업은 `runWithSpan` 으로 직접 경계를 만들어야
 * 트레이스에 나타나고 오류가 span 에 기록된다.
 */
import { Attributes, Span, SpanKind, trace } from '@opentelemetry/api';
import { recordErrorOnSpan } from './error-telemetry';

/**
 * `runWithSpan` 옵션.
 *
 * @property scope tracer 의 instrumentation scope 이름. 기본값은 이 패키지 이름
 * @property scopeVersion instrumentation scope 버전 (선택)
 * @property kind span 종류. 폴링·배치는 INTERNAL(기본), 큐 consumer 는 CONSUMER, 외부 전송은 PRODUCER 를 권장
 * @property attributes span 시작 시 부착할 속성. 저카디널리티 값 위주로 넣는다
 * @property errorType 오류 발생 시 `error.type` 속성으로 기록할 저카디널리티 코드. 함수를 주면 오류별로 분류할 수 있다
 */
export interface IRunWithSpanOptions {
  scope?: string;
  scopeVersion?: string;
  kind?: SpanKind;
  attributes?: Attributes;
  errorType?: string | ((error: unknown) => string | undefined);
}

/**
 * 작업을 새 활성 span 안에서 실행한다.
 *
 * - 작업이 던진 오류는 `recordErrorOnSpan` 으로 span 에 exception 과 ERROR 상태를 기록한 뒤
 *   **원래 값 그대로** 다시 throw 된다. 호출자의 오류 처리 흐름은 바뀌지 않는다.
 * - 동기 throw 와 비동기 reject 를 모두 같은 방식으로 처리한다.
 * - 성공 · 실패와 관계없이 span 은 항상 종료된다.
 *
 * @typeParam T 작업의 반환 타입
 * @param name span 이름. `chzzk.channel.poll` 처럼 `<도메인>.<대상>.<동작>` 형식을 권장한다
 * @param operation 실행할 작업. 인자로 받은 span 에 속성이나 이벤트를 추가할 수 있다
 * @param options span 종류 · 속성 · 오류 분류 코드
 * @returns 작업의 반환값
 * @throws 작업이 던진 오류를 그대로 다시 던진다
 *
 * @example
 * await runWithSpan('chzzk.channel.poll', () => tracker.poll(channelId), {
 *   kind: SpanKind.INTERNAL,
 *   attributes: { 'chzzk.channel.id': channelId },
 *   errorType: 'CHZZK_CHANNEL_POLL_FAILED',
 * });
 */
export async function runWithSpan<T>(
  name: string,
  operation: (span: Span) => T | Promise<T>,
  options: IRunWithSpanOptions = {},
): Promise<T> {
  const tracer = trace.getTracer(options.scope ?? '@cloudjun/otel-kit', options.scopeVersion);
  return tracer.startActiveSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
    },
    async span => {
      try {
        return await operation(span);
      } catch (error) {
        const errorType =
          typeof options.errorType === 'function' ? options.errorType(error) : options.errorType;
        recordErrorOnSpan(error, { span, errorType });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
