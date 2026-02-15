#!/bin/bash

# AI Code Auditor - Development Setup Script
# This script sets up a local development environment

set -e  # Exit on error

echo "🚀 AI Code Auditor - Development Setup"
echo "======================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. You have version $NODE_VERSION"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"
echo ""

# Check for PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL not found."
    echo "   Install with: brew install postgresql"
    echo "   Or use a hosted database (Supabase, Railway, Neon)"
    echo ""
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your API keys:"
    echo "   - DATABASE_URL"
    echo "   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
    echo "   - CLERK_SECRET_KEY"
    echo "   - STRIPE_SECRET_KEY"
    echo "   - STRIPE_WEBHOOK_SECRET"
    echo ""
    read -p "Press enter when you've updated .env..."
else
    echo "✓ .env file exists"
fi

# Check if critical env vars are set
source .env 2>/dev/null || true

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set in .env"
    exit 1
fi

if [ -z "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" ] || [ -z "$CLERK_SECRET_KEY" ]; then
    echo "❌ Clerk API keys not set in .env"
    exit 1
fi

echo "✓ Environment variables configured"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Setup Prisma
echo "🗄️  Setting up database..."

# Generate Prisma client
npx prisma generate
echo "✓ Prisma client generated"

# Push schema to database
echo "Pushing database schema..."
npx prisma db push
echo "✓ Database schema applied"
echo ""

# Test database connection
echo "Testing database connection..."
if npx prisma db execute --stdin <<< "SELECT 1;" &> /dev/null; then
    echo "✓ Database connection successful"
else
    echo "❌ Database connection failed"
    echo "   Check your DATABASE_URL in .env"
    exit 1
fi
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start development server: npm run dev"
echo "  2. Open http://localhost:3000"
echo "  3. Create an account and team"
echo "  4. Generate an API key in Settings"
echo "  5. Test CLI integration"
echo ""
echo "Optional tools:"
echo "  - View database: npx prisma studio"
echo "  - Stripe CLI: stripe listen --forward-to localhost:3000/api/webhooks/stripe"
echo ""
echo "Happy coding! 🎉"
