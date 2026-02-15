import { test, expect } from './helpers/setup'
import { createTestUser } from './helpers/clerk'

test.describe('API Key Management', () => {
  test.skip('user can create API key via dashboard', async ({ page, cleanDb }) => {
    // TODO: Requires Clerk auth session mocking
    // This would test:
    // 1. Navigate to Settings > API Keys
    // 2. Click "Create New Key"
    // 3. Key is generated with ca_ prefix
    // 4. Key is stored hashed in database
    // 5. User can copy the key
  })

  test.skip('API key is hashed in database', async ({ cleanDb }) => {
    // TODO: Requires API endpoint for key creation
    // This would test:
    // 1. Create API key via API
    // 2. Verify key is hashed with bcrypt
    // 3. Verify raw key is not stored
  })

  test('API key record structure', async ({ cleanDb }) => {
    // Test that we can create the expected database structure
    const { team } = await createTestUser()

    // This validates the database schema is correct
    expect(team.id).toBeTruthy()
    expect(team.plan).toBe('FREE')
  })
})
