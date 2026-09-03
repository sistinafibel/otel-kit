#!/usr/bin/env bash
# 배포될 tarball 을 실제로 설치해 진입점(exports map)과 파일 구성이 올바른지 검증한다.
# 단위 테스트는 src/ 를 직접 import 하므로 잡아내지 못하는 "패키지 수준" 오류
# (exports map 오타, files 누락, 테스트 파일 유출, 빈 dist/ 등)를 CI 와 릴리스 직전에 걸러 내는 것이 목적이다.
#
#   1. npm pack 으로 tarball 생성 (prepack → build)
#   2. tarball 에 테스트·소스·커버리지가 섞여 들어가지 않았는지, 필수 진입점 파일이 있는지 확인
#   3. 임시 프로젝트에 tarball 과 peer 인 @opentelemetry/api 를 설치 (버전은 devDependencies 와 동일하게 고정)
#   4. `.`, `./nest`, `./register`, `./package.json` 진입점을 실제로 resolve/require 해 본다
#
# 사용법: bash scripts/smoke-package.sh   (로컬·CI 동일)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cd "$root"

# --- 1. tarball 생성. tsc 진단은 stdout 으로 나오므로 실패하면 두 스트림을 모두 보여 준다.
if ! npm pack --pack-destination "$workdir" >"$workdir/pack.out" 2>"$workdir/pack.err"; then
  echo "::error::npm pack 실패" >&2
  cat "$workdir/pack.out" "$workdir/pack.err" >&2
  exit 1
fi

# 방금 만든 빈 디렉터리에는 tarball 이 정확히 하나여야 한다 (npm 의 stdout 형식에 의존하지 않는다)
shopt -s nullglob
tarballs=("$workdir"/*.tgz)
shopt -u nullglob
if [ "${#tarballs[@]}" -ne 1 ]; then
  echo "::error::tarball 이 정확히 하나여야 합니다 (발견: ${#tarballs[@]})" >&2
  exit 1
fi
tarball="${tarballs[0]}"
echo "tarball: $(basename "$tarball")"

# --- 2. tarball 내용 검사
listing="$(tar -tzf "$tarball")"

if grep -E '__tests__|\.spec\.|coverage/|^package/src/' <<<"$listing"; then
  echo "::error::tarball 에 테스트·소스·커버리지 파일이 포함되어 있습니다" >&2
  exit 1
fi

for entry in index nest register; do
  for ext in js d.ts; do
    grep -qFx "package/dist/${entry}.${ext}" <<<"$listing" \
      || { echo "::error::tarball 에 dist/${entry}.${ext} 가 없습니다" >&2; exit 1; }
  done
done
echo "tarball contents ok ($(wc -l <<<"$listing" | tr -d ' ') files)"

# --- 3. 빈 프로젝트에 설치. peer 는 devDependencies 에 고정된 버전을 그대로 써서 레지스트리 변동에 영향받지 않게 한다.
api_version="$(node -p "require('./package.json').devDependencies['@opentelemetry/api']")"
app="$workdir/app"
mkdir -p "$app"
cd "$app"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$tarball" "@opentelemetry/api@${api_version}"

# --- 4. 진입점 검증 (스크립트는 설치된 패키지를 resolve 할 수 있도록 임시 프로젝트 안으로 복사한다)
cp "$root/scripts/smoke-package.check.js" "$app/check.js"
OTEL_SDK_DISABLED=true node "$app/check.js"
