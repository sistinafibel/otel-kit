# 보안 정책

<a href="SECURITY.md">English</a> · <b>한국어</b>

## 지원 버전

| 버전 | 지원 여부 |
| --- | --- |
| `main`의 최신 릴리스 | 지원 |
| 이전 릴리스 | 미지원, 업그레이드해 주세요 |

## 취약점 신고

보안 문제는 **공개 GitHub 이슈로 올리지 마세요.**

GitHub의 비공개 취약점 신고를 이용해 주세요:
<https://github.com/sistinafibel/otel-kit/security/advisories/new>

가능한 한 다음 내용을 포함해 주세요.

- 문제 설명과 영향 범위
- 재현 절차 또는 개념 증명(PoC)
- 영향을 받는 버전

72시간 안에 접수 확인을 드립니다. 수정 작업 진행 상황을 공유하고 공개 시점을 함께 조율하겠습니다.

## 범위 안내

otel-kit은 요청 메타데이터, 오류 객체, 로그가 프로세스를 떠나기 전에 처리합니다. 보안과 관련 있다고 보는 영역은 다음과 같습니다.

- HTTP 로거의 민감 키 마스킹 (`maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS`)
- 크기가 제한된 오류 객체 직렬화 (`toErrorLogRecord`)
- `X-Forwarded-For` / `X-Real-IP`의 신뢰 경계 (`trustedProxyCount`)
- `OTEL_EXPORTER_OTLP_HEADERS`의 자격 증명이 유출될 수 있는 모든 경로
