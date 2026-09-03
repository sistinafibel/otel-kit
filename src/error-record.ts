/**
 * Error 를 OpenTelemetry 시맨틱 컨벤션 필드로 평탄화한다.
 *
 * 결과 객체를 winston 메타 또는 NestJS Logger 의 두 번째 인자로 그대로 넘기면
 * 백엔드(SigNoz·Grafana 등)가 예외 필드를 표준 이름으로 인식한다.
 *
 * 필드 규약:
 * - `exception.type`       Error 클래스명 (예: `TypeError`, `PrismaClientKnownRequestError`)
 * - `exception.message`    에러 메시지
 * - `exception.stacktrace` 스택 트레이스 (있을 때만)
 * - `exception.cause`      `error.cause` 가 있으면 그 요약 (있을 때만)
 * - `error.type`           저카디널리티 분류 키. `meta.errorCode` 가 있으면 그 값, 없으면 Error 클래스명.
 *                          알림 규칙·대시보드 group by 의 1차 키로 쓴다
 * - 나머지 `meta` 필드는 그대로 통과한다 (`channelId`, `correlationId` 등)
 */

/** 평탄화 시 함께 넘길 메타. `errorCode` 는 `error.type` 으로 옮겨진다 */
export interface IErrorLogMeta {
  /** 프로젝트 정의 에러 코드 (SCREAMING_SNAKE 권장, 예: `MQ_CONNECTION_FAILED`) */
  errorCode?: string;
  [key: string]: unknown;
}

/** 평탄화 결과. OTel 시맨틱 컨벤션 예외 필드 + 통과된 메타 */
export interface IErrorLogRecord {
  'exception.type': string;
  'exception.message': string;
  'exception.stacktrace'?: string;
  'exception.cause'?: string;
  'error.type': string;
  [key: string]: unknown;
}

/** Error 가 아닌 값의 분류 키 */
const NON_ERROR_TYPE = 'NonError';

const MAX_EXCEPTION_MESSAGE_LENGTH = 8_192;
const MAX_EXCEPTION_STACK_LENGTH = 32_768;
const MAX_SERIALIZED_NODES = 100;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}[Truncated]` : value;
}

function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[Unserializable]';
  }
}

/** 순환 참조·BigInt·getter 예외가 있어도 예외를 던지지 않는 제한된 문자열화 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value, MAX_EXCEPTION_MESSAGE_LENGTH);
  }
  const seen = new WeakSet<object>();
  let nodes = 0;
  try {
    const serialized = JSON.stringify(value, (_key, inner) => {
      if (typeof inner === 'bigint') {
        return inner.toString();
      }
      if (typeof inner === 'object' && inner !== null) {
        if (seen.has(inner)) {
          return '[Circular]';
        }
        seen.add(inner);
        nodes += 1;
        if (nodes > MAX_SERIALIZED_NODES) {
          return '[Truncated]';
        }
      }
      return inner;
    });
    return truncate(serialized ?? safeToString(value), MAX_EXCEPTION_MESSAGE_LENGTH);
  } catch {
    return truncate(safeToString(value), MAX_EXCEPTION_MESSAGE_LENGTH);
  }
}

/** `error.cause` 를 한 줄 요약으로 만든다 (중첩 cause 는 첫 단계만) */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return truncate(`${safeToString(cause.name)}: ${safeToString(cause.message)}`, MAX_EXCEPTION_MESSAGE_LENGTH);
  }
  return safeStringify(cause);
}

/**
 * Error(또는 임의의 throw 된 값)를 로그 속성 객체로 변환한다.
 *
 * @param error catch 한 값. Error 인스턴스가 아니어도 된다
 * @param meta 함께 기록할 컨텍스트. `errorCode` 는 `error.type` 으로 매핑된다
 * @returns 시맨틱 컨벤션 필드가 채워진 평면 객체 (새 객체, 입력은 변경하지 않음)
 *
 * @example
 * logger.error('RabbitMQ 연결 실패', toErrorLogRecord(err, { errorCode: 'MQ_CONNECTION_FAILED', attempt }));
 */
export function toErrorLogRecord(error: unknown, meta: IErrorLogMeta = {}): IErrorLogRecord {
  const { errorCode, ...rest } = meta;
  const normalizedErrorCode =
    typeof errorCode === 'string' && errorCode.trim() ? errorCode.trim() : undefined;

  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    // name 이 문자열이 아니거나 비어 있어도 항상 유효한 분류 키가 되도록 정규화한다
    const exceptionType = safeToString(error.name) || 'Error';
    return {
      ...rest,
      'exception.type': exceptionType,
      'exception.message': truncate(safeToString(error.message), MAX_EXCEPTION_MESSAGE_LENGTH),
      ...(error.stack
        ? { 'exception.stacktrace': truncate(safeToString(error.stack), MAX_EXCEPTION_STACK_LENGTH) }
        : {}),
      ...(cause !== undefined ? { 'exception.cause': describeCause(cause) } : {}),
      'error.type': normalizedErrorCode ?? exceptionType,
    };
  }

  return {
    ...rest,
    'exception.type': NON_ERROR_TYPE,
    'exception.message': safeStringify(error),
    'error.type': normalizedErrorCode ?? NON_ERROR_TYPE,
  };
}
