import { expect, test } from '@playwright/test';

test('home navigation and category filters lead to the right product edit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /beauty that feels like you/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
  }
  await page.getByRole('link', { name: 'Shop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Collection' })).toBeVisible();
  await page.getByRole('button', { name: 'Skincare' }).click();
  await expect(page.getByRole('link', { name: 'Glow Ritual Vitamin C Face Serum', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Velvet Matte Luxe Liquid Lipstick' })).toHaveCount(0);
});

test('product page, wishlist, and bag interactions work end to end', async ({ page }) => {
  await page.goto('/shop');
  await page.getByRole('link', { name: 'View Glow Ritual Vitamin C Face Serum' }).click();
  await expect(page.getByRole('heading', { name: 'Glow Ritual Vitamin C Face Serum' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to bag · ₹849' }).click();
  const bag = page.getByRole('dialog', { name: /your bag/i });
  await expect(bag.getByText('Glow Ritual Vitamin C Face Serum')).toBeVisible();
  await bag.getByRole('button', { name: /increase glow ritual/i }).click();
  await expect(bag.locator('.drawer-summary').getByText('₹1,698')).toBeVisible();
  await bag.getByRole('button', { name: 'Close your bag' }).click();
  const wishlistButton = page.getByRole('button', { name: 'Save to your wishlist' });
  await wishlistButton.click();
  await expect(page.getByRole('button', { name: '♥ Saved to your wishlist' })).toHaveAttribute('aria-pressed', 'true');
});

test('checkout calculates delivery and GST, confirms the order, and clears the saved bag', async ({ page }) => {
  let savedOrder: Record<string, unknown> | undefined;
  await page.route('**/api/checkout', async (route) => {
    savedOrder = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ orderNumber: 'GG-ABCDEF123456', total: 940.45, message: 'Order confirmed.' }),
    });
  });
  await page.goto('/product/4');
  await page.getByRole('button', { name: 'Add to bag · ₹849' }).click();
  await page.getByRole('dialog', { name: /your bag/i }).getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('First name').fill('Priya');
  await page.getByLabel('Last name').fill('Sharma');
  await page.locator('.checkout-form-panels').getByLabel('Email address').fill('priya@example.com');
  await page.getByLabel('Phone number').fill('+91 98765 43210');
  await page.getByLabel('Street address').fill('10 Rose Garden Road');
  await page.getByLabel('Locality or area').fill('Gomti Nagar');
  await page.getByLabel('PIN code').fill('226010');
  await page.getByRole('radio', { name: /Express delivery/ }).check();
  await expect(page.getByText('₹42.45')).toBeVisible();
  await expect(page.getByText('₹940.45', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByRole('heading', { name: 'Thank you for your order.' })).toBeVisible();
  await expect(page.getByText('GG-ABCDEF123456')).toBeVisible();
  await expect(page.getByText('₹940.45')).toBeVisible();
  expect(savedOrder).toMatchObject({
    firstName: 'Priya',
    city: 'Lucknow',
    postalCode: '226010',
    deliveryMethod: 'express',
    paymentMethod: 'cod',
    items: [{ productId: 4, quantity: 1 }],
  });
  expect(await page.evaluate(() => localStorage.getItem('glow-grace-cart'))).toBe('[]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('checkout keeps the bag if the order API fails', async ({ page }) => {
  await page.route('**/api/checkout', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'server_error', message: 'We could not place your order right now.' }),
  }));
  await page.goto('/product/4');
  await page.getByRole('button', { name: 'Add to bag · ₹849' }).click();
  await page.getByRole('dialog', { name: /your bag/i }).getByRole('link', { name: 'Proceed to checkout' }).click();
  await page.getByLabel('First name').fill('Priya');
  await page.getByLabel('Last name').fill('Sharma');
  await page.locator('.checkout-form-panels').getByLabel('Email address').fill('priya@example.com');
  await page.getByLabel('Phone number').fill('+91 98765 43210');
  await page.getByLabel('Street address').fill('10 Rose Garden Road');
  await page.getByLabel('Locality or area').fill('Gomti Nagar');
  await page.getByLabel('PIN code').fill('226010');
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByRole('alert')).toContainText('We could not place your order right now');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('glow-grace-cart'))).toContain('"productId":4');
});

test('contact form validates and confirms successful messages', async ({ page }) => {
  await page.route('**/api/contact', async (route) => {
    const payload = route.request().postDataJSON() as { name: string; email: string; topic: string };
    expect(payload).toMatchObject({ name: 'Maya Singh', email: 'maya@example.com', topic: 'Salon partnership' });
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ message: 'Thank you. We will be in touch within one working day.' }) });
  });
  await page.goto('/contact?topic=Salon%20partnership');
  await expect(page.getByLabel('I’m reaching out about')).toHaveValue('Salon partnership');
  await page.getByLabel('Full name').fill('Maya Singh');
  const contactForm = page.locator('form.contact-form');
  await contactForm.getByLabel('Email address').fill('maya@example.com');
  await contactForm.getByLabel('Your message').fill('I would love to learn about becoming a partner salon.');
  await contactForm.getByRole('button', { name: 'Send us a note' }).click();
  await expect(contactForm.getByRole('status')).toContainText('Thank you. We will be in touch');
});

test('a beauty-career application opens the matching contact topic', async ({ page }) => {
  await page.goto('/careers');
  const firstJob = page.locator('.job-card').filter({ hasText: 'Senior Beautician' });
  await firstJob.getByRole('link', { name: 'I’m interested' }).click();
  await expect(page.getByRole('heading', { name: 'Get in Touch' })).toBeVisible();
  await expect(page.getByLabel('I’m reaching out about')).toHaveValue('Apply for Senior Beautician');
});

test('demo sign-in opens the matching candidate dashboard and its tabs', async ({ page, isMobile }) => {
  await page.goto('/login');
  await page.getByText('Explore a demo account').click();
  await page.getByRole('button', { name: /Candidate Applications and training/i }).click();
  await expect(page.locator('.login-form').getByLabel('Email address')).toHaveValue('candidate@glowngrace.in');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.locator('.header-profile img')).toHaveAttribute('src', '/images/partner2.jpg');
  await page.getByRole('button', { name: 'Profile menu for Anjali Verma' }).click();
  const profileMenu = page.getByLabel('Profile menu', { exact: true });
  await expect(profileMenu).toContainText('Signed in · Candidate');
  await expect(profileMenu.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Profile menu for Anjali Verma' }).click();
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Training & certificates' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Saved openings' }).click();
  await expect(page.getByRole('heading', { name: 'Saved openings' })).toBeVisible();
  await page.getByRole('button', { name: 'Profile menu for Anjali Verma' }).click();
  await profileMenu.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  if (isMobile) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('header sign out clears the session and redirects home', async ({ page, isMobile }) => {
  await page.goto('/login');
  await page.getByText('Explore a demo account').click();
  await page.getByRole('button', { name: /Customer Shopping and your wishlist/i }).click();
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.locator('.header-profile img')).toBeVisible();
  await page.getByRole('button', { name: 'Profile menu for Ritika Srivastava' }).click();
  const profileMenu = page.getByLabel('Profile menu', { exact: true });
  await expect(profileMenu).toContainText('Signed in · Customer');
  await profileMenu.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  if (isMobile) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('.header-profile')).toHaveCount(0);
});

test('portal routes require the matching demo role', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible();
  await expect(page.locator('.site-header')).toHaveCount(0);
  await expect(page.locator('.site-footer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go to sign in' }).click();
  await page.getByText('Explore a demo account').click();
  await page.getByRole('button', { name: /Administrator Platform overview/i }).click();
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByRole('heading', { name: 'Business overview' })).toBeVisible();
  await expect(page.locator('.portal-brand')).toHaveCount(1);
  const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
  const partnersTab = navigation.getByRole('button', { name: 'Partner salons' });
  if (test.info().project.name === 'mobile-chromium') {
    await partnersTab.evaluate((element) => element.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  await partnersTab.click();
  await expect(page.getByRole('heading', { name: 'Partner salons' })).toBeVisible();
});

test('admin can open the add-product form without being redirected to contact', async ({ page }) => {
  await page.goto('/login');
  await page.getByText('Explore a demo account').click();
  await page.getByRole('button', { name: /Administrator Platform overview/i }).click();
  await page.getByRole('button', { name: 'Sign in to your account' }).click();

  const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
  await navigation.getByRole('button', { name: 'Catalogue & inventory' }).click();
  await page.getByRole('button', { name: '+ Add a product' }).click();
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { name: 'Add a product' })).toBeVisible();
  await expect(page.getByLabel('Product name')).toBeVisible();

  await page.getByLabel('Product name').fill('E2E Preview Product');
  await page.getByLabel('Category').selectOption('Makeup');
  await page.getByLabel('Price (₹)', { exact: true }).fill('100');
  await page.getByLabel('Original price (₹)', { exact: true }).fill('120');
  await page.getByLabel('Stock quantity').fill('5');
  await page.getByLabel('Image filename').fill('preview-product.jpg');
  await page.getByLabel('Description').fill('Product form E2E preview.');
  await page.getByRole('button', { name: 'Preview product' }).click();
  await expect(page.getByRole('status')).toContainText('Product creation is not connected to a catalogue service yet.');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Catalogue & inventory' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('tablet header keeps the sign-in link visible without horizontal overflow', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Tablet header layout is covered by the desktop browser project.');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('wishlist lists saved products and allows removing them', async ({ page }) => {
  await page.goto('/shop');
  await page.getByRole('button', { name: 'Add Glow Ritual Vitamin C Face Serum to wishlist' }).click();
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
  }
  await page.getByRole('link', { name: 'Wishlist' }).click();
  await expect(page.getByRole('heading', { name: 'Your Wishlist' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Glow Ritual Vitamin C Face Serum' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove from wishlist' }).click();
  await expect(page.getByText('Your saved beauty edit is waiting to take shape.')).toBeVisible();
});

test('mobile navigation opens and closes after choosing a destination', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'This layout check is for the mobile browser project.');
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  await toggle.click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to your account' })).toBeVisible();
  await toggle.click();
  await expect(navigation.getByRole('link', { name: 'Careers' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Careers' }).click();
  await expect(page.getByRole('heading', { name: 'Beauty Careers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'false');
});
