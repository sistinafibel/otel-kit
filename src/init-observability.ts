/**
 * OpenTelemetry 부트스트랩 — 트레이스 · 로그 · 메트릭 provider 를 한 번에 구성한다.
 *
 * - OTLP endpoint 가 설정된 signal 만 활성화한다.
 * - OTEL_SDK_DISABLED 및 signal 별 exporter/endpoint 환경변수를 존중한다.
 * - exporter 는 OTLP/HTTP(protobuf)만 지원한다.
 * - 종료 신호는 애플리케이션이 소유하며, 반환된 handle.shutdown() 을 직접 await 해야 한다.
 *
 * 설정 검증(샘플러 · 메트릭 주기 · 프로토콜)은 전역 provider 를 등록하기 **전에** 모두 끝낸다.
 * 그래야 잘못된 설정으로 예외가 났을 때 절반만 등록된 전역 상태가 남지 않는다.
 */
import {
  DiagConsoleLogger,
  DiagLogLevel,
  diag,
  metrics,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import {
  defaultResource,
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
} from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  Sampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';

/** 메트릭 export 주기 기본값(ms). OTel 사양 기본값과 같다. */
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;
/** 메트릭 export 한 번의 제한 시간 기본값(ms). OTel 사양 기본값과 같다. */
const DEFAULT_METRIC_EXPORT_TIMEOUT_MS = 30_000;

/** 이 패키지가 지원하는 telemetry signal. */
export type OtelSignal = 'traces' | 'logs' | 'metrics';

/**
 * signal 별 실제 활성화 상태.
 * @property traces 트레이스 exporter 가 구성되었는지
 * @property logs 로그 exporter 가 구성되었는지
 * @property metrics 메트릭 exporter 가 구성되었는지
 */
export interface IObservabilitySignals {
  traces: boolean;
  logs: boolean;
  metrics: boolean;
}

/** 리소스 속성으로 허용하는 값 타입. */
export type ResourceAttributeValue = string | number | boolean;

/**
 * `initObservability` 옵션. 모든 항목이 선택이며 환경변수와 함께 쓰인다.
 *
 * @property defaultServiceName OTEL_SERVICE_NAME 미지정 시 사용할 이름. 둘 다 없으면 OTel 기본 `unknown_service` 이름을 쓴다
 * @property sampler 명시적 sampler. OTEL_TRACES_SAMPLER 보다 우선한다
 * @property prodSampleRate @deprecated OTEL_TRACES_SAMPLER_ARG 또는 `sampler` 를 쓴다. 설정된 경우에만 비율 sampler 를 적용한다
 * @property extraInstrumentations HttpInstrumentation 외에 추가로 등록할 계측
 * @property resourceAttributes 모든 signal 에 공통 부착할 리소스 속성. OTEL_RESOURCE_ATTRIBUTES 환경변수가 최종 우선권을 가진다
 * @property enableTraces false 로 두면 endpoint 가 있어도 트레이스를 끈다 (기본 true)
 * @property enableLogs false 로 두면 endpoint 가 있어도 로그를 끈다 (기본 true)
 * @property enableMetrics false 로 두면 endpoint 가 있어도 메트릭을 끈다 (기본 true)
 * @property metricExportIntervalMs 메트릭 export 주기(ms). OTEL_METRIC_EXPORT_INTERVAL 보다 우선한다
 * @property metricExportTimeoutMs 메트릭 export 제한 시간(ms). 주기보다 클 수 없다. OTEL_METRIC_EXPORT_TIMEOUT 보다 우선한다
 */
export interface IInitObservabilityOptions {
  defaultServiceName?: string;
  sampler?: Sampler;
  /** @deprecated OTEL_TRACES_SAMPLER_ARG 또는 sampler를 사용한다. */
  prodSampleRate?: number;
  extraInstrumentations?: Instrumentation[];
  resourceAttributes?: Record<string, ResourceAttributeValue>;
  enableTraces?: boolean;
  enableLogs?: boolean;
  enableMetrics?: boolean;
  metricExportIntervalMs?: number;
  metricExportTimeoutMs?: number;
}

/**
 * `initObservability` 가 반환하는 핸들. 애플리케이션 종료 흐름에서 `shutdown()` 을 await 한다.
 *
 * @property enabled 하나 이상의 signal 이 실제로 구성되었는지. false 면 나머지 메서드는 no-op 이다
 * @property signals signal 별 활성화 상태 (읽기 전용)
 * @property forceFlush 버퍼에 남은 span · 로그 · 메트릭을 즉시 export 한다. 실패 시 AggregateError
 * @property shutdown flush 후 모든 provider 와 계측을 정리한다. 여러 번 호출해도 한 번만 수행되며 같은 Promise 를 돌려준다
 */
export interface IObservabilityHandle {
  enabled: boolean;
  signals: Readonly<IObservabilitySignals>;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** flush · shutdown 을 지원하는 provider 의 최소 형태 */
interface IFlushableProvider {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** 전역 등록 전에 미리 계산해 두는 검증 완료 설정 */
interface IResolvedSettings {
  sampler: Sampler | undefined;
  metricTiming: { interval: number; timeout: number } | undefined;
}

const DISABLED_SIGNALS: Readonly<IObservabilitySignals> = Object.freeze({
  traces: false,
  logs: false,
  metrics: false,
});

/** 아무 signal 도 활성화되지 않았을 때 돌려주는 안전한 no-op 핸들 */
const NOOP_HANDLE: IObservabilityHandle = {
  enabled: false,
  signals: DISABLED_SIGNALS,
  forceFlush: async () => undefined,
  shutdown: async () => undefined,
};

let currentHandle: IObservabilityHandle | undefined;
let diagnosticsConfigured = false;

/** signal 별 표준 OTEL 환경변수 이름 */
const SIGNAL_ENV: Record<OtelSignal, { endpoint: string; exporter: string; protocol: string }> = {
  traces: {
    endpoint: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    exporter: 'OTEL_TRACES_EXPORTER',
    protocol: 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
  },
  logs: {
    endpoint: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
    exporter: 'OTEL_LOGS_EXPORTER',
    protocol: 'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  },
  metrics: {
    endpoint: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    exporter: 'OTEL_METRICS_EXPORTER',
    protocol: 'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  },
};

/** 환경변수 값이 `true`(대소문자 무시)인지 */
function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** 공백뿐인 환경변수는 미설정으로 취급한다 */
function envOrUndefined(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** `OTEL_<SIGNAL>_EXPORTER` 가 비어 있거나 `otlp` 를 포함하면 true */
function hasOtlpExporter(signal: OtelSignal): boolean {
  const configured = envOrUndefined(SIGNAL_ENV[signal].exporter)?.toLowerCase();
  if (!configured) {
    return true;
  }
  const exporters = configured.split(',').map(value => value.trim());
  return exporters.includes('otlp');
}

/** signal 전용 endpoint 또는 공통 endpoint 가 설정되어 있는지 */
function hasEndpoint(signal: OtelSignal): boolean {
  return Boolean(
    envOrUndefined(SIGNAL_ENV[signal].endpoint) || envOrUndefined('OTEL_EXPORTER_OTLP_ENDPOINT'),
  );
}

/**
 * OTLP export 활성화 여부를 환경변수만으로 판단한다.
 *
 * @param signal 확인할 signal. 생략하면 하나 이상의 signal 이 활성화되는지 반환한다
 * @returns OTEL_SDK_DISABLED 가 아니고, endpoint 와 otlp exporter 가 모두 설정되어 있으면 true
 */
export function isOtelExportEnabled(signal?: OtelSignal): boolean {
  if (isTrue(process.env.OTEL_SDK_DISABLED)) {
    return false;
  }
  if (signal) {
    return hasEndpoint(signal) && hasOtlpExporter(signal);
  }
  return (['traces', 'logs', 'metrics'] as const).some(isOtelExportEnabled);
}

/**
 * 이 프로세스에서 `initObservability` 가 만든 핸들을 돌려준다.
 *
 * 초기화 이후에는 옵션(`enableLogs: false` 등)이 반영된 실제 활성 signal 을 알 수 있으므로
 * 환경변수만 보는 `isOtelExportEnabled` 보다 정확하다.
 *
 * @returns 활성 핸들. 아직 초기화되지 않았거나 no-op 으로 끝났으면 undefined
 */
export function getObservability(): IObservabilityHandle | undefined {
  return currentHandle;
}

/** OTEL_LOG_LEVEL 에 따라 OTel 내부 진단 로거를 한 번만 설정한다 */
function configureDiagnostics(): void {
  if (diagnosticsConfigured) {
    return;
  }
  diagnosticsConfigured = true;

  const configured = envOrUndefined('OTEL_LOG_LEVEL')?.toUpperCase();
  const levels: Record<string, DiagLogLevel> = {
    NONE: DiagLogLevel.NONE,
    ERROR: DiagLogLevel.ERROR,
    WARN: DiagLogLevel.WARN,
    INFO: DiagLogLevel.INFO,
    DEBUG: DiagLogLevel.DEBUG,
    VERBOSE: DiagLogLevel.VERBOSE,
    ALL: DiagLogLevel.ALL,
  };
  if (configured && configured !== 'NONE') {
    diag.setLogger(new DiagConsoleLogger(), levels[configured] ?? DiagLogLevel.INFO);
  }
}

/** 0~1 사이의 유한한 샘플링 비율만 허용한다 */
function parseRatio(value: unknown, name: string): number {
  const ratio = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError(`${name} must be a finite number between 0 and 1`);
  }
  return ratio;
}

/** 비율 sampler. `parentBased` 면 부모 span 의 결정을 따르고 root 에만 비율을 적용한다 */
function ratioSampler(ratio: number, parentBased: boolean): Sampler {
  const root = new TraceIdRatioBasedSampler(ratio);
  return parentBased ? new ParentBasedSampler({ root }) : root;
}

/**
 * sampler 결정 순서: 옵션 `sampler` → OTEL_TRACES_SAMPLER → (deprecated) `prodSampleRate` → parent-based always-on.
 * @throws RangeError 비율 값이 범위를 벗어날 때
 * @throws Error 지원하지 않는 OTEL_TRACES_SAMPLER 값일 때
 */
function resolveSampler(options: IInitObservabilityOptions): Sampler {
  if (options.sampler) {
    return options.sampler;
  }

  const configured = envOrUndefined('OTEL_TRACES_SAMPLER')?.toLowerCase();
  const arg = process.env.OTEL_TRACES_SAMPLER_ARG;
  switch (configured) {
    case undefined:
      return options.prodSampleRate === undefined
        ? new ParentBasedSampler({ root: new AlwaysOnSampler() })
        : ratioSampler(parseRatio(options.prodSampleRate, 'prodSampleRate'), true);
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'parentbased_always_on':
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case 'parentbased_always_off':
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case 'traceidratio':
      return ratioSampler(parseRatio(arg, 'OTEL_TRACES_SAMPLER_ARG'), false);
    case 'parentbased_traceidratio':
      return ratioSampler(parseRatio(arg, 'OTEL_TRACES_SAMPLER_ARG'), true);
    default:
      throw new Error(`Unsupported OTEL_TRACES_SAMPLER: ${configured}`);
  }
}

/** 양의 유한한 밀리초 값만 허용한다. 미설정(또는 빈 문자열)이면 기본값을 쓴다 */
function positiveDuration(raw: unknown, fallback: number, name: string): number {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return fallback;
  }
  const interval = Number(raw);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return interval;
}

/**
 * 메트릭 export 주기와 제한 시간을 결정한다. 옵션이 환경변수보다 우선한다.
 *
 * 제한 시간을 명시하지 않은 경우 기본값(30초)이 주기보다 길면 주기에 맞춰 자동으로 줄인다.
 * 그렇지 않으면 `OTEL_METRIC_EXPORT_INTERVAL=5000` 처럼 주기만 짧게 준 사용자가
 * 아무 잘못 없이 시작 시 예외를 만나게 된다. 명시적으로 준 제한 시간이 주기보다 길면 여전히 거부한다.
 *
 * @throws RangeError 값이 양수가 아니거나, 명시한 제한 시간이 주기보다 클 때
 */
function resolveMetricTiming(options: IInitObservabilityOptions): {
  interval: number;
  timeout: number;
} {
  const interval = positiveDuration(
    options.metricExportIntervalMs ?? process.env.OTEL_METRIC_EXPORT_INTERVAL,
    DEFAULT_METRIC_EXPORT_INTERVAL_MS,
    'metric export interval',
  );
  const explicitTimeout = options.metricExportTimeoutMs ?? process.env.OTEL_METRIC_EXPORT_TIMEOUT;
  const timeout = positiveDuration(
    explicitTimeout,
    Math.min(DEFAULT_METRIC_EXPORT_TIMEOUT_MS, interval),
    'metric export timeout',
  );
  if (timeout > interval) {
    throw new RangeError('metric export timeout must not exceed metric export interval');
  }
  return { interval, timeout };
}

/**
 * 이 패키지는 `http/protobuf` 만 지원한다. signal 전용 변수가 있으면 그것이 공통 변수보다 우선한다.
 * @throws Error 다른 protocol 이 설정되어 있을 때
 */
function validateProtocol(signal: OtelSignal): void {
  const signalProtocol = process.env[SIGNAL_ENV[signal].protocol];
  const source = signalProtocol === undefined
    ? 'OTEL_EXPORTER_OTLP_PROTOCOL'
    : SIGNAL_ENV[signal].protocol;
  const protocol = (signalProtocol ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL)
    ?.trim()
    .toLowerCase();
  if (protocol && protocol !== 'http/protobuf') {
    throw new Error(`${source}=${protocol} is not supported; use http/protobuf`);
  }
}

/** 옵션과 환경변수를 조합해 실제로 켤 signal 을 결정한다 */
function resolveSignals(options: IInitObservabilityOptions): IObservabilitySignals {
  return {
    traces: options.enableTraces !== false && isOtelExportEnabled('traces'),
    logs: options.enableLogs !== false && isOtelExportEnabled('logs'),
    metrics: options.enableMetrics !== false && isOtelExportEnabled('metrics'),
  };
}

/**
 * 전역 provider 를 하나라도 등록하기 전에 모든 설정을 검증한다.
 * 여기서 예외가 나면 전역 상태는 그대로 남지 않는다.
 */
function resolveSettings(
  options: IInitObservabilityOptions,
  signals: IObservabilitySignals,
): IResolvedSettings {
  (Object.keys(signals) as OtelSignal[])
    .filter(signal => signals[signal])
    .forEach(validateProtocol);
  return {
    sampler: signals.traces ? resolveSampler(options) : undefined,
    metricTiming: signals.metrics ? resolveMetricTiming(options) : undefined,
  };
}

/**
 * 리소스 병합 순서(뒤가 우선): SDK 기본 → host/os/instance 감지 → 패키지 기본값 → 옵션 → 환경변수.
 * `deployment.environment.name` 은 NODE_ENV 에서 기본값을 채운다.
 */
function buildResource(options: IInitObservabilityOptions) {
  const detected = detectResources({
    detectors: [hostDetector, osDetector, serviceInstanceIdDetector],
  });
  const defaults: Record<string, ResourceAttributeValue> = {
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  };
  if (options.defaultServiceName?.trim()) {
    defaults[ATTR_SERVICE_NAME] = options.defaultServiceName.trim();
  }

  const fromEnv = detectResources({ detectors: [envDetector] });
  return defaultResource()
    .merge(detected)
    .merge(resourceFromAttributes(defaults))
    .merge(resourceFromAttributes(options.resourceAttributes ?? {}))
    .merge(fromEnv);
}

/**
 * 검증이 끝난 설정으로 provider 를 만들고 전역에 등록한다.
 * 메트릭 provider 를 먼저 만들어 로그 · 트레이스 SDK 의 자체 메트릭에도 연결한다.
 *
 * @returns 등록된 provider 목록과, 등록한 계측을 해제하는 함수
 */
function registerProviders(
  options: IInitObservabilityOptions,
  signals: IObservabilitySignals,
  settings: IResolvedSettings,
): { providers: IFlushableProvider[]; disableInstrumentations: () => void } {
  const resource = buildResource(options);
  const providers: IFlushableProvider[] = [];
  let disableInstrumentations: () => void = () => undefined;

  let meterProvider: MeterProvider | undefined;
  if (signals.metrics && settings.metricTiming) {
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: settings.metricTiming.interval,
          exportTimeoutMillis: settings.metricTiming.timeout,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    providers.push(meterProvider);
  }

  if (signals.logs) {
    const loggerProvider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
      ...(meterProvider ? { meterProvider } : {}),
    });
    logs.setGlobalLoggerProvider(loggerProvider);
    providers.push(loggerProvider);
  }

  if (signals.traces && settings.sampler) {
    const tracerProvider = new NodeTracerProvider({
      resource,
      sampler: settings.sampler,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      ...(meterProvider ? { meterProvider } : {}),
    });
    tracerProvider.register();
    disableInstrumentations = registerInstrumentations({
      instrumentations: [new HttpInstrumentation(), ...(options.extraInstrumentations ?? [])],
    });
    providers.push(tracerProvider);
  }

  return { providers, disableInstrumentations };
}

/**
 * 모든 provider 에 같은 작업을 병렬로 수행하고, 하나라도 실패하면 모아서 던진다.
 * @throws AggregateError 실패한 provider 의 오류 모음
 */
async function runForEveryProvider(
  operation: 'forceFlush' | 'shutdown',
  providers: IFlushableProvider[],
): Promise<void> {
  const results = await Promise.allSettled(providers.map(provider => provider[operation]()));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors, `OpenTelemetry ${operation} failed`);
  }
}

/**
 * 활성화된 signal 의 provider 를 구성하고 전역에 등록한다.
 * 반드시 애플리케이션 및 계측 대상 모듈보다 먼저 호출한다.
 *
 * - 한 프로세스에서 한 번만 초기화되며, 이후 호출은 옵션을 무시하고 같은 핸들을 돌려준다.
 * - OTEL_SDK_DISABLED=true 이거나 활성화할 signal 이 없으면 no-op 핸들을 돌려준다 (전역 등록 없음).
 * - 프로세스 signal handler 는 등록하지 않는다. 종료 흐름에서 `handle.shutdown()` 을 await 해야 한다.
 *
 * @param options 서비스 이름 · sampler · 리소스 속성 · signal 토글 등
 * @returns flush · shutdown 을 제공하는 핸들
 * @throws Error 지원하지 않는 OTLP protocol 또는 sampler 이름일 때
 * @throws RangeError 샘플링 비율이나 메트릭 주기 값이 범위를 벗어날 때
 */
export function initObservability(options: IInitObservabilityOptions = {}): IObservabilityHandle {
  if (currentHandle) {
    return currentHandle;
  }
  if (isTrue(process.env.OTEL_SDK_DISABLED)) {
    return NOOP_HANDLE;
  }

  const signals = resolveSignals(options);
  if (!Object.values(signals).some(Boolean)) {
    return NOOP_HANDLE;
  }

  configureDiagnostics();
  const settings = resolveSettings(options, signals);
  const { providers, disableInstrumentations } = registerProviders(options, signals, settings);

  let shutdownPromise: Promise<void> | undefined;
  const handle: IObservabilityHandle = {
    enabled: true,
    signals: Object.freeze({ ...signals }),
    forceFlush: () => runForEveryProvider('forceFlush', providers),
    shutdown: () => {
      shutdownPromise ??= runForEveryProvider('shutdown', providers).finally(
        disableInstrumentations,
      );
      return shutdownPromise;
    },
  };
  currentHandle = handle;
  return handle;
}
