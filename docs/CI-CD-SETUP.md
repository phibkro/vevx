# CI/CD

## Workflows (`.github/workflows/`)

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | PR + push to main | Test, lint, coverage, Vercel deploy |
| `code-audit.yml` | PR | Self-audit via own tool |
| `self-audit.yml` | Push to main | Dogfood audit |

### CI Jobs

1. **Test & Lint** — `bun run test` + `bun run lint` (~7min)
2. **Coverage** — uploads to Codecov (no threshold enforced yet)
3. **Deploy Preview** — Vercel preview on PRs
4. **Deploy Production** — Vercel production on push to main
5. **E2E** — disabled (`if: false`), needs live DB + Redis

## Secrets

**Required for deployment**: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

**Optional**: `CODECOV_TOKEN`, `ANTHROPIC_API_KEY` (for self-audit)

**E2E (when enabled)**: `CI_DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

## Branch Protection (manual)

Settings → Branches → `main`: require PR, require `Test & Lint` + `Coverage Check` to pass, require up-to-date branch.
