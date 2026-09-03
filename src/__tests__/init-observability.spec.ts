/**
 * initObservability 는 모듈 스코프 싱글톤이므로 케이스마다 jest.isolateModules 로 새 모듈 인스턴스를 만든다.
 * 엔드포인트는 연결되지 않는 주소를 쓴다. exporter 는 flush/shutdown 시에만 전송을 시도하며 실패해도 예외를 던지지 않는다.
 */
type InitModule = typeof import('../init-observability');
type TransportModule = typeof import('../winston/otel-log-transport');

const ORIGINAL_ENV = { ...process.env };

const load = (): InitModule => {
  let mod!: InitModule;
  jest.isolateModules(() => {
    mod = require('../init-observability');
  });
  return mod;
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('initObservability — 엔드포인트 미설정', () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('isOtelExportEnabled 가 false 이고 no-op 핸들을 돌려준다', async () => {
    const mod = load();
    expect(mod.isOtelExportEnabled()).toBe(false);

    const handle = mod.initObservability({ defaultServiceName: 'svc' });
    expect(handle.enabled).toBe(false);
    await expect(handle.forceFlush()).resolves.toBeUndefined();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('winston transport 헬퍼는 null 을 돌려준다', () => {
    let transport!: TransportModule;
    jest.isolateModules(() => {
      transport = require('../winston/otel-log-transport');
    });
    expect(transport.createOtelLogTransport()).toBeNull();
  });

  it('no-op 결과를 캐시하지 않아 이후 올바른 설정으로 초기화할 수 있다', async () => {
    const mod = load();
    expect(mod.initObservability({ defaultServiceName: 'svc' }).enabled).toBe(false);

    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://127.0.0.1:1/v1/logs';
    const handle = mod.initObservability({ defaultServiceName: 'svc' });
    expect(handle.enabled).toBe(true);
    expect(handle.signals).toEqual({ traces: false, logs: true, metrics: false });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe('initObservability — 엔드포인트 설정', () => {
  beforeEach(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
    process.env.NODE_ENV = 'production';
  });

  it('provider 를 구성하고 활성 핸들을 돌려주며, 재호출 시 같은 핸들을 반환한다', async () => {
    const mod = load();
    const signalListeners = process.listenerCount('SIGTERM');
    const first = mod.initObservability({
      defaultServiceName: 'svc',
      prodSampleRate: 0.5,
      resourceAttributes: { 'collector.id': 'c-01' },
      metricExportIntervalMs: 60_000,
    });
    const second = mod.initObservability({ defaultServiceName: 'other' });

    expect(first.enabled).toBe(true);
    expect(first.signals).toEqual({ traces: true, logs: true, metrics: true });
    expect(second).toBe(first);
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners);
    await expect(first.forceFlush()).resolves.toBeUndefined();
    await expect(first.shutdown()).resolves.toBeUndefined();
  });

  it('enableMetrics=false 여도 트레이스·로그 핸들은 정상 동작한다', async () => {
    const mod = load();
    const handle = mod.initObservability({ defaultServiceName: 'svc', enableMetrics: false });
    expect(handle.enabled).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('winston transport 헬퍼는 transport 인스턴스를 돌려준다', () => {
    let transport!: TransportModule;
    jest.isolateModules(() => {
      transport = require('../winston/otel-log-transport');
    });
    const t = transport.createOtelLogTransport('warn');
    expect(t).not.toBeNull();
    expect((t as { level?: string }).level).toBe('warn');
  });

  it('OTEL_SDK_DISABLED 및 signal exporter=none 을 존중한다', () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    let mod = load();
    expect(mod.isOtelExportEnabled()).toBe(false);
    expect(mod.initObservability().enabled).toBe(false);

    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_TRACES_EXPORTER = 'none';
    process.env.OTEL_LOGS_EXPORTER = 'none';
    process.env.OTEL_METRICS_EXPORTER = 'none';
    mod = load();
    expect(mod.isOtelExportEnabled()).toBe(false);
    expect(mod.initObservability().enabled).toBe(false);
  });

  it('지원하지 않는 protocol과 잘못된 sampler 값을 시작 시 거부한다', () => {
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
    expect(() => load().initObservability()).toThrow(/http\/protobuf/);

    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
    process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
    process.env.OTEL_TRACES_SAMPLER_ARG = 'invalid';
    expect(() => load().initObservability({ enableLogs: false, enableMetrics: false })).toThrow(
      /OTEL_TRACES_SAMPLER_ARG/,
    );
  });

  it('metric timeout이 interval보다 크면 시작 시 거부한다', () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '1000';
    process.env.OTEL_METRIC_EXPORT_TIMEOUT = '2000';
    expect(() =>
      load().initObservability({ enableTraces: false, enableLogs: false }),
    ).toThrow(/timeout must not exceed/);
  });

  it('interval만 기본 timeout(30초)보다 짧게 주면 timeout 기본값을 interval에 맞춰 줄인다', async () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '5000';
    delete process.env.OTEL_METRIC_EXPORT_TIMEOUT;
    const handle = load().initObservability({ enableTraces: false, enableLogs: false });
    expect(handle.signals.metrics).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('옵션으로 interval만 짧게 줘도 동일하게 동작한다', async () => {
    delete process.env.OTEL_METRIC_EXPORT_TIMEOUT;
    const handle = load().initObservability({
      enableTraces: false,
      enableLogs: false,
      metricExportIntervalMs: 2_000,
    });
    expect(handle.signals.metrics).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe('initObservability — 설정 오류 시 전역 상태 보호', () => {
  beforeEach(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
  });

  it('sampler 설정이 잘못되면 metrics/logs provider 도 전역에 등록하지 않는다', async () => {
    process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
    process.env.OTEL_TRACES_SAMPLER_ARG = 'invalid';

    let mod!: InitModule;
    let api!: typeof import('@opentelemetry/api');
    let apiLogs!: typeof import('@opentelemetry/api-logs');
    jest.isolateModules(() => {
      api = require('@opentelemetry/api');
      apiLogs = require('@opentelemetry/api-logs');
      mod = require('../init-observability');
    });
    const meterSpy = jest.spyOn(api.metrics, 'setGlobalMeterProvider');
    const loggerSpy = jest.spyOn(apiLogs.logs, 'setGlobalLoggerProvider');

    // 세 signal 이 모두 켜진 상태에서 traces 설정만 잘못된 경우
    expect(() => mod.initObservability()).toThrow(/OTEL_TRACES_SAMPLER_ARG/);
    expect(meterSpy).not.toHaveBeenCalled();
    expect(loggerSpy).not.toHaveBeenCalled();
    expect(mod.getObservability()).toBeUndefined();

    // 설정을 고치면 같은 프로세스에서 정상 초기화된다
    process.env.OTEL_TRACES_SAMPLER_ARG = '0.5';
    const handle = mod.initObservability();
    expect(handle.enabled).toBe(true);
    expect(mod.getObservability()).toBe(handle);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('빈 문자열 메트릭 주기 환경변수는 미설정으로 취급한다', async () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '';
    process.env.OTEL_METRIC_EXPORT_TIMEOUT = '  ';
    const handle = load().initObservability({ enableTraces: false, enableLogs: false });
    expect(handle.signals.metrics).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('enableLogs=false 면 endpoint 가 있어도 winston transport 가 null 이다', async () => {
    let mod!: InitModule;
    let transport!: TransportModule;
    jest.isolateModules(() => {
      mod = require('../init-observability');
      transport = require('../winston/otel-log-transport');
    });
    const handle = mod.initObservability({ enableLogs: false, enableTraces: false });
    expect(handle.signals).toEqual({ traces: false, logs: false, metrics: true });
    expect(transport.createOtelLogTransport()).toBeNull();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
