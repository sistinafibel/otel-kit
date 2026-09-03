/**
 * winston 로그를 OTLP 로 보내는 transport 헬퍼.
 *
 * transport 는 winston `message` 를 본문으로, `level` 을 severity 로, 나머지 메타 필드를 속성으로 매핑하며
 * 활성 스팬이 있으면 `trace_id`/`span_id` 를 자동 부착한다. 마스킹은 하지 않으므로 호출자 책임이다.
 */
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';
import { getObservability, isOtelExportEnabled } from '../init-observability';

/**
 * 로그 signal 이 실제로 켜져 있는지 판단한다.
 *
 * `initObservability` 가 이미 호출됐다면 옵션(`enableLogs: false` 등)이 반영된 핸들의 상태를 쓰고,
 * 아직 호출 전이면 환경변수만으로 판단한다. 둘을 나누지 않으면 endpoint 는 있지만 `enableLogs: false`
 * 인 경우 transport 가 만들어져 로그가 조용히 버려진다.
 */
function isLogsSignalActive(): boolean {
  const handle = getObservability();
  return handle ? handle.signals.logs : isOtelExportEnabled('logs');
}

/**
 * OTLP export 활성 시 지정 레벨 이상을 전송하는 transport 를 반환한다.
 * `initObservability` 이후에 호출해야 옵션이 반영된 정확한 판단을 한다.
 *
 * @param level 전송 최소 레벨 (기본 `'info'`)
 * @returns transport 인스턴스. 로그 signal 이 꺼져 있으면 null (호출자가 배열에서 걸러낸다)
 *
 * @example
 * const transports = [new winston.transports.Console()];
 * const otel = createOtelLogTransport('info');
 * if (otel) transports.push(otel);
 */
export function createOtelLogTransport(level: string = 'info'): OpenTelemetryTransportV3 | null {
  if (!isLogsSignalActive()) {
    return null;
  }
  return new OpenTelemetryTransportV3({ level });
}
