/**
 * NestJS 용 실제 IP 미들웨어. 동작은 `createRealIpMiddleware` 와 동일하다.
 *
 * 등록 방법 두 가지:
 * - 전역: `app.use(new RealIpMiddleware().use)` (main.ts)
 * - 모듈: `consumer.apply(RealIpMiddleware).forRoutes('*')` — 옵션은 `REAL_IP_OPTIONS` 토큰으로 주입
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { createRealIpMiddleware, IRealIpOptions, IRealIpRequest } from '../http/client-ip';

/** `IRealIpOptions` 를 DI 로 주입할 때 쓰는 토큰 */
export const REAL_IP_OPTIONS = Symbol('REAL_IP_OPTIONS');

/**
 * 클라이언트 실제 IP 를 `req.realIp` 에 기록하는 Nest 미들웨어.
 *
 * 기본값은 전달 헤더(X-Forwarded-For · X-Real-IP)를 신뢰하지 않는다. 앞단 프록시 홉 수가
 * 고정된 환경에서만 `REAL_IP_OPTIONS` 로 `trustedProxyCount` 를 명시한다.
 *
 * @example
 * providers: [{ provide: REAL_IP_OPTIONS, useValue: { trustedProxyCount: 1 } }]
 * // configure(consumer) { consumer.apply(RealIpMiddleware).forRoutes('*'); }
 */
@Injectable()
export class RealIpMiddleware implements NestMiddleware {
  private readonly handler: ReturnType<typeof createRealIpMiddleware>;

  /**
   * @param options 선택 옵션. 토큰이 없으면 기본값(전달 헤더 불신, span 속성 미기록)을 쓴다
   * @throws RangeError `trustedProxyCount` 가 음수이거나 정수가 아닐 때
   */
  constructor(@Optional() @Inject(REAL_IP_OPTIONS) options?: IRealIpOptions) {
    this.handler = createRealIpMiddleware(options ?? {});
  }

  /**
   * `app.use(instance.use)` 처럼 떼어내 써도 되도록 화살표 프로퍼티로 둔다.
   * @param req 요청. 통과 후 `realIp` 가 채워진다
   * @param res 응답 (미사용)
   * @param next 다음 미들웨어
   */
  use = (req: IRealIpRequest, res: unknown, next: () => void): void => {
    this.handler(req, res, next);
  };
}
