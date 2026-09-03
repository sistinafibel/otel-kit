/**
 * smoke-package.sh 가 임시 프로젝트 안에서 실행하는 진입점 검증 스크립트.
 *
 * 설치된 @sistinafibel/otel-kit 의 진입점을 실제로 로드해 package.json 의
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
  'SpanKind',
  'SpanStatusCode',
]);

/** `.` 진입점: 실제로 로드해 공개 API 가 모두 있는지 확인한다 */
function checkMainEntry() {
  const kit = require('@sistinafibel/otel-kit');
  const missing = REQUIRED_EXPORTS.filter(name => !(name in kit));
  assert.deepEqual(missing, [], `'.' 진입점에 없는 export: ${missing.join(', ')}`);
  return Object.keys(kit).length;
}

/** `./nest` 진입점: optional peer 없이 resolve 만 되는지 확인한다 */
function checkNestEntry() {
  const resolved = require.resolve('@sistinafibel/otel-kit/nest');
  assert.ok(resolved.endsWith('nest.js'), `'./nest' 가 예상 밖의 파일로 해석됨: ${resolved}`);
}

/** `./register` 진입점: OTEL_SDK_DISABLED=true 이면 no-op 핸들이어야 한다 */
function checkRegisterEntry() {
  assert.equal(process.env.OTEL_SDK_DISABLED, 'true', '이 검사는 OTEL_SDK_DISABLED=true 로 실행해야 합니다');
  const { observability } = require('@sistinafibel/otel-kit/register');
  assert.equal(observability.enabled, false, 'OTEL_SDK_DISABLED=true 인데 register 가 SDK 를 활성화했습니다');
  assert.equal(typeof observability.shutdown, 'function', 'register 핸들에 shutdown() 이 없습니다');
}

/** `./package.json` 진입점: exports 에 선언된 대로 읽히는지 확인한다 */
function checkPackageJsonEntry() {
  const pkg = require('@sistinafibel/otel-kit/package.json');
  assert.equal(pkg.name, '@sistinafibel/otel-kit');
}

function main() {
  const exportCount = checkMainEntry();
  checkNestEntry();
  checkRegisterEntry();
  checkPackageJsonEntry();
  console.log(`smoke ok: '.' (${exportCount} exports), './nest', './register', './package.json' 진입점 확인 완료`);
}

main();
