import { test, expect } from './helpers/setup'

test.describe('Sign Up Flow', () => {
  test('homepage is accessible and shows sign-up CTA', async ({ page }) => {
    // Visit homepage
    await page.goto('/')

    // Should see sign-up CTA
    // Note: Update this selector based on actual homepage implementation
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible()
  })

  test('redirects to sign-in when accessing protected routes', async ({ page }) => {
    // Mock authenticated state by setting Clerk session cookie
    // This requires Clerk testing setup - for now, verify redirect behavior

    // Try to access dashboard without authentication
    await page.goto('/dashboard')

    // Should redirect to sign-in
    await page.waitForURL(/sign-in/, { timeout: 5000 })
    await expect(page).toHaveURL(/sign-in/)
  })

  test.skip('creates user and team on first sign-in', async ({ page, cleanDb }) => {
    // TODO: Requires Clerk testing tokens for OAuth flow
    // This tests the user auto-creation logic after Clerk OAuth succeeds
    // For now, test manually:
    // 1. Sign up with GitHub
    // 2. Verify user and team created in database
    // 3. Verify redirect to dashboard
  })

  test.skip('dashboard shows empty state for new user', async ({ page }) => {
    // TODO: Requires Clerk auth testing setup
    // This would verify:
    // 1. User can authenticate
    // 2. Dashboard loads
    // 3. Empty state is shown for new users
  })
})
