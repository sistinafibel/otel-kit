/**
 * 환경변수 기반 preload 진입점.
 *
 * 애플리케이션 모듈보다 먼저 `node --require @sistinafibel/otel-kit/register` 로 로드한다.
 * 옵션 없이 `initObservability()` 를 호출하므로 서비스 이름 · endpoint · sampler 는 모두
 * OTEL_* 환경변수로 지정한다. 프로그램에서 옵션을 넘겨야 한다면 이 진입점 대신
 * `initObservability` 를 직접 호출한다 (둘 중 하나만 쓴다).
 */
import { initObservability } from './init-observability';

/** preload 시 생성된 관측성 핸들. 종료 흐름에서 `shutdown()` 을 await 할 때 import 한다 */
export const observability = initObservability();
