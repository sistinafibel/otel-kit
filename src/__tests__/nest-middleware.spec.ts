import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';
import * as errorTelemetry from '../error-telemetry';
import { OtelErrorInterceptor, RealIpMiddleware, REAL_IP_OPTIONS } from '../nest';

describe('RealIpMiddleware (NestJS)', () => {
  it('옵션 없이 생성하면 전달 헤더를 신뢰하지 않고, use 는 this 없이도 호출된다', () => {
    const { use } = new RealIpMiddleware();
    const req = { headers: { 'x-forwarded-for': 'a, 1.1.1.1' } } as { headers: Record<string, string>; realIp?: string };
    const next = jest.fn();

    use(req, {}, next);
    expect(req.realIp).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('옵션을 주입하면 trustedProxyCount 를 반영한다', () => {
    const mw = new RealIpMiddleware({ trustedProxyCount: 2 });
    const req = { headers: { 'x-forwarded-for': 'a, 1.1.1.1, 2.2.2.2' } } as { headers: Record<string, string>; realIp?: string };
    mw.use(req, {}, () => undefined);
    expect(req.realIp).toBe('1.1.1.1');
    expect(typeof REAL_IP_OPTIONS).toBe('symbol');
  });
});

describe('OtelErrorInterceptor (NestJS)', () => {
  const context = {} as ExecutionContext;
  const nextWith = (error: unknown): CallHandler => ({
    handle: () => throwError(() => error),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('5xx 예외를 span에 기록하고 원래 예외를 다시 던진다', async () => {
    const error = new InternalServerErrorException('failed');
    const record = jest.spyOn(errorTelemetry, 'recordErrorOnSpan').mockReturnValue(true);
    const interceptor = new OtelErrorInterceptor();

    await expect(firstValueFrom(interceptor.intercept(context, nextWith(error)))).rejects.toBe(error);
    expect(record).toHaveBeenCalledWith(error, { errorType: undefined });
  });

  it('기본값에서는 4xx를 제외하고, 옵션으로 포함할 수 있다', async () => {
    const error = new BadRequestException('invalid');
    const record = jest.spyOn(errorTelemetry, 'recordErrorOnSpan').mockReturnValue(true);

    await expect(
      firstValueFrom(new OtelErrorInterceptor().intercept(context, nextWith(error))),
    ).rejects.toBe(error);
    expect(record).not.toHaveBeenCalled();

    await expect(
      firstValueFrom(
        new OtelErrorInterceptor({
          recordHttp4xx: true,
          getErrorType: () => 'INVALID_REQUEST',
        }).intercept(context, nextWith(error)),
      ),
    ).rejects.toBe(error);
    expect(record).toHaveBeenCalledWith(error, { errorType: 'INVALID_REQUEST' });
  });
});
