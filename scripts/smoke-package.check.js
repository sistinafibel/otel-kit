/**
 * smoke-package.sh 가 임시 프로젝트 안에서 실행하는 진입점 검증 스크립트.
 *
 * 설치된 @cloudjun/otel-kit 의 진입점을 실제로 로드해 package.json 의
 * exports map 과 빌드 산출물이 소비자 입장에서 올바른지 확인한다.
 *
 * - `.`             : 공개 API 함수들이 export 되는지 실제로 require 해서 확인
 * - `./nest`        : resolve 만 확인 (@nestjs/common 은 optional peer 라 설치하지 않는다)
 * - `./register`    : OTEL_SDK_DISABLED=true 상태에서 SDK 를 켜지 않고 no-op 핸들을 주는지
 * - `./package.json`: exports 에 선언된 대로 읽히는지
 *
 * 이 파일은 임시 프로젝트로 복사된 뒤 실행되므로, 여기서의 require 는 그 프로젝트의
 * node_modules 를 기준으로 해석된다.
 */
'use strict';

const assert = require('node:assert/strict');

/** `.` 진입점에서 반드시 노출되어야 하는 공개 API 이름 */
const REQUIRED_EXPORTS = Object.freeze([
  'initObservability',
  'getObservability',
  'isOtelExportEnabled',
  'getActiveTraceId',
  'getActiveSpanId',
  'getMeter',
  'toErrorLogRecord',
  'captureError',
  'recordErrorOnSpan',
  'runWithSpan',
  'createOtelLogTransport',
  'extractIPv4',
  'getClientIp',
  'createRealIpMiddleware',
  'createHttpLoggerMiddleware',
  'maskSensitiveData',
  'DEFAULT_SENSITIVE_KEYS',
  'redactUrlQuery',
  'redactQueryString',
  'DEFAULT_QUERY_SENSITIVE_KEYS',
  'SpanKind',
  'SpanStatusCode',
]);

/** `.` 진입점: 실제로 로드해 공개 API 가 모두 있는지 확인한다 */
function checkMainEntry() {
  const kit = require('@cloudjun/otel-kit');
  const missing = REQUIRED_EXPORTS.filter(name => !(name in kit));
  assert.deepEqual(missing, [], `'.' 진입점에 없는 export: ${missing.join(', ')}`);
  return Object.keys(kit).length;
}

/** `./nest` 진입점: optional peer 없이 resolve 만 되는지 확인한다 */
function checkNestEntry() {
  const resolved = require.resolve('@cloudjun/otel-kit/nest');
  assert.ok(resolved.endsWith('nest.js'), `'./nest' 가 예상 밖의 파일로 해석됨: ${resolved}`);
}

/** `./register` 진입점: OTEL_SDK_DISABLED=true 이면 no-op 핸들이어야 한다 */
function checkRegisterEntry() {
  assert.equal(process.env.OTEL_SDK_DISABLED, 'true', '이 검사는 OTEL_SDK_DISABLED=true 로 실행해야 합니다');
  const { observability } = require('@cloudjun/otel-kit/register');
  assert.equal(observability.enabled, false, 'OTEL_SDK_DISABLED=true 인데 register 가 SDK 를 활성화했습니다');
  assert.equal(typeof observability.shutdown, 'function', 'register 핸들에 shutdown() 이 없습니다');
}

/** `./package.json` 진입점: exports 에 선언된 대로 읽히는지 확인한다 */
function checkPackageJsonEntry() {
  const pkg = require('@cloudjun/otel-kit/package.json');
  assert.equal(pkg.name, '@cloudjun/otel-kit');
}

/** node -e 스크립트를 비동기로 실행하고 종료 코드 · 출력을 돌려준다 */
function runNode(execPath, args, options) {
  return new Promise(resolve => {
    require('node:child_process').execFile(execPath, args, options, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * 실제 HTTP 요청으로 query 값이 가려지는지 확인한다.
 *
 * 가짜 OTLP 수집 서버를 띄우고 `initObservability` 를 기본 옵션으로 켠 뒤, 비밀 값이 든 query 로 요청을 보낸다.
 * 내보낸 트레이스(protobuf 본문) 어디에도 그 비밀 값이 글자 그대로 들어 있으면 안 된다.
 * 단위 테스트(jest)에서는 HttpInstrumentation 의 require 훅이 걸리지 않아, 이 검사는 일반 Node 에서만 할 수 있다.
 */
async function checkQueryRedaction() {
  const SECRET = 'TOPSECRET-smoke-9f3a';
  const CODE = 'AUTHCODE-smoke-77c1';
  const KEPT = 'kept-search-term';
  const bodies = [];
  // 계측을 켜기 전에 만든 서버 (수집기 역할). 이 프로세스가 보내는 내보내기 요청 자체는 계측에서 빠진다
  const plainHttp = require('node:http');
  const collector = plainHttp.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (req.url === '/v1/traces') bodies.push(Buffer.concat(chunks));
      res.end();
    });
  });
  await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));

  // spawnSync 는 쓰지 않는다. 이 프로세스의 이벤트 루프가 멈추면 위의 수집 서버가 응답하지 못한다
  const child = await runNode(
    process.execPath,
    [
      '-e',
      `
      const { initObservability } = require('@cloudjun/otel-kit');
      const handle = initObservability({ defaultServiceName: 'smoke-redaction' });
      const http = require('node:http');
      const target = http.createServer((req, res) => res.end('ok'));
      target.listen(0, '127.0.0.1', () => {
        const port = target.address().port;
        http.get('http://127.0.0.1:' + port + '/oauth/token?client_id=app&client_secret=${SECRET}&code=${CODE}&q=${KEPT}', res => {
          res.resume();
          res.on('end', async () => {
            target.close();
            await handle.shutdown();
            console.log(handle.enabled ? 'enabled' : 'disabled');
          });
        });
      });
      `,
    ],
    {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        OTEL_SDK_DISABLED: 'false',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.address().port}`,
        OTEL_LOGS_EXPORTER: 'none',
        OTEL_METRICS_EXPORTER: 'none',
      },
    },
  );
  // 자식이 끝난 뒤에도 남은 연결을 닫고 수집 서버를 내린다
  collector.closeAllConnections();
  await new Promise(resolve => collector.close(resolve));

  assert.equal(child.status, 0, `query 가리기 검사용 프로세스가 실패했습니다: ${child.stderr}`);
  assert.match(child.stdout, /enabled/, '검사용 프로세스에서 트레이스가 켜지지 않았습니다');
  assert.ok(bodies.length > 0, '수집 서버가 트레이스를 받지 못했습니다');
  const exported = Buffer.concat(bodies).toString('latin1');
  assert.ok(exported.includes('/oauth/token'), '내보낸 트레이스에 요청 경로가 없습니다 (HTTP 계측이 걸리지 않음)');
  assert.ok(!exported.includes(SECRET), '나가는/들어오는 span 에 client_secret 값이 그대로 남았습니다');
  assert.ok(!exported.includes(CODE), 'span 에 code 값이 그대로 남았습니다');
  assert.ok(exported.includes(KEPT), '들어오는 요청의 민감하지 않은 값(q)까지 가려졌습니다');
  assert.ok(exported.includes('client_secret=REDACTED'), 'client_secret 이 REDACTED 로 바뀌지 않았습니다');
}

async function main() {
  const exportCount = checkMainEntry();
  checkNestEntry();
  checkRegisterEntry();
  checkPackageJsonEntry();
  await checkQueryRedaction();
  console.log(
    `smoke ok: '.' (${exportCount} exports), './nest', './register', './package.json' 진입점 확인 완료, 실제 요청의 query 값 가리기 확인 완료`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
