# Phase 3 Setup Guide - Web Dashboard

Complete setup instructions for deploying the AI Code Auditor web dashboard.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database (local or hosted)
- Clerk account (free tier: https://clerk.com)
- Stripe account (test mode for development)
- Git repository for the project

## Step 1: Database Setup

### Option A: Local PostgreSQL

```bash
# macOS (Homebrew)
brew install postgresql
brew services start postgresql

# Create database
createdb code_auditor
```

### Option B: Hosted Database (Recommended for production)

Choose one:
- **Supabase** (https://supabase.com) - Free tier available
- **Railway** (https://railway.app) - Free tier available
- **Neon** (https://neon.tech) - Free tier available

Get your database URL (format: `postgresql://user:pass@host:port/dbname`)

## Step 2: Clerk Configuration

1. Create account at https://dashboard.clerk.com
2. Click "Add application"
3. Name it "AI Code Auditor"
4. Enable "Email" sign-in method
5. Copy API keys from dashboard

### Environment Variables

Copy these from Clerk dashboard:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### Webhook Setup (for user sync)

1. In Clerk Dashboard, go to "Webhooks"
2. Click "Add Endpoint"
3. URL: `https://your-domain.com/api/webhooks/clerk` (or use ngrok for local dev)
4. Subscribe to events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
5. Copy webhook signing secret (you'll need this later)

## Step 3: Stripe Configuration

### Create Products

1. Go to https://dashboard.stripe.com/test/products
2. Create "Pro" product:
   - Name: AI Code Auditor Pro
   - Price: $29/month (recurring)
   - Copy Price ID
3. Create "Team" product:
   - Name: AI Code Auditor Team
   - Price: $149/month (recurring)
   - Copy Price ID

### Webhook Setup

#### Development (using Stripe CLI)

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Copy the webhook signing secret (whsec_...)
```

#### Production

1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy webhook signing secret

### Environment Variables

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...
```

## Step 4: Web App Setup

Navigate to the web directory:

```bash
cd web
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with all your values:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/code_auditor"

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Initialize Database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push
```

### Start Development Server

```bash
npm run dev
```

Visit http://localhost:3000

## Step 5: Test the Flow

### 1. Create Account

1. Go to http://localhost:3000
2. Click "Sign Up"
3. Create account with email
4. Verify you're redirected to dashboard

### 2. Verify Database

```bash
# Open Prisma Studio
npx prisma studio
```

Check that:
- User was created
- Team was created
- TeamMember link was created

### 3. Create API Key

1. In dashboard, go to Settings > API Keys
2. Click "Create New Key"
3. Copy the key (starts with `ca_`)

### 4. Test CLI Integration

In the root project directory (not `web/`):

```bash
# Set API key
export CODE_AUDITOR_API_KEY=ca_...

# Run an audit
bun run src/cli.ts src/

# Should see: "View in dashboard: http://localhost:3000/audits/..."
```

### 5. Verify Dashboard

1. Go back to http://localhost:3000/dashboard
2. Should see your audit in "Recent Audits"
3. Click "View" to see full report

### 6. Test Stripe (Optional)

1. Go to Team page
2. Click "Upgrade to Pro"
3. Use test card: `4242 4242 4242 4242`
4. Any future expiry, any CVC
5. Complete checkout
6. Verify plan changed to PRO

## Step 6: Production Deployment

### Option A: Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel: https://vercel.com/new
3. Add all environment variables from `.env`
4. Update `NEXT_PUBLIC_APP_URL` to your Vercel domain
5. Deploy

### Option B: Manual Deployment

```bash
# Build the app
npm run build

# Start production server
npm run start
```

### Post-Deployment

1. Update Clerk webhook URL to production domain
2. Update Stripe webhook URL to production domain
3. Update `CODE_AUDITOR_API_URL` in CLI usage (optional, defaults to https://code-auditor.com)

## Step 7: Team Usage

### Invite Team Members

1. Upgrade to Team plan ($149/mo)
2. Go to Team page
3. Click "Invite Member"
4. Enter email
5. They'll receive invite via Clerk

### CLI Setup for Team

Each team member:

```bash
# Create their own API key in Settings
# Set environment variable
export CODE_AUDITOR_API_KEY=ca_their_key_here

# Run audits - they sync to shared team dashboard
bun run src/cli.ts src/
```

## Troubleshooting

### Database Connection Errors

```bash
# Test connection
psql $DATABASE_URL

# Reset database (development only!)
npx prisma db push --force-reset
```

### Clerk Auth Not Working

- Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts with `pk_`
- Check middleware.ts is protecting routes
- Ensure webhook is receiving events (check Clerk dashboard)

### Stripe Webhooks Failing

```bash
# Check webhook secret matches
echo $STRIPE_WEBHOOK_SECRET

# View recent webhook attempts in Stripe dashboard
# Look for signature verification errors
```

### API Key Not Working

- Verify key starts with `ca_`
- Check it hasn't been revoked
- Ensure `CODE_AUDITOR_API_KEY` environment variable is set
- Try creating a new key

### Audit Not Syncing

```bash
# Check API URL
echo $CODE_AUDITOR_API_URL

# Test endpoint manually
curl -X POST https://your-domain.com/api/cli/audit \
  -H "Authorization: Bearer $CODE_AUDITOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"overallScore": 85, "criticalCount": 0, "warningCount": 2, "infoCount": 5, "durationMs": 5000, "findings": []}'
```

## Next Steps

- Set up GitHub Actions integration (see WAVE3-COMPLETE.md)
- Configure Slack/Discord notifications
- Set up analytics and monitoring
- Create team playbooks and quality standards

## Support

- Clerk: https://clerk.com/docs
- Stripe: https://stripe.com/docs
- Prisma: https://www.prisma.io/docs
- Next.js: https://nextjs.org/docs
