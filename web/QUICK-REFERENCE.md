# Quick Reference Guide

Common commands and operations for the AI Code Auditor web dashboard.

## Development

### Start Development Server
```bash
npm run dev
```
Visit http://localhost:3000

### Database Operations

```bash
# View database in GUI
npx prisma studio

# Apply schema changes
npx prisma db push

# Generate Prisma client after schema changes
npx prisma generate

# Reset database (DESTRUCTIVE - dev only!)
npx prisma db push --force-reset
```

### Build and Test

```bash
# Build for production
npm run build

# Start production server
npm run start

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## Stripe Testing

### Start Webhook Forwarding (Development)
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### Test Card Numbers
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3D Secure: `4000 0027 6000 3184`

Use any future expiry date and any CVC.

## Database Queries

### Common Prisma Studio Queries

Find user by email:
```
User.findUnique({ where: { email: "user@example.com" }})
```

Get team's audits:
```
Audit.findMany({ where: { teamId: "..." }, orderBy: { createdAt: "desc" }})
```

Count audits this month:
```
Audit.count({ where: {
  teamId: "...",
  createdAt: { gte: new Date("2024-01-01") }
}})
```

## API Testing

### Test CLI Endpoint
```bash
curl -X POST http://localhost:3000/api/cli/audit \
  -H "Authorization: Bearer ca_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "test/repo",
    "commit": "abc123",
    "branch": "main",
    "overallScore": 85,
    "criticalCount": 0,
    "warningCount": 2,
    "infoCount": 5,
    "durationMs": 5000,
    "findings": []
  }'
```

### Test Webhook Endpoint
```bash
# Stripe webhook (needs valid signature)
stripe trigger checkout.session.completed

# Clerk webhook (use dashboard to send test event)
```

## Environment Variables

### Required for Development
```env
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Optional
```env
STRIPE_PRO_PRICE_ID="price_..."
STRIPE_TEAM_PRICE_ID="price_..."
```

## Common Issues

### Database Connection Failed
```bash
# Check DATABASE_URL format
echo $DATABASE_URL

# Test PostgreSQL connection
psql $DATABASE_URL -c "SELECT 1;"

# Restart PostgreSQL
brew services restart postgresql
```

### Clerk Auth Not Working
- Clear browser cookies/cache
- Verify `NEXT_PUBLIC_` prefix for client-side variables
- Check middleware.ts is running
- Ensure Clerk webhook is receiving events

### Stripe Webhooks Timing Out
- Check webhook signing secret matches
- Verify endpoint is accessible (use ngrok for local dev)
- Check Stripe dashboard for event logs
- Ensure webhook handler doesn't take > 30s

### API Key Not Authenticating
- Verify key starts with `ca_`
- Check it hasn't been revoked in settings
- Ensure using `Bearer` prefix in Authorization header
- Try generating a new key

## Deployment

### Vercel Deploy
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Deploy to production
vercel --prod
```

### Environment Variables (Vercel)
```bash
# Set via CLI
vercel env add DATABASE_URL

# Or use Vercel dashboard
# Settings > Environment Variables
```

### Update Production
```bash
# Push to main branch (auto-deploys)
git push origin main

# Or manual deploy
vercel --prod
```

## Monitoring

### Check Application Logs
```bash
# Vercel
vercel logs

# Local
# Logs print to terminal where npm run dev is running
```

### Database Performance
```bash
# Prisma query logging (add to schema.prisma)
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  log      = ["query", "info", "warn", "error"]
}
```

### Webhook Status

**Stripe**: https://dashboard.stripe.com/webhooks
- Check recent events
- View delivery attempts
- See error logs

**Clerk**: https://dashboard.clerk.com/webhooks
- Check event delivery
- View payload and response
- Debug failures

## User Management

### Create Test User (Development)
1. Go to http://localhost:3000/sign-up
2. Use a + email alias: `your.email+test@gmail.com`
3. Complete signup
4. User and team auto-created via webhook

### Delete User
```bash
# Via Prisma Studio
User.delete({ where: { email: "..." }})

# Or in Clerk dashboard
# This triggers webhook that cleans up database
```

### Change Team Plan Manually (Testing)
```bash
# Via Prisma Studio
Team.update({
  where: { id: "..." },
  data: { plan: "PRO" }
})
```

## CLI Integration

### Set API Key (User)
```bash
export CODE_AUDITOR_API_KEY=ca_your_key_here

# Make permanent
echo 'export CODE_AUDITOR_API_KEY=ca_your_key_here' >> ~/.zshrc
source ~/.zshrc
```

### Test CLI Sync
```bash
cd /path/to/ai-code-auditor
bun run src/cli.ts src/

# Should see:
# "📊 View in dashboard: http://localhost:3000/audits/..."
```

## Maintenance

### Update Dependencies
```bash
# Check outdated packages
npm outdated

# Update all (careful!)
npm update

# Update specific package
npm install package@latest
```

### Prisma Migrations (Production)
```bash
# Create migration
npx prisma migrate dev --name description

# Apply migrations (production)
npx prisma migrate deploy
```

### Database Backup
```bash
# PostgreSQL dump
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

## Useful Commands

### Generate API Key Manually
```bash
# In Node.js REPL
node
> require('crypto').randomBytes(32).toString('hex')
'abc123...'
> .exit

# Full key format
ca_abc123...
```

### Hash API Key (for testing)
```bash
node
> const bcrypt = require('bcryptjs')
> bcrypt.hashSync('ca_abc123...', 10)
'$2a$10$...'
```

### Format Code
```bash
# Install Prettier
npm install -D prettier

# Format all files
npx prettier --write .
```

## Resources

- Next.js: https://nextjs.org/docs
- Prisma: https://www.prisma.io/docs
- Clerk: https://clerk.com/docs
- Stripe: https://stripe.com/docs
- shadcn/ui: https://ui.shadcn.com
- Tailwind: https://tailwindcss.com/docs

## Support

### Where to Get Help
- Clerk Discord: https://clerk.com/discord
- Stripe Support: support@stripe.com
- Vercel Support: https://vercel.com/support
- Next.js Discussions: https://github.com/vercel/next.js/discussions

### Common Gotchas
1. Environment variables must start with `NEXT_PUBLIC_` for client-side access
2. Prisma schema changes require `npx prisma generate` AND `npx prisma db push`
3. Stripe webhooks need exact signature match (regenerate on endpoint change)
4. Clerk middleware runs on all routes except those in `isPublicRoute()`
5. API routes are server-side only (can't access from client without fetch)
