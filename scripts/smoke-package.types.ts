/**
 * smoke-package.sh 가 임시 프로젝트 안에서 타입 검사하는 파일.
 *
 * 설치된 패키지의 세 진입점이 소비자의 TypeScript 에서 타입으로 해석되는지 확인한다.
 * 런타임 검증(smoke-package.check.js)은 exports map 만 보므로, `types` · `typesVersions` 가 잘못돼
 * `moduleResolution: node10` 프로젝트(NestJS 기본 tsconfig)에서만 TS2307 이 나는 문제는 잡지 못한다.
 */
import { initObservability, type IObservabilityHandle } from '@cloudjun/otel-kit';
import { OtelErrorInterceptor } from '@cloudjun/otel-kit/nest';
import { observability } from '@cloudjun/otel-kit/register';

const handle: IObservabilityHandle = initObservability({ defaultServiceName: 'smoke' });

export const enabled: boolean = handle.enabled && observability.enabled;
export const interceptorName: string = OtelErrorInterceptor.name;
