# Deployment Guide

Instructions for deploying AI Code Auditor components to production.

## CLI Binary Distribution

### Building Binaries

The CLI can be compiled to standalone executables for distribution:

```bash
cd apps/cli

# Build for specific platform
bun run build:darwin-arm64   # macOS Apple Silicon
bun run build:darwin-x64     # macOS Intel
bun run build:linux-x64      # Linux x86_64
bun run build:linux-arm64    # Linux ARM64

# Build all platforms
bun run build:binaries
```

Binaries are output to `apps/cli/dist/`:
- `code-audit-darwin-arm64` (~57MB)
- `code-audit-darwin-x64` (~63MB)
- `code-audit-linux-x64` (~100MB)
- `code-audit-linux-arm64` (~94MB)

### Distribution

**GitHub Releases**:
1. Create release tag (e.g., `v1.0.0`)
2. Build binaries for all platforms
3. Upload binaries as release assets
4. Users download platform-specific binary
5. Make executable: `chmod +x code-audit-*`

**Package managers** (future):
- Homebrew: Create tap with formula
- npm: Publish CLI wrapper that downloads binary
- Cargo: Distribute via crates.io

### Binary Requirements

Users need:
- macOS 11+ (for darwin builds)
- glibc 2.31+ (for linux builds)
- `ANTHROPIC_API_KEY` environment variable

No other dependencies - everything is bundled.

## Web Dashboard (Vercel)

### Prerequisites

- Vercel account connected to GitHub
- PostgreSQL database (Neon, Supabase, or self-hosted)
- Clerk account for authentication
- Stripe account for payments
- Upstash Redis account for rate limiting

### Environment Variables

Set these in Vercel dashboard (Settings → Environment Variables):

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...

# Stripe Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Upstash Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# App Configuration
NEXT_PUBLIC_APP_URL=https://your-domain.com
NODE_ENV=production
```

### Deployment Steps

#### Option 1: Automatic (Recommended)

1. **Connect repository** to Vercel
2. **Configure project**:
   - Framework: Next.js
   - Root Directory: `apps/web`
   - Build Command: `cd ../.. && bun run build && cd apps/web && bun run build`
   - Install Command: `bun install`
3. **Set environment variables** (see above)
4. **Deploy**: Push to `main` branch triggers automatic deployment

#### Option 2: Manual

```bash
cd apps/web

# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy to production
vercel --prod
```

### Database Setup

```bash
cd apps/web

# Run migrations (first deploy only)
bunx prisma migrate deploy

# Or push schema (development)
bunx prisma db push
```

### Post-Deployment

1. **Verify deployment**: Check Vercel deployment logs
2. **Test authentication**: Sign up with test account
3. **Configure webhooks**:
   - Clerk: Set webhook URL to `https://your-domain.com/api/webhooks/clerk`
   - Stripe: Set webhook URL to `https://your-domain.com/api/webhooks/stripe`
4. **Test payment flow**: Upgrade test account
5. **Monitor**: Check Vercel analytics and error logs

### Monorepo Configuration

The repository includes `vercel.json` at root:

```json
{
  "buildCommand": "cd apps/web && bun run build",
  "devCommand": "cd apps/web && bun run dev",
  "installCommand": "bun install",
  "framework": "nextjs",
  "outputDirectory": "apps/web/.next"
}
```

This ensures Vercel builds from the monorepo correctly.

### Database Migrations

**Production migrations**:
```bash
# Create migration
cd apps/web
bunx prisma migrate dev --name <migration-name>

# Deploy to production
bunx prisma migrate deploy
```

**Rolling back**:
```sql
-- Connect to database
-- Manually revert schema changes
-- Update _prisma_migrations table
```

## GitHub Action

### Publishing to GitHub Marketplace

The GitHub Action can be published to the marketplace for easy discovery:

1. **Create action.yml** in repository root
2. **Bundle action**: `cd apps/action && bun run build`
3. **Commit dist/action.js**: Required for action distribution
4. **Create release**: Tag with `v1`, `v1.0`, `v1.0.0`
5. **Publish**: GitHub Actions tab → Draft a release → Publish to Marketplace

### User Setup

Users add the action to their workflows:

```yaml
# .github/workflows/code-audit.yml
name: Code Quality Audit
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Action Distribution

**Important**: The `dist/action.js` file must be committed to the repository. This is an exception to the usual "don't commit build artifacts" rule for GitHub Actions.

The `.gitignore` explicitly allows it:
```
dist/
!dist/action.js
```

## Monitoring

### Vercel

- **Deployment logs**: Vercel dashboard → Deployments → Logs
- **Runtime logs**: Vercel dashboard → Logs
- **Analytics**: Vercel dashboard → Analytics
- **Error tracking**: Consider Sentry integration

### Database

- **Connection pooling**: Use Prisma Data Proxy or PgBouncer
- **Query performance**: Monitor slow queries
- **Backup**: Regular automated backups (Neon includes this)

### Rate Limiting

Monitor Upstash Redis usage:
- Request counts per endpoint
- Rate limit hits
- Memory usage

## Scaling Considerations

### Database

- **Connection limits**: Prisma connection pooling (5-10 connections)
- **Read replicas**: For high read volumes
- **Indexes**: Monitor query performance, add indexes as needed

### API Rate Limits

Current limits (see `apps/web/lib/rate-limit.ts`):
- Webhooks: 100/minute per IP
- Audits: 10/minute per API key
- Key operations: 5/minute per user

Adjust based on usage patterns.

### Claude API

- **Rate limits**: Anthropic has tier-based rate limits
- **Costs**: Monitor API usage and costs per audit
- **Caching**: Consider caching repeated code analysis

## Security Checklist

Before production:

- [ ] All environment variables use production values (not test keys)
- [ ] Database has SSL enabled
- [ ] Webhook secrets are properly configured
- [ ] Rate limiting is enabled on all public endpoints
- [ ] API keys are hashed with bcrypt (never stored plain)
- [ ] CORS is properly configured (if applicable)
- [ ] CSP headers are set
- [ ] Audit logs are enabled for sensitive operations
- [ ] Backup strategy is in place

## Rollback Procedure

If a deployment causes issues:

1. **Vercel**: Revert to previous deployment via dashboard
2. **Database**: Restore from backup if schema changed
3. **Monitoring**: Check error rates return to normal
4. **Communication**: Notify users of downtime/issues

## Cost Estimation

**Vercel** (Pro plan):
- $20/month base
- Additional for bandwidth/builds

**Database** (Neon Free):
- Free tier: 0.5GB storage, 1M rows
- Pro: $19/month for 10GB

**Clerk** (Free):
- Free tier: 10k MAU
- Pro: $25/month

**Stripe**:
- 2.9% + 30¢ per transaction

**Upstash** (Free):
- Free tier: 10k commands/day
- Pro: $0.2 per 100k commands

**Anthropic API**:
- Varies by model and usage
- Sonnet 4.5: $3/million input tokens, $15/million output tokens
- Typical audit: $0.01-0.10 depending on codebase size

## Maintenance

### Regular Tasks

- **Monitor error rates**: Check Vercel logs weekly
- **Review database performance**: Monthly query analysis
- **Update dependencies**: Monthly security updates
- **Backup verification**: Test restore procedure quarterly
- **Cost review**: Monthly cost analysis

### Version Updates

When updating major versions:

1. Test in staging environment
2. Announce maintenance window
3. Deploy during low-traffic period
4. Monitor error rates closely
5. Keep rollback plan ready

## Support

For deployment issues:
- Vercel: https://vercel.com/support
- Neon: https://neon.tech/docs
- Clerk: https://clerk.com/support
- Stripe: https://support.stripe.com
