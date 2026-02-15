// Validate environment variables before building
// Only validate in production builds (not during type generation)
if (process.env.NODE_ENV === 'production') {
  const { validateEnv } = require('./lib/env')
  validateEnv()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

module.exports = nextConfig
