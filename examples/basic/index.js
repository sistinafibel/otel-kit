/**
 * @sistinafibel/otel-kit 최소 end-to-end 예제.
 * Minimal end-to-end example for @sistinafibel/otel-kit.
 *
 * 실행 / Start:  npm start
 * (= node --env-file=.env --require @sistinafibel/otel-kit/register index.js)
 *
 * `register` 사전 로드가 이 파일보다 먼저 OTEL_* 환경 변수로 OpenTelemetry를
 * 초기화하므로, 아래에서 서버를 만들 때 내장 `http` 모듈은 이미 계측된 상태다.
 * The `register` preload initialises OpenTelemetry from OTEL_* environment
 * variables before this file is loaded, so the built-in `http` module is
 * already instrumented by the time we create the server below.
 */
const http = require('node:http');
const winston = require('winston');

const { observability } = require('@sistinafibel/otel-kit/register');
const {
  captureError,
  createHttpLoggerMiddleware,
  createOtelLogTransport,
  getActiveTraceId,
  getMeter,
  runWithSpan,
  SpanKind,
} = require('@sistinafibel/otel-kit');

// --- 로깅: 콘솔 + OTLP (logs 신호가 꺼져 있으면 OTLP transport는 null)
// --- Logging: console + OTLP (the OTLP transport is null when logs are disabled)
const transports = [new winston.transports.Console({ format: winston.format.simple() })];
const otelTransport = createOtelLogTransport('info');
if (otelTransport) transports.push(otelTransport);
const logger = winston.createLogger({ level: 'info', transports });

// --- 메트릭: 저카디널리티 라벨을 가진 단순 카운터
// --- Metrics: a plain counter with a low-cardinality label
const meter = getMeter('otel-kit-example-basic');
const requestCounter = meter.createCounter('example.requests', {
  description: 'Number of handled requests by route',
});

// --- 응답마다 구조화된 "요청 완료" 로그 한 줄
// --- Structured "request completed" log line for every response
// 미들웨어는 `message` 필드를 가진 객체를 넘기며 winston은 이를 그대로 받는다.
// The middleware passes an object with a `message` field, which winston accepts as-is.
const httpLogger = createHttpLoggerMiddleware({
  logger: {
    log: data => logger.info(data),
    warn: data => logger.warn(data),
    error: data => logger.error(data),
  },
  logBody: false,
  stripQuery: true,
  logClientIp: false,
});

/**
 * 라우트별 처리. HTTP 서버 span은 이미 열려 있으므로 여기서는 자식 span과 오류만 다룬다.
 * Per-route handler. The HTTP server span is already open; we only add child spans and errors.
 */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  requestCounter.add(1, { route: url.pathname });

  if (url.pathname === '/hello') {
    // HTTP 호출이 아닌 "작업"을 자식 span으로 감싼다
    // A child span around some "work" that is not an HTTP call
    const greeting = await runWithSpan(
      'example.build-greeting',
      async span => {
        span.setAttribute('example.name', url.searchParams.get('name') ?? 'world');
        await new Promise(resolve => setTimeout(resolve, 25));
        return `hello, ${url.searchParams.get('name') ?? 'world'}`;
      },
      { kind: SpanKind.INTERNAL },
    );
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ greeting, traceId: getActiveTraceId() }));
    return;
  }

  if (url.pathname === '/fail') {
    try {
      throw new Error('Something went wrong on purpose');
    } catch (error) {
      // 활성 span에 예외를 기록하고, 동시에 안전한 로그 필드를 반환한다
      // Records the exception on the active span AND returns safe log fields
      logger.error('Request failed', captureError(error, { errorCode: 'EXAMPLE_FAILURE' }));
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'EXAMPLE_FAILURE', traceId: getActiveTraceId() }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
}

const server = http.createServer((req, res) => {
  httpLogger(req, res, () => {
    handle(req, res).catch(error => {
      logger.error('Unhandled handler error', captureError(error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  logger.info(`listening on http://localhost:${port}`, {
    signals: observability.signals,
  });
  logger.info('try: curl http://localhost:3000/hello?name=otel  |  curl http://localhost:3000/fail');
});

// --- 정상 종료: 프로세스가 끝나기 전에 대기 중인 telemetry를 flush 한다
// --- Graceful shutdown: flush pending telemetry before the process exits
async function shutdown(signal) {
  logger.info(`received ${signal}, shutting down`);
  server.close();
  await observability.shutdown();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
