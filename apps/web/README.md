# AI Code Auditor - Web Dashboard

Team collaboration platform for tracking code quality metrics across your organization.

## Features

- Real-time code quality dashboard
- Historical audit tracking and trends
- Team management with role-based access
- API key management for CLI integration
- Stripe-powered subscriptions (Pro and Team plans)
- Automated audit syncing from CLI

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Auth**: Clerk (with team support)
- **Database**: PostgreSQL (via Prisma)
- **Payments**: Stripe
- **Hosting**: Vercel (recommended)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Clerk account (free tier works)
- Stripe account (test mode for development)

### 1. Database Setup

Create a PostgreSQL database:

```bash
# Local PostgreSQL
createdb code_auditor

# Or use a hosted service:
# - Supabase (free tier)
# - Railway (free tier)
# - Neon (free tier)
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/code_auditor"

# Clerk (from https://dashboard.clerk.com)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Stripe (from https://dashboard.stripe.com)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Database Migration

```bash
npx prisma db push
```

### 5. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Clerk Configuration

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Create a new application
3. Enable "Email" as a sign-in method
4. Copy the publishable and secret keys to `.env`
5. Set up webhook for user events:
   - Add webhook endpoint: `https://your-domain.com/api/webhooks/clerk`
   - Subscribe to: `user.created`, `user.updated`, `user.deleted`

## Stripe Configuration

### Development

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/products)
2. Create two products:
   - **Pro**: $29/month recurring
   - **Team**: $149/month recurring
3. Copy product/price IDs to `.env`
4. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
5. Forward webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
6. Copy webhook secret to `.env`

### Production

1. Create webhook endpoint: `https://your-domain.com/api/webhooks/stripe`
2. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
3. Copy webhook secret to production environment

## CLI Integration

The web dashboard works with the CLI tool. Users can:

1. Create an API key in Settings > API Keys
2. Set environment variable: `export CODE_AUDITOR_API_KEY=ca_xxx`
3. Run audits normally - they'll sync to the dashboard automatically

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

Vercel will automatically:
- Build the Next.js app
- Run Prisma migrations (if configured)
- Set up preview deployments

### Manual Deployment

```bash
npm run build
npm run start
```

## Database Management

### View data in Prisma Studio

```bash
npx prisma studio
```

### Reset database (development only)

```bash
npx prisma db push --force-reset
```

### Generate Prisma Client after schema changes

```bash
npx prisma generate
```

## Project Structure

```
web/
├── app/                    # Next.js app directory
│   ├── (auth)/            # Auth pages
│   ├── (dashboard)/       # Dashboard pages
│   ├── api/               # API routes
│   └── layout.tsx         # Root layout
├── components/
│   ├── ui/               # shadcn/ui components
│   └── dashboard/        # Custom components
├── lib/
│   ├── db/               # Prisma client
│   ├── stripe/           # Stripe helpers
│   ├── clerk/            # Auth helpers
│   └── utils.ts          # Utilities
├── prisma/
│   └── schema.prisma     # Database schema
└── public/               # Static assets
```

## Troubleshooting

### Database connection errors

- Check `DATABASE_URL` format
- Ensure PostgreSQL is running
- Verify credentials

### Clerk auth not working

- Check publishable key is `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Verify webhook endpoint is accessible
- Check Clerk dashboard for errors

### Stripe webhooks failing

- Ensure webhook secret matches
- Verify endpoint is accessible from internet
- Check Stripe dashboard event logs

## License

MIT
