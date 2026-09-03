/**
 * NestJS 예외를 HTTP 응답으로 변환하기 전에 활성 span 에 기록하는 전역 interceptor.
 *
 * Nest 의 exception filter 는 예외를 응답으로 바꾸므로 HttpInstrumentation 은 4xx/5xx 응답만 볼 뿐
 * 원래 예외 객체를 모른다. 이 interceptor 가 filter 보다 먼저 예외를 받아 span 에 exception 을 남긴다.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { catchError, throwError } from 'rxjs';
import { recordErrorOnSpan } from '../error-telemetry';

/**
 * `OtelErrorInterceptor` 옵션. `OTEL_ERROR_INTERCEPTOR_OPTIONS` 토큰으로 주입한다.
 *
 * @property recordHttp4xx 4xx `HttpException` 도 오류 span 으로 기록할지 여부 (기본 false).
 *   클라이언트 오류는 대개 정상 흐름이므로 기본적으로 제외해 오류율 지표가 왜곡되지 않게 한다
 * @property getErrorType 예외에서 `error.type` 분류 코드를 뽑는 함수. 없으면 Error 클래스명을 쓴다
 */
export interface IOtelErrorInterceptorOptions {
  recordHttp4xx?: boolean;
  getErrorType?: (error: unknown) => string | undefined;
}

/** `IOtelErrorInterceptorOptions` 를 DI 로 주입할 때 쓰는 토큰 */
export const OTEL_ERROR_INTERCEPTOR_OPTIONS = Symbol('OTEL_ERROR_INTERCEPTOR_OPTIONS');

/**
 * 처리되지 않은 예외를 활성 span 에 기록하고 그대로 다시 던지는 interceptor.
 *
 * `APP_INTERCEPTOR` 로 전역 등록하면 모든 컨트롤러에 적용된다. 예외를 삼키거나 바꾸지 않으므로
 * 기존 exception filter 동작은 그대로 유지된다.
 *
 * @example
 * providers: [
 *   { provide: APP_INTERCEPTOR, useClass: OtelErrorInterceptor },
 *   { provide: OTEL_ERROR_INTERCEPTOR_OPTIONS, useValue: { recordHttp4xx: false } },
 * ]
 */
@Injectable()
export class OtelErrorInterceptor implements NestInterceptor {
  /**
   * @param options 선택 옵션. 토큰이 등록되지 않으면 Nest 가 undefined 를 넘기고 기본값 `{}` 이 적용된다
   */
  constructor(
    @Optional()
    @Inject(OTEL_ERROR_INTERCEPTOR_OPTIONS)
    private readonly options: IOtelErrorInterceptorOptions = {},
  ) {}

  /**
   * 핸들러 스트림의 오류를 가로채 span 에 기록한 뒤 같은 오류로 다시 reject 한다.
   * @param _context 실행 컨텍스트 (미사용)
   * @param next 다음 핸들러
   * @returns 원본 응답 스트림
   */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const isClientError =
          error instanceof HttpException && error.getStatus() >= 400 && error.getStatus() < 500;
        if (!isClientError || this.options.recordHttp4xx) {
          recordErrorOnSpan(error, { errorType: this.options.getErrorType?.(error) });
        }
        return throwError(() => error);
      }),
    );
  }
}
