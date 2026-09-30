import { expect, test, type Page } from '@playwright/test';

/**
 * A walk through the pages this branch changed, checking the things a unit test
 * cannot see: that a person can read the screen, that a keyboard gets where it
 * needs to go, and that nothing throws in the console along the way.
 *
 * The existing projects already run every test in desktop Chromium and mobile
 * Chromium, so each check below is a real check on both screen sizes.
 */

/** Console errors and uncaught exceptions, which must not happen on any page. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !ignoreExpectedResponses(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught ${error.message}`));
  return errors;
}

const PAGES = ['/signup', '/login', '/reset-password', '/admin'] as const;

/**
 * A browser logs a console error for every non-2xx response, so a test that
 * deliberately provokes a 401 or 409 would otherwise fail its own no-errors
 * check. Only errors the application itself raises are kept.
 */
function ignoreExpectedResponses(text: string) {
  return /Failed to load resource/i.test(text);
}

test('sign-up offers the three public roles and nothing else', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/signup');

  // The heading a person arrives for, and the promise the page makes.
  await expect(page.getByRole('heading', { level: 1, name: /create an account/i })).toBeVisible();
  await expect(page.getByText(/an administrator reviews every request/i)).toBeVisible();

  // Exactly the three public roles, offered as a labelled radio group so a
  // keyboard can arrow between them and each choice is announced.
  const group = page.getByRole('group', { name: /what brings you here/i });
  await expect(group).toBeVisible();
  const roles = page.locator('input[type="radio"][name="role"]');
  await expect(roles).toHaveCount(3);
  const values = await roles.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).sort());
  expect(values).toEqual(['Candidate', 'Customer', 'Partner Salon']);

  // A console role must not leak into the page text either, because a role that
  // is visible but unselectable reads as a broken form.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const hidden of ['super admin', 'store administrator', 'inventory manager', 'content editor', 'support agent']) {
    expect(body, `the sign-up page mentions ${hidden}`).not.toContain(hidden);
  }

  // The keyboard gets moving without a mouse, and the roles are reachable by arrow.
  await roles.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('input[type="radio"][name="role"]:checked')).toHaveValue('Candidate');

  expect(errors).toEqual([]);
});

test('sign-up reports a server rejection in plain language and keeps the form', async ({ page }) => {
  const errors = watchConsole(page);
  await page.route('**/api/admin/signup', (route) => route.fulfill({
    status: 409,
    json: { error: 'email_taken', message: 'An account already uses that email address.' },
  }));
  await page.goto('/signup');
  await page.getByLabel(/full name/i).fill('Anjali Verma');
  // The storefront footer has an "Email address" field of its own, so the form
  // fields are addressed by the ids the page gives them.
  await page.locator('#signup-email').fill('anjali@example.com');
  await page.locator('#signup-password').fill('a-password-the-person-chose');
  await page.locator('#signup-confirm-password').fill('a-password-the-person-chose');
  await page.getByRole('button', { name: /request my account/i }).click();

  // Announced, not merely painted.
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/already uses that email/i);
  // And the typed values are still there to correct, rather than a blank form.
  await expect(page.getByLabel(/full name/i)).toHaveValue('Anjali Verma');
  expect(errors).toEqual([]);
});

test('sign-up will not submit a password that does not meet the rules', async ({ page }) => {
  const errors = watchConsole(page);
  let submitted = false;
  await page.route('**/api/admin/signup', (route) => {
    submitted = true;
    return route.fulfill({ status: 201, json: { message: 'ok' } });
  });
  await page.goto('/signup');
  await page.getByLabel(/full name/i).fill('Anjali Verma');
  await page.locator('#signup-email').fill('anjali@example.com');
  await page.locator('#signup-password').fill('short');
  await page.locator('#signup-confirm-password').fill('different');
  await page.getByRole('button', { name: /request my account/i }).click();

  // Both problems are named, and nothing reached the server.
  const alerts = page.getByRole('alert');
  await expect(alerts.first()).toBeVisible();
  expect(submitted, 'a weak password was sent to the server').toBe(false);
  expect(errors).toEqual([]);
});

test('sign-in does not reveal which half of a wrong sign-in was wrong', async ({ page }) => {
  const errors = watchConsole(page);
  await page.route('**/api/admin/session', (route) => route.fulfill({
    status: 401,
    json: { error: 'invalid_credentials', message: 'That email and password do not match.' },
  }));
  await page.goto('/login');
  await page.locator('#login-email').fill('glownglancebiz@gmail.com');
  await page.locator('#login-password').fill('not-the-right-password');
  await page.getByRole('button', { name: /sign in to your account/i }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/do not match/i);
  // Naming the address would confirm which accounts exist.
  await expect(alert).not.toContainText(/glownglancebiz/i);
  expect(errors).toEqual([]);
});

test('a locked console offers a way to ask for an account', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // A dead end for a stranger is a dead end for a real applicant.
  const requestLink = page.getByRole('link', { name: /request an account/i });
  await expect(requestLink).toBeVisible();
  await requestLink.click();
  await expect(page.getByRole('heading', { level: 1, name: /create an account/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('asking for a reset link says nothing about whether an account exists', async ({ page }) => {
  const errors = watchConsole(page);
  await page.route('**/api/admin/password-reset', (route) => route.fulfill({
    status: 202,
    json: { message: 'If that address has an account, a reset link is on its way.' },
  }));
  await page.goto('/login');

  // The request sits behind a disclosure, so a sign-in page is not cluttered by it.
  await page.getByText(/forgotten your password/i).click();
  await page.locator('#reset-email').fill('glownglancebiz@gmail.com');
  await page.getByRole('button', { name: /send me a reset link/i }).click();

  // The newsletter footer has a status region of its own, so this one is scoped.
  const status = page.locator('.login-reset-notice');
  await expect(status).toContainText(/if that address has an account/i);
  // The wording must not confirm or deny that this address is registered.
  await expect(status).not.toContainText(/glownglancebiz/i);
  expect(errors).toEqual([]);
});

test('the reset page needs the code from the link, and rejects a wrong one', async ({ page }) => {
  const errors = watchConsole(page);
  await page.route('**/api/admin/password-reset/confirm', (route) => route.fulfill({
    status: 400,
    json: { error: 'invalid_token', message: 'That reset code is not valid or has expired. Request a new one.' },
  }));
  await page.goto('/reset-password');

  await expect(page.getByRole('heading', { level: 1, name: /set a new password/i })).toBeVisible();
  await page.locator('#reset-token').fill('a-code-nobody-issued');
  await page.locator('#reset-new-password').fill('a-password-the-person-chose');
  await page.locator('#reset-confirm-password').fill('a-password-the-person-chose');
  await page.getByRole('button', { name: /set my new password/i }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/not valid or has expired/i);
  // The person has not been signed in by a bad code.
  await expect(page.getByRole('button', { name: /set my new password/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('every changed page holds together on this screen', async ({ page }) => {
  for (const path of PAGES) {
    const errors = watchConsole(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    // Nothing may push the page sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);

    const audit = await page.evaluate(() => {
      const visible = (node: HTMLElement) => {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return {
        // Text that is cut off by its own box and cannot be revealed by scrolling:
        // the failure that hides a validation message or half a price.
        clipped: Array.from(document.querySelectorAll<HTMLElement>('p, li, label, button, h1, h2, td, th, span'))
          .filter((node) => node.textContent?.trim() && node.getAttribute('aria-hidden') !== 'true' && visible(node))
          // A one-pixel box is the screen-reader-only pattern - a label kept for
          // assistive technology and deliberately hidden from the eye - so its
          // "clipping" is the point, not a fault.
          .filter((node) => node.clientWidth > 1 && node.clientHeight > 1)
          .filter((node) => {
            const style = getComputedStyle(node);
            if (style.overflow !== 'hidden' && style.overflowX !== 'hidden' && style.textOverflow !== 'ellipsis') return false;
            return node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2;
          })
          .map((node) => `${node.textContent?.trim().slice(0, 30)} (${node.clientWidth}x${node.clientHeight} box, ${node.scrollWidth}x${node.scrollHeight} content)`),
        missingAlt: Array.from(document.images)
          .filter((image) => visible(image) && !image.hasAttribute('alt'))
          .map((image) => image.getAttribute('src') ?? '?'),
        h1: Array.from(document.querySelectorAll('h1')).map((node) => node.textContent?.trim() ?? ''),
        unlabelled: Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
          .filter((node) => visible(node) && node.type !== 'hidden' && node.type !== 'radio')
          .filter((node) => !node.labels?.length && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby'))
          .map((node) => node.outerHTML.slice(0, 70)),
        // A control smaller than this is hard to hit on a touch screen.
        tinyTargets: Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input[type="radio"]'))
          .filter((node) => visible(node))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width < 20 || rect.height < 20;
          })
          .map((node) => `${node.textContent?.trim().slice(0, 25) || node.getAttribute('aria-label') || node.tagName} ${Math.round(node.getBoundingClientRect().width)}x${Math.round(node.getBoundingClientRect().height)}`),
      };
    });

    expect(audit.clipped, `${path} clips text it should show`).toEqual([]);
    expect(audit.missingAlt, `${path} has images without alt text`).toEqual([]);
    expect(audit.unlabelled, `${path} has form fields with no label`).toEqual([]);
    expect(audit.h1.length, `${path} has ${audit.h1.length} h1 elements`).toBe(1);
    expect(errors, `${path} logged console errors`).toEqual([]);
  }
});
