/**
 * @sistinafibel/otel-kit/nest — NestJS 전용 진입점.
 * `@nestjs/common` 이 설치된 프로젝트에서만 import 한다.
 */
export { RealIpMiddleware, REAL_IP_OPTIONS } from './nest/real-ip.middleware';
export {
  OtelErrorInterceptor,
  OTEL_ERROR_INTERCEPTOR_OPTIONS,
  IOtelErrorInterceptorOptions,
} from './nest/otel-error.interceptor';
