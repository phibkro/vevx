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
