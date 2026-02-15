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
