# Contributing to otel-kit

<b>English</b> · <a href="CONTRIBUTING.ko.md">한국어</a>

Thanks for taking the time to contribute! This guide covers everything you need to get a change from idea to merged PR.

## Before you start

- Check the [issue tracker](https://github.com/sistinafibel/otel-kit/issues) for existing discussions.
- For anything larger than a bug fix, open an issue first so we can agree on the approach before you invest time.
- Security issues: **do not** open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22+ and npm 11+ (an `.nvmrc` is included).

```bash
git clone https://github.com/sistinafibel/otel-kit.git
cd otel-kit
npm ci
npm run typecheck
npm test
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Compile `src/` to `dist/` with `tsconfig.build.json` |
| `npm run typecheck` | Type-check the whole project including tests |
| `npm test` | Run the Jest suite |
| `npm run test:cov` | Run tests with a coverage report |
| `npm run test:ci` | Same as CI: coverage + `--runInBand` |

## Project layout

```
src/
├── index.ts                 # Public, framework-agnostic entry point
├── nest.ts                  # NestJS-only entry point (@sistinafibel/otel-kit/nest)
├── register.ts              # Preload entry point (--require ...otel-kit/register)
├── init-observability.ts    # SDK bootstrap: providers, exporters, samplers, resource
├── tracing.ts               # runWithSpan helper
├── error-record.ts          # Safe, bounded error -> log record serialization
├── error-telemetry.ts       # captureError / recordErrorOnSpan
├── metrics.ts               # getMeter
├── trace-context.ts         # getActiveTraceId / getActiveSpanId
├── http/                    # HTTP logger + client IP helpers (framework-agnostic)
├── nest/                    # NestJS middleware / interceptor wrappers
├── winston/                 # Winston OTLP transport factory
└── __tests__/               # Jest specs (one per module)
```

## Making changes

1. Create a branch from `main`: `git checkout -b feat/my-change`.
2. Write or update tests first. The coverage gate is **80% lines/statements** and CI enforces it.
3. Keep the public API surface small and stable. Anything exported from `src/index.ts` or `src/nest.ts` is a public contract.
4. Follow the existing style: strict TypeScript, immutable data (return new objects, do not mutate inputs), small focused files.
5. Add a line to the **Unreleased** section of [CHANGELOG.md](CHANGELOG.md).
6. Run the full check before pushing:

   ```bash
   npm run typecheck && npm run build && npm run test:ci && npm pack --dry-run
   ```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary>

<optional body explaining why>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Pull requests

- One logical change per PR.
- Fill in the PR template. Describe *why*, not only *what*.
- CI must be green on Node 22 and 24.
- A maintainer will review and may request changes. Please keep the conversation in the PR.

## Releasing (maintainers)

1. Update `version` in `package.json` and move **Unreleased** entries under the new version in `CHANGELOG.md`.
2. Commit, then tag: `git tag v1.2.3 && git push --tags`.
3. The [release workflow](.github/workflows/release.yml) verifies the tag matches the package version and publishes to npm via Trusted Publishing (OIDC). No npm token is stored in the repository.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
