import { toErrorLogRecord } from '../error-record';

describe('toErrorLogRecord', () => {
  it('Error 를 OTel 시맨틱 컨벤션 필드로 평탄화한다', () => {
    const err = new TypeError('boom');
    const record = toErrorLogRecord(err);

    expect(record['exception.type']).toBe('TypeError');
    expect(record['exception.message']).toBe('boom');
    expect(record['exception.stacktrace']).toContain('TypeError: boom');
    expect(record['error.type']).toBe('TypeError');
  });

  it('errorCode 가 있으면 error.type 으로 매핑하고 메타에서는 제거한다', () => {
    const record = toErrorLogRecord(new Error('x'), { errorCode: 'MQ_CONNECTION_FAILED', attempt: 3 });

    expect(record['error.type']).toBe('MQ_CONNECTION_FAILED');
    expect(record.attempt).toBe(3);
    expect(record).not.toHaveProperty('errorCode');
  });

  it('error.cause 가 있으면 한 줄 요약을 붙인다', () => {
    const inner = new RangeError('inner');
    const err = new Error('outer', { cause: inner });
    expect(toErrorLogRecord(err)['exception.cause']).toBe('RangeError: inner');

    const withPlainCause = new Error('outer', { cause: { code: 'ECONNREFUSED' } });
    expect(toErrorLogRecord(withPlainCause)['exception.cause']).toBe('{"code":"ECONNREFUSED"}');
  });

  it('stack 이 없으면 exception.stacktrace 를 생략한다', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    expect(toErrorLogRecord(err)).not.toHaveProperty('exception.stacktrace');
  });

  it('Error 가 아닌 값도 처리한다 (문자열·객체·순환참조)', () => {
    expect(toErrorLogRecord('plain string')).toMatchObject({
      'exception.type': 'NonError',
      'exception.message': 'plain string',
      'error.type': 'NonError',
    });
    expect(toErrorLogRecord({ code: 42 }, { errorCode: 'CUSTOM' })).toMatchObject({
      'exception.message': '{"code":42}',
      'error.type': 'CUSTOM',
    });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toErrorLogRecord(circular)['exception.message']).toBe('{"self":"[Circular]"}');
  });

  it('입력 meta 객체를 변경하지 않는다', () => {
    const meta = { errorCode: 'X', channelId: 'ch1' };
    const snapshot = { ...meta };
    toErrorLogRecord(new Error('e'), meta);
    expect(meta).toEqual(snapshot);
  });
});

describe('toErrorLogRecord — name 이 비정상인 Error', () => {
  it('name 이 빈 문자열이면 exception.type 과 error.type 모두 Error 로 대체한다', () => {
    const err = new Error('blank name');
    err.name = '';
    const record = toErrorLogRecord(err);
    expect(record['exception.type']).toBe('Error');
    expect(record['error.type']).toBe('Error');
  });

  it('name 이 문자열이 아니어도 문자열화한 값을 두 필드에 같은 값으로 쓴다', () => {
    const err = new Error('odd name');
    (err as unknown as { name: unknown }).name = 42;
    const record = toErrorLogRecord(err);
    expect(record['exception.type']).toBe('42');
    expect(record['error.type']).toBe('42');
  });
});
