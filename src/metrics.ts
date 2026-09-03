/**
 * 메트릭 편의 함수.
 * `initObservability` 가 전역 MeterProvider 를 등록하면 실제 메트릭이 export 되고,
 * 등록 전(또는 엔드포인트 미설정)이면 no-op Meter 가 반환되어 호출부 코드는 그대로 동작한다.
 */
import { Meter, metrics } from '@opentelemetry/api';

/**
 * 이름으로 Meter 를 얻는다. Counter·Histogram·ObservableGauge 생성에 사용한다.
 *
 * @param name 계측 스코프 이름. 보통 모듈/컴포넌트 이름 (예: `'rabbitmq'`)
 * @param version 스코프 버전 (선택)
 * @returns OpenTelemetry Meter
 *
 * @example
 * const meter = getMeter('collector');
 * meter.createObservableGauge('collector.active', { description: '활성 수집기 수' })
 *   .addCallback(result => result.observe(manager.getActiveCollectorCount()));
 */
export function getMeter(name: string, version?: string): Meter {
  return metrics.getMeter(name, version);
}
