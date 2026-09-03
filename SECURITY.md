# Security Policy

<b>English</b> · <a href="SECURITY.ko.md">한국어</a>

## Supported versions

| Version | Supported |
| --- | --- |
| Latest release on `main` | Yes |
| Older releases | No, please upgrade |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Use GitHub's private vulnerability reporting instead:
<https://github.com/sistinafibel/otel-kit/security/advisories/new>

Include as much of the following as you can:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- The affected version(s)

You should receive an acknowledgement within 72 hours. We will keep you informed while we work on a fix and coordinate a disclosure date with you.

## Scope notes

otel-kit handles request metadata, error objects, and logs before they leave your process. Areas we consider security-relevant:

- Redaction of sensitive keys in the HTTP logger (`maskSensitiveData`, `DEFAULT_SENSITIVE_KEYS`)
- Bounded serialization of error objects (`toErrorLogRecord`)
- Trust boundaries for `X-Forwarded-For` / `X-Real-IP` (`trustedProxyCount`)
- Anything that could leak credentials from `OTEL_EXPORTER_OTLP_HEADERS`
