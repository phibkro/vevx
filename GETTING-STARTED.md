# Getting Started with AI Code Auditor

Welcome! This guide will get you up and running with both the CLI tool and web dashboard.

## Project Overview

AI Code Auditor is a multi-agent code quality analysis tool with two main components:

1. **CLI Tool** - Analyze code from your terminal
2. **Web Dashboard** - Track quality trends and collaborate with your team

## Quick Start (CLI Only)

If you just want to use the CLI tool without the web dashboard:

### Prerequisites
- Bun or Node.js 18+
- Anthropic API key

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-code-auditor.git
cd ai-code-auditor

# Install dependencies
bun install

# Set your API key
export ANTHROPIC_API_KEY='sk-ant-...'

# Run your first audit
bun run src/cli.ts src/
```

That's it! You'll get a detailed code quality report in your terminal.

## Full Setup (CLI + Web Dashboard)

To unlock team features, historical tracking, and the web dashboard:

### Prerequisites
- Node.js 18+
- PostgreSQL database (local or hosted)
- Clerk account (free at https://clerk.com)
- Stripe account (test mode is fine)

### 1. CLI Setup

Follow the Quick Start above to set up the CLI tool.

### 2. Web Dashboard Setup

```bash
cd web

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys (see below)

# Initialize database
npx prisma db push

# Start development server
npm run dev
```

Visit http://localhost:3000

### 3. Get API Keys

You'll need accounts and API keys from:

**Clerk** (Authentication)
1. Sign up at https://dashboard.clerk.com
2. Create a new application
3. Copy publishable key → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. Copy secret key → `CLERK_SECRET_KEY`

**Stripe** (Payments)
1. Sign up at https://dashboard.stripe.com
2. Toggle to "Test mode"
3. Get keys from Developers > API keys
4. Copy secret key → `STRIPE_SECRET_KEY`
5. Set up webhook (see SETUP-PHASE3.md)

**Database** (PostgreSQL)
- Local: `postgresql://localhost:5432/code_auditor`
- Or use hosted (Supabase, Railway, Neon - all have free tiers)

### 4. Environment Variables

Edit `web/.env`:

```env
DATABASE_URL="postgresql://localhost:5432/code_auditor"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 5. Test the Integration

1. **Create an account** at http://localhost:3000/sign-up
2. **Generate an API key** in Settings > API Keys
3. **Set the key** in your terminal:
   ```bash
   export CODE_AUDITOR_API_KEY=ca_your_key_here
   ```
4. **Run an audit** from the CLI:
   ```bash
   cd .. # Back to project root
   bun run src/cli.ts src/
   ```
5. **View in dashboard** - Click the URL printed by the CLI

## What's Next?

### Learn the Basics
- Read [README.md](README.md) for CLI usage and features
- Read [web/README.md](web/README.md) for dashboard features
- Read [QUICK-REFERENCE.md](web/QUICK-REFERENCE.md) for common commands

### Detailed Setup
- [SETUP-PHASE3.md](SETUP-PHASE3.md) - Complete setup guide
- [DEPLOYMENT-CHECKLIST.md](web/DEPLOYMENT-CHECKLIST.md) - Production deployment

### Development
- [PHASE3-IMPLEMENTATION.md](PHASE3-IMPLEMENTATION.md) - Technical deep-dive
- [web/QUICK-REFERENCE.md](web/QUICK-REFERENCE.md) - Developer commands

## Common Use Cases

### Solo Developer
```bash
# Just use the CLI
export ANTHROPIC_API_KEY='...'
bun run src/cli.ts src/

# Optional: sync to dashboard for historical tracking
export CODE_AUDITOR_API_KEY='...'
```

### Small Team (2-5 people)
1. Set up web dashboard
2. Upgrade to Team plan ($149/mo)
3. Each team member creates their own API key
4. All audits sync to shared dashboard
5. Track quality trends over time

### Enterprise
1. Deploy to production (Vercel)
2. Configure SSO (Clerk supports SAML)
3. Integrate with CI/CD (GitHub Actions)
4. Set up Slack/Discord notifications
5. Custom integrations via API

## Architecture Overview

```
ai-code-auditor/
├── src/              # CLI tool (TypeScript)
│   ├── agents/       # 5 specialized AI agents
│   ├── report/       # Report generation
│   └── cli.ts        # Main entry point
├── web/              # Next.js dashboard
│   ├── app/          # Pages and API routes
│   ├── components/   # React components
│   ├── lib/          # Database, auth, payments
│   └── prisma/       # Database schema
└── docs/             # Documentation
```

## Pricing Tiers

### Free
- 5 audits per month
- CLI access
- Basic dashboard
- Public repos only

### Pro ($29/month)
- Unlimited audits
- Private repos
- Advanced analytics
- Priority support

### Team ($149/month)
- Everything in Pro
- 5 team members
- Team dashboard
- Audit history
- Compliance reports

### Enterprise (Custom)
- Unlimited everything
- SSO support
- Custom integrations
- Dedicated support

## Troubleshooting

### CLI Issues

**"ANTHROPIC_API_KEY environment variable is not set"**
```bash
export ANTHROPIC_API_KEY='sk-ant-...'
# Or add to ~/.zshrc for persistence
```

**"Error: Cannot find module"**
```bash
bun install
```

### Dashboard Issues

**"Database connection failed"**
- Check `DATABASE_URL` in `.env`
- Ensure PostgreSQL is running: `brew services start postgresql`
- Test connection: `psql $DATABASE_URL -c "SELECT 1;"`

**"Clerk auth not working"**
- Verify environment variables are set
- Check `NEXT_PUBLIC_` prefix for client-side variables
- Clear browser cookies and try again

**"Stripe checkout fails"**
- Ensure using test mode keys
- Use test card: `4242 4242 4242 4242`
- Check webhook secret matches

### Need Help?

1. Check [QUICK-REFERENCE.md](web/QUICK-REFERENCE.md) for common commands
2. Read [SETUP-PHASE3.md](SETUP-PHASE3.md) for detailed setup
3. Review error messages carefully (they often include the fix)
4. Check service status pages (Clerk, Stripe, Vercel)

## Resources

### Documentation
- [CLI Usage](README.md)
- [Web Dashboard](web/README.md)
- [Setup Guide](SETUP-PHASE3.md)
- [Quick Reference](web/QUICK-REFERENCE.md)
- [Deployment](web/DEPLOYMENT-CHECKLIST.md)

### External Services
- [Clerk Docs](https://clerk.com/docs)
- [Stripe Docs](https://stripe.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [Tailwind Docs](https://tailwindcss.com/docs)

### Community
- GitHub Issues (report bugs)
- GitHub Discussions (ask questions)
- Discord (coming soon)

## Contributing

We welcome contributions! Here's how:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `bun test` (when available)
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- 📧 Email: support@code-auditor.com (coming soon)
- 💬 Discord: https://discord.gg/... (coming soon)
- 🐛 Issues: https://github.com/yourusername/ai-code-auditor/issues

---

**Ready to improve your code quality?**

Start with the CLI Quick Start above, then explore the web dashboard when you're ready for team features!
