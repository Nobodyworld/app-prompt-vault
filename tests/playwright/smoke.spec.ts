import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the Prompt Vault desktop application
 * These tests verify basic functionality and UI elements are working
 */

test.describe('Desktop App Smoke Tests', () => {
    test('should load the application', async ({ page }) => {
        await page.goto('/');

        // Check that the app loaded by looking for the title
        await expect(page).toHaveTitle('Prompt Vault Desktop');

        // Check for main app header
        const header = page.locator('h1:has-text("Prompt Vault")');
        await expect(header).toBeVisible();
    });

    test('should display main navigation', async ({ page }) => {
        await page.goto('/');

        // Check for navigation links
        const libraryLink = page.locator('nav a:has-text("Library")');
        const createLink = page.locator('nav a:has-text("Create")');

        await expect(libraryLink).toBeVisible();
        await expect(createLink).toBeVisible();
    });

    test('should display sidebar elements', async ({ page }) => {
        await page.goto('/');

        // Check for sidebar elements
        const settingsIcon = page.locator('.sidebar-icon[title="Settings"]');
        const profileIcon = page.locator('.sidebar-profile[title="Profile"]');

        await expect(settingsIcon).toBeVisible();
        await expect(profileIcon).toBeVisible();
    });

    test('should navigate between pages', async ({ page }) => {
        await page.goto('/');

        // Click on Create link
        await page.locator('nav a:has-text("Create")').click();

        // Should navigate to create page (check URL)
        await expect(page).toHaveURL(/.*\/create/);

        // Click on Library link
        await page.locator('nav a:has-text("Library")').click();

        // Should navigate back to home
        await expect(page).toHaveURL(/.*\/$/);
    });

    test('should handle basic interactions', async ({ page }) => {
        await page.goto('/');

        // Test that basic interactions work (keyboard shortcuts may not work in test environment)
        // Test Escape key handling - should not crash the app
        await page.keyboard.press('Escape');

        // App should still be functional after keyboard input
        const header = page.locator('h1:has-text("Prompt Vault")');
        await expect(header).toBeVisible();

        // Test that clicking navigation works
        await page.locator('nav a:has-text("Create")').click();
        await expect(page).toHaveURL(/.*\/create/);

        // Navigate back
        await page.locator('nav a:has-text("Library")').click();
        await expect(page).toHaveURL(/.*\/$/);
    });

    test('should be responsive on different viewport sizes', async ({ page }) => {
        await page.goto('/');

        // Test mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await expect(page.locator('h1:has-text("Prompt Vault")')).toBeVisible();

        // Test tablet viewport
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(page.locator('h1:has-text("Prompt Vault")')).toBeVisible();

        // Test desktop viewport
        await page.setViewportSize({ width: 1920, height: 1080 });
        await expect(page.locator('h1:has-text("Prompt Vault")')).toBeVisible();
    });

    test('should display error boundaries correctly', async ({ page }) => {
        await page.goto('/');

        // Test that error boundaries are working (if implemented)
        // This test may need to be adjusted based on actual error boundary implementation
        const errorBoundary = page.locator('[data-testid="error-boundary"], .error-boundary');
        // Error boundary should not be visible on normal load
        await expect(errorBoundary).not.toBeVisible();
    });
});
