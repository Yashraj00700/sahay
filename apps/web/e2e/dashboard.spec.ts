import { test, expect } from '@playwright/test'

// These tests use a pre-authenticated state (if available)
test.describe('Dashboard (unauthenticated)', () => {
  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })
})
