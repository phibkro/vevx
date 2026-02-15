#!/bin/bash
set -e

echo "🚀 Migrating to Turborepo monorepo..."

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p apps/cli apps/action packages/{core,types,api-client,config}

# Move web to apps/web (already exists)
echo "📦 Moving web to apps/web..."
mv web apps/web 2>/dev/null || echo "web already in apps/"

# Move CLI source
echo "📦 Setting up CLI..."
if [ -d "src" ]; then
  mkdir -p apps/cli/src
  cp -r src/* apps/cli/src/
  echo "CLI source copied"
fi

# Move action files
echo "📦 Setting up GitHub Action..."
mkdir -p apps/action/src
if [ -f "src/action.ts" ]; then
  cp src/action.ts apps/action/src/index.ts
fi
if [ -d "src/github" ]; then
  cp -r src/github apps/action/src/
fi
if [ -f "action.yml" ]; then
  cp action.yml apps/action/
fi

# Create packages/config
echo "📦 Creating @code-auditor/config..."
cat > packages/config/package.json << 'EOF'
{
  "name": "@code-auditor/config",
  "version": "1.0.0",
  "files": ["tsconfig.base.json"]
}
EOF

cat > packages/config/tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
EOF

# Create packages/types
echo "📦 Creating @code-auditor/types..."
mkdir -p packages/types/src
cat > packages/types/package.json << 'EOF'
{
  "name": "@code-auditor/types",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
EOF

cat > packages/types/tsconfig.json << 'EOF'
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
EOF

# Extract types from src
if [ -f "src/agents/types.ts" ]; then
  cp src/agents/types.ts packages/types/src/agent.ts
  echo "export * from './agent'" > packages/types/src/index.ts
fi

# Create packages/core
echo "📦 Creating @code-auditor/core..."
mkdir -p packages/core/src
cat > packages/core/package.json << 'EOF'
{
  "name": "@code-auditor/core",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@code-auditor/types": "workspace:*",
    "@anthropic-ai/sdk": "^0.32.1"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
EOF

cat > packages/core/tsconfig.json << 'EOF'
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
EOF

# Copy agents to core
if [ -d "src/agents" ]; then
  cp -r src/agents packages/core/src/
fi
if [ -f "src/orchestrator.ts" ]; then
  cp src/orchestrator.ts packages/core/src/
fi
if [ -f "src/chunker.ts" ]; then
  cp src/chunker.ts packages/core/src/
fi
if [ -f "src/client.ts" ]; then
  cp src/client.ts packages/core/src/
fi

echo "export * from './agents'" > packages/core/src/index.ts

# Create packages/api-client
echo "📦 Creating @code-auditor/api-client..."
mkdir -p packages/api-client/src
cat > packages/api-client/package.json << 'EOF'
{
  "name": "@code-auditor/api-client",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@code-auditor/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
EOF

cat > packages/api-client/tsconfig.json << 'EOF'
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
EOF

cat > packages/api-client/src/index.ts << 'EOF'
// Placeholder - will be implemented
export {}
EOF

# Create CLI package.json
echo "📦 Creating CLI package.json..."
cat > apps/cli/package.json << 'EOF'
{
  "name": "@code-auditor/cli",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "code-audit": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build ./src/cli.ts --outdir ./dist --target bun",
    "build:binaries": "bun run build:darwin-arm64 && bun run build:darwin-x64 && bun run build:linux-x64 && bun run build:linux-arm64",
    "build:darwin-arm64": "bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile=dist/code-audit-darwin-arm64",
    "build:darwin-x64": "bun build src/cli.ts --compile --target=bun-darwin-x64 --outfile=dist/code-audit-darwin-x64",
    "build:linux-x64": "bun build src/cli.ts --compile --target=bun-linux-x64 --outfile=dist/code-audit-linux-x64",
    "build:linux-arm64": "bun build src/cli.ts --compile --target=bun-linux-arm64 --outfile=dist/code-audit-linux-arm64",
    "dev": "bun run src/cli.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@code-auditor/core": "workspace:*",
    "@code-auditor/types": "workspace:*",
    "@code-auditor/api-client": "workspace:*",
    "@anthropic-ai/sdk": "^0.32.1",
    "glob": "^10.3.10"
  },
  "devDependencies": {
    "@code-auditor/config": "workspace:*",
    "@types/bun": "latest",
    "typescript": "^5.4.5"
  }
}
EOF

# Create action package.json
echo "📦 Creating Action package.json..."
cat > apps/action/package.json << 'EOF'
{
  "name": "@code-auditor/action",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "bun build src/index.ts --outfile dist/action.js --target=node",
    "dev": "bun run src/index.ts"
  },
  "dependencies": {
    "@code-auditor/core": "workspace:*",
    "@code-auditor/types": "workspace:*",
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0",
    "@octokit/rest": "^20.0.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.4.5"
  }
}
EOF

echo "✅ Migration structure created!"
echo ""
echo "Next steps:"
echo "1. Review the changes"
echo "2. Run: bun install"
echo "3. Run: bun run build"
echo "4. Test each app"
