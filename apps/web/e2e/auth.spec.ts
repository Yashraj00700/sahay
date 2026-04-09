import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('invalid@test.com')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    // Should show error message
    await expect(page.getByText(/invalid credentials|unauthorized/i)).toBeVisible({ timeout: 5000 })
  })

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByRole('button', { name: /send reset/i })).toBeVisible()
  })

  test('reset password without token shows error', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByText(/invalid.*link|expired/i)).toBeVisible()
  })

  test('unauthenticated access to inbox redirects to login', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/login/)
  })
})
