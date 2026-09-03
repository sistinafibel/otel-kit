/**
 * Jest 의 json-summary 리포트(coverage/coverage-summary.json)를 읽어
 * GitHub Actions 잡 요약($GITHUB_STEP_SUMMARY)에 마크다운 표로 덧붙인다.
 *
 * - CI 에서는 Actions 실행 페이지 상단에 커버리지 표가 바로 보이게 한다.
 * - 로컬에서 실행하면 같은 표를 표준 출력에 찍는다.
 * - 리포트가 없으면(테스트가 돌기 전에 실패한 경우 등) 조용히 0 으로 끝난다.
 *
 * 사용법: node scripts/coverage-summary.js   (먼저 npm run test:ci 또는 test:cov 실행)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Jest 가 json-summary 리포터로 남기는 파일 위치 */
const SUMMARY_PATH = path.resolve(__dirname, '..', 'coverage', 'coverage-summary.json');

/** 표에 표시할 항목과 순서. jest.config.js 의 coverageThreshold 는 lines·statements 에 걸려 있다 */
const METRICS = Object.freeze(['lines', 'statements', 'branches', 'functions']);

/**
 * 한 항목의 커버리지를 "91.44% (321/351)" 형태로 만든다.
 * @param {{ pct: number, covered: number, total: number }} metric json-summary 의 항목 객체
 * @returns {string}
 */
function formatMetric(metric) {
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

/**
 * 전체(total) 커버리지를 마크다운 표로 만든다.
 * @param {Record<string, { pct: number, covered: number, total: number }>} total json-summary 의 total 객체
 * @returns {string} 제목과 표를 포함한 마크다운
 */
function buildTable(total) {
  const rows = METRICS.map(name => `| ${name} | ${formatMetric(total[name])} |`);
  return [
    `## 테스트 커버리지 (node ${process.version})`,
    '',
    '| 항목 | 커버리지 |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  if (!fs.existsSync(SUMMARY_PATH)) {
    console.log(`커버리지 리포트가 없어 요약을 건너뜁니다: ${SUMMARY_PATH}`);
    return;
  }
  // 리포트가 깨져 있어도(테스트 도중 중단 등) 요약 단계 때문에 잡을 실패시키지는 않는다
  let total;
  try {
    ({ total } = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8')));
  } catch (error) {
    console.log(`커버리지 리포트를 읽지 못해 요약을 건너뜁니다: ${error instanceof Error ? error.message : error}`);
    return;
  }
  if (!total || METRICS.some(name => !total[name])) {
    console.log('커버리지 리포트에 필요한 항목이 없어 요약을 건너뜁니다');
    return;
  }
  const table = buildTable(total);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `${table}\n`);
  } else {
    process.stdout.write(table);
  }
}

main();
