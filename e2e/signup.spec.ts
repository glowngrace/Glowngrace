import { expect, test } from '@playwright/test';

/**
 * Registration, end to end through the browser.
 *
 * The demo account picker is gone, so this is now the only way into the house
 * from outside. It has to work for a first-time visitor with no session, and it
 * has to be honest that the account cannot sign in until somebody approves it.
 */

/** Fills every field, choosing a role from the picker. */
async function fillForm(page: import('@playwright/test').Page, values: {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
}) {
  if (values.name !== undefined) await page.locator('#signup-name').fill(values.name);
  if (values.email !== undefined) await page.locator('#signup-email').fill(values.email);
  if (values.phone !== undefined) await page.locator('#signup-phone').fill(values.phone);
  if (values.password !== undefined) await page.locator('#signup-password').fill(values.password);
  if (values.confirmPassword !== undefined) await page.locator('#signup-confirm-password').fill(values.confirmPassword);
}

const completeDetails = {
  name: 'Reha Qureshi',
  email: 'reha@example.com',
  phone: '+91 98765 43210',
  password: 'a-good-password',
  confirmPassword: 'a-good-password',
};

test.describe('role-based registration', () => {
  test('offers the three portal roles, each with an explanation', async ({ page }) => {
    await page.goto('/signup');

    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    // The approval rule is stated before the form, not discovered afterwards.
    await expect(page.getByText('An administrator reviews every request before an account can sign in.')).toBeVisible();

    const picker = page.getByRole('group', { name: 'What brings you here?' });
    for (const role of ['Customer', 'Candidate', 'Partner Salon']) {
      await expect(picker.getByRole('radio', { name: new RegExp(`^${role}\\b`) })).toBeVisible();
    }
    // A back-office role is a grant rather than a request, so the public form does
    // not offer one. Staff are added from the console.
    await expect(picker.getByRole('radio')).toHaveCount(3);
    await expect(page.getByText('Store Administrator')).toHaveCount(0);
    await expect(page.getByText('Super Admin')).toHaveCount(0);
    // Each option says who it is for, so a visitor can pick without asking.
    await expect(picker.getByText('Shop the collection and keep your wishlist')).toBeVisible();
    await expect(picker.getByText('Apply for roles and track your training')).toBeVisible();
  });

  test('lets a visitor choose the role they want', async ({ page }) => {
    let sent: Record<string, unknown> | undefined;
    await page.route('**/api/admin/signup', async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { message: 'Thank you. Your request is with an administrator.', user: { id: 'pending-1' } } });
    });

    await page.goto('/signup');
    await page.getByRole('radio', { name: /Partner Salon/ }).check();
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();

    await expect(page.locator('.login-reset-notice')).toHaveText('Thank you. Your request is with an administrator.');
    expect(sent).toMatchObject({ role: 'Partner Salon', email: 'reha@example.com', name: 'Reha Qureshi', phone: '+91 98765 43210' });
    // The password is sent once and never echoed back into the page.
    expect(sent?.password).toBe('a-good-password');
  });

  test('says the request is waiting rather than pretending the account works', async ({ page }) => {
    await page.route('**/api/admin/signup', (route) => route.fulfill({
      status: 201,
      json: {
        message: 'Thank you. Your request is with an administrator. You can sign in once it is approved.',
        user: { id: 'pending-1', status: 'Pending' },
      },
    }));

    await page.goto('/signup');
    await page.getByRole('radio', { name: /Candidate/ }).check();
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();

    const notice = page.locator('.login-reset-notice');
    await expect(notice).toContainText('You can sign in once it is approved.');
    // The form is replaced by the answer, so the same request cannot be sent twice.
    await expect(page.getByRole('button', { name: 'Request my account' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
  });

  test('points somebody with an existing account at the sign-in form', async ({ page }) => {
    await page.route('**/api/admin/signup', (route) => route.fulfill({
      status: 409,
      json: { error: 'duplicate_email', message: 'That email address already has an account. Sign in instead, or ask for a reset link.' },
    }));

    await page.goto('/signup');
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();

    // Unlike the forgot-password route, this names the clash, because the
    // visitor is looking at their own address.
    await expect(page.getByRole('alert')).toContainText('Sign in instead');
  });

  test('catches a mistake beside the field that caused it, without asking the server', async ({ page }) => {
    let asked = false;
    await page.route('**/api/admin/signup', (route) => {
      asked = true;
      return route.fulfill({ json: {} });
    });

    await page.goto('/signup');
    await fillForm(page, { ...completeDetails, password: 'short', confirmPassword: 'different' });
    await page.getByRole('button', { name: 'Request my account' }).click();

    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    expect(asked).toBe(false);
  });

  test('clears a complaint as soon as the field is corrected', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('#signup-name').fill('R');
    await page.getByRole('button', { name: 'Request my account' }).click();
    await expect(page.getByText('Tell us the name to put on the account.')).toBeVisible();

    await page.locator('#signup-name').fill('Reha Qureshi');
    await expect(page.getByText('Tell us the name to put on the account.')).toHaveCount(0);
  });

  test('shows what the server said about a field it rejected', async ({ page }) => {
    await page.route('**/api/admin/signup', (route) => route.fulfill({
      status: 400,
      json: {
        error: 'invalid_signup',
        message: 'Check the details below and try again.',
        errors: { email: 'Enter an email address we can reach you at.' },
      },
    }));

    await page.goto('/signup');
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();

    // A per-field complaint lands on the field, not as a wall of text.
    await expect(page.getByText('Enter an email address we can reach you at.')).toBeVisible();
    await expect(page.locator('#signup-email')).toHaveAttribute('aria-invalid', 'true');
  });

  test('reports a failure of the request itself without losing what was typed', async ({ page }) => {
    await page.route('**/api/admin/signup', (route) => route.fulfill({ status: 500, json: { error: 'server_error', message: 'Something went wrong on our side. Please try again.' } }));

    await page.goto('/signup');
    await page.getByRole('radio', { name: /Candidate/ }).check();
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();

    await expect(page.getByRole('alert')).toContainText('Something went wrong on our side');
    // Retrying is the sensible next step, so the details are still there.
    await expect(page.locator('#signup-name')).toHaveValue('Reha Qureshi');
    await expect(page.getByRole('button', { name: 'Request my account' })).toBeEnabled();
  });

  test('sends no session with a registration, so nothing is signed in yet', async ({ page }) => {
    const asked: string[] = [];
    await page.route('**/api/admin/**', (route) => {
      asked.push(`${route.request().method()} ${route.request().url().split('/api/admin/')[1]}`);
      return route.fulfill({ status: 201, json: { message: 'Thank you. Your request is with an administrator.', user: { id: 'pending-1', status: 'Pending' } } });
    });

    await page.goto('/signup');
    await fillForm(page, completeDetails);
    await page.getByRole('button', { name: 'Request my account' }).click();
    await expect(page.locator('.login-reset-notice')).toBeVisible();

    // A pending account is a claim, not a grant: the only call made is the one
    // that records the request.
    expect(asked).toEqual(['POST signup']);
  });

  test('offers the two ways out of the form: sign in, or a reset link', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: 'Sign in instead' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeVisible();

    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    // The disclosure lives on the sign-in page, so that is where it leads.
    await expect(page).toHaveURL(/\/login$/);
    await page.getByText('Forgotten your password?').click();
    await expect(page.locator('#reset-email')).toBeVisible();
  });

  test('shows the sign-in page with no demo account section', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByText('Explore a demo account')).toHaveCount(0);
    await expect(page.locator('#login-email')).toBeVisible();
    // Registration is still one click away, which is where the picker went.
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('reaches registration from the header', async ({ page }) => {
    await page.goto('/');
    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
    }
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('keeps the form usable on a phone without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
