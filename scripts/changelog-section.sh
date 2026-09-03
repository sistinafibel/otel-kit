#!/usr/bin/env bash
# CHANGELOG.md 에서 지정한 버전의 섹션 본문만 표준 출력으로 내보낸다.
#
# 사용법: scripts/changelog-section.sh <version> [changelog-path]
#   예)   scripts/changelog-section.sh 1.2.3            → "## [1.2.3]" 섹션 본문
#
# 릴리스 워크플로가 GitHub Release 노트를 만들 때 사용한다. 섹션이 없으면
# 아무것도 출력하지 않고 0 으로 끝나므로, 호출 측에서 빈 출력을 감지해 대체 노트를 쓴다.
set -euo pipefail

version="${1:?usage: changelog-section.sh <version> [changelog-path]}"
changelog="${2:-CHANGELOG.md}"

# "## [" 로 시작하는 줄이 섹션 경계다. 정규식 대신 index() 를 써서 버전의 '.' 을 그대로 비교한다.
awk -v heading="## [${version}]" '
  /^## \[/ {
    if (found) exit
    if (index($0, heading) == 1) { found = 1; next }
  }
  found { print }
' "$changelog"
