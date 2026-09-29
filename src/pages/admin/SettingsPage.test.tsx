import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminStoreProvider } from './AdminStore';
import { SettingsPage } from './SettingsPage';

const TOKEN_KEY = 'glow-grace-admin-token';

const admin = {
  id: 'admin-1',
  name: 'Rehana Kapoor',
  email: 'rehana@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const editor = {
  id: 'admin-2',
  name: 'Karan Mehra',
  email: 'karan@glowngrace.in',
  role: 'Content & Reviews',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-04',
};

const settings = {
  profile: {
    storeName: 'Glow & Grace',
    tagline: 'Kajal, colour and care',
    email: 'hello@glowngrace.in',
    phone: '+91 98765 43210',
    address: '12 Linking Road, Bandra West, Mumbai 400050',
  },
  delivery: { freeAbove: 1299, deliveryFee: 99, gst: 18, returns: 14 },
  notifications: { orders: true, lowStock: true, partners: false, reviews: true },
  preview: { livePreview: false },
};

const pages = [
  { slug: 'home', label: 'Home', path: '/', visible: true, position: 0 },
  { slug: 'shop', label: 'Shop', path: '/shop', visible: true, position: 1 },
  { slug: 'about', label: 'About', path: '/about', visible: true, position: 2 },
  { slug: 'careers', label: 'Careers', path: '/careers', visible: false, position: 3 },
];

const datasets = [
  { key: 'products', label: 'Products', table: 'products', visible: true, seeded: true, rowCount: 12 },
  { key: 'reviews', label: 'Sample reviews', table: 'reviews', visible: true, seeded: true, rowCount: 4 },
];

/**
 * A console backend that answers the endpoints the settings page loads, and
 * records every write so a test can assert what was actually sent.
 */
function stubConsole(overrides: {
  onPut?: (body: unknown) => { status?: number; payload: unknown } | void;
  onPost?: (path: string, body: unknown) => { status?: number; payload: unknown } | void;
} = {}) {
  const puts: unknown[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];

  const replies: Record<string, unknown> = {
    me: { user: admin },
    products: { products: [] },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [admin, editor], roles: ['Store Administrator', 'Content & Reviews', 'Store Manager'] },
    pages: { pages },
    'demo-data': { datasets },
    settings: { settings, updatedAt: '2026-02-01T10:00:00.000Z' },
    summary: { orders: 4, products: 12, jobs: 2, candidates: 0, partners: 3, customers: 9, reviews: 4, pages: ['/', '/shop'], hiddenDatasets: [] },
  };

  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^.*\/api\/admin\//, '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;

    if (init.method === 'PUT' && path === 'settings') {
      puts.push(body);
      const forced = overrides.onPut?.(body);
      if (forced) return json(forced.status ?? 400, forced.payload);
      return json(200, { settings, updatedAt: '2026-02-02T10:00:00.000Z', message: 'Settings saved.' });
    }
    if (init.method === 'POST' || init.method === 'PATCH' || init.method === 'DELETE') {
      posts.push({ path, body });
      const forced = overrides.onPost?.(path, body);
      if (forced) return json(forced.status ?? 400, forced.payload);
      return json(200, { message: 'Done.', user: admin, datasets });
    }
    return json(200, replies[path] ?? {});
  }));

  return { puts, posts };
}

function json(status: number, payload: unknown) {
  return { ok: status < 400, status, json: async () => payload } as Response;
}

function renderSettings() {
  const notices: string[] = [];
  const view = render(
    <AdminStoreProvider>
      <SettingsPage onNotice={(message) => notices.push(message)} />
    </AdminStoreProvider>,
  );
  return { ...view, notices };
}

async function renderLoaded() {
  const rendered = renderSettings();
  await screen.findByDisplayValue('Glow & Grace');
  return rendered;
}

function dangerPanel() {
  return screen.getByRole('heading', { name: 'Danger zone' }).closest('.admin-danger') as HTMLElement;
}

function teamPanel() {
  return screen.getByRole('heading', { name: 'Add a team member' }).closest('.admin-panel') as HTMLElement;
}

function passwordButtonFor(name: string) {
  const row = within(teamPanel()).getByText(name).closest('li') as HTMLElement;
  return within(row).getByRole('button', { name: 'Password' });
}

describe('admin settings page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows a real row count for every demo dataset', async () => {
    stubConsole();
    await renderLoaded();

    const danger = dangerPanel();
    // The count used to render as a bare word, e.g. "rows · visible to shoppers".
    expect(within(danger).getByText('12 rows · visible to shoppers')).toBeVisible();
    expect(within(danger).getByText('4 rows · visible to shoppers')).toBeVisible();
  });

  it('saves one section at a time so a rejected field cannot block another form', async () => {
    const user = userEvent.setup();
    const { puts } = stubConsole();
    await renderLoaded();

    const taglines = screen.getByLabelText('Tagline');
    await user.clear(taglines);
    await user.type(taglines, 'Kajal, colour and calm');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    // Only the profile travels; the delivery form's values are not dragged along.
    expect(puts[0]).toEqual({ profile: { ...settings.profile, tagline: 'Kajal, colour and calm' } });
  });

  it('sends only the flipped notification, never the whole settings object', async () => {
    const user = userEvent.setup();
    const { puts } = stubConsole();
    await renderLoaded();

    const lowStock = screen.getByRole('switch', { name: 'Low stock alert' });
    expect(lowStock).toBeChecked();
    await user.click(lowStock);

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ notifications: { orders: true, lowStock: false, partners: false, reviews: true } });
  });

  it('keeps the typed values and shows the reason when a save is rejected', async () => {
    const user = userEvent.setup();
    stubConsole({
      onPut: () => ({
        status: 400,
        payload: { error: 'invalid_settings', message: 'Please check the highlighted settings and try again.', errors: { 'profile.email': 'Enter a valid email address.' } },
      }),
    });
    const { notices } = await renderLoaded();

    const email = screen.getByLabelText('Contact email');
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await screen.findByText('Enter a valid email address.');
    // Nothing is discarded and no success is claimed.
    expect(email).toHaveValue('not-an-email');
    expect(notices).toEqual(['Please check the highlighted settings and try again.']);
    expect(notices).not.toContain('Store profile saved.');
  });

  it('rejects a fractional delivery fee before it reaches the API', async () => {
    const user = userEvent.setup();
    const { puts } = stubConsole();
    const { notices } = await renderLoaded();

    const fee = screen.getByLabelText('Standard delivery fee (₹)');
    await user.clear(fee);
    await user.type(fee, '49.5');
    await user.click(screen.getByRole('button', { name: 'Save delivery settings' }));

    expect(await screen.findByText('Enter a whole number, without a decimal point.')).toBeVisible();
    expect(puts).toHaveLength(0);
    expect(notices).toContain('Check the highlighted delivery values and try again.');
  });

  it('treats a cleared number field as empty rather than zero', async () => {
    const user = userEvent.setup();
    const { puts } = stubConsole();
    const { notices } = await renderLoaded();

    const threshold = screen.getByLabelText('Free delivery above (₹)');
    await user.clear(threshold);
    await user.click(screen.getByRole('button', { name: 'Save delivery settings' }));

    expect(await screen.findByText('Enter the free delivery above.')).toBeVisible();
    // Sending 0 would have quietly rewritten the store's threshold.
    expect(puts).toHaveLength(0);
    expect(notices).toContain('Check the highlighted delivery values and try again.');
  });

  it('persists the live preview switch instead of only showing it on screen', async () => {
    const user = userEvent.setup();
    const { puts } = stubConsole();
    await renderLoaded();

    const toggle = screen.getByRole('switch', { name: 'Live preview mode' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ preview: { livePreview: true } });
  });

  it('does not claim a copy when the browser blocks the clipboard', async () => {
    const user = userEvent.setup();
    stubConsole();
    await renderLoaded();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    await user.click(screen.getByRole('button', { name: 'Copy preview link' }));

    expect(await screen.findByText('Your browser blocked the clipboard. Copy the address bar instead.')).toBeVisible();
  });

  it('keeps the password form open and the new password intact when the current one is wrong', async () => {
    const user = userEvent.setup();
    stubConsole({
      onPost: () => ({ status: 400, payload: { error: 'wrong_password', message: 'That current password is not correct.' } }),
    });
    const { notices } = await renderLoaded();

    await user.click(passwordButtonFor('Karan Mehra'));
    await user.type(screen.getByLabelText('Current password'), 'wrong-one');
    const next = screen.getByLabelText('New password');
    await user.type(next, 'brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('That current password is not correct.')).toBeVisible();
    // The form used to vanish, taking the new password with it.
    expect(next).toHaveValue('brand-new-password');
    expect(notices).toEqual(['That current password is not correct.']);
  });

  it('asks for confirmation before running a demo-data action', async () => {
    const user = userEvent.setup();
    const { posts } = stubConsole();
    await renderLoaded();

    const danger = dangerPanel();
    await user.click(within(danger).getAllByRole('button', { name: 'Hide' })[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Confirm this action' });
    expect(dialog).toBeVisible();
    // Focus lands on the safe action, so Escape is a working way out.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Yes, continue' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: 'demo-data', body: { dataset: 'products', action: 'hide' } });
  });

  it('leaves a page switch alone when the API rejects the change', async () => {
    const user = userEvent.setup();
    stubConsole({
      onPost: () => ({ status: 400, payload: { error: 'page_update_failed', message: 'That page could not be changed.' } }),
    });
    const { notices } = await renderLoaded();

    const careers = screen.getByRole('switch', { name: 'Show Careers' });
    expect(careers).not.toBeChecked();
    await user.click(careers);

    await waitFor(() => expect(notices).toContain('That page could not be changed.'));
    // The switch is not flipped in front of an unconfirmed save.
    expect(careers).not.toBeChecked();
  });

  it('reports hidden pages and a real settings timestamp in the status card', async () => {
    stubConsole();
    await renderLoaded();

    expect(screen.getByText('Live, with pages hidden')).toBeVisible();
    // Local time is rendered, so only the shape of the stamp is asserted here.
    expect(screen.getByText(/^Settings last saved \d{2} \w{3}, \d{2}:\d{2}/)).toBeVisible();
    expect(screen.queryByText(/never been changed/)).not.toBeInTheDocument();
    // The status card names the page that is actually hidden.
    expect(document.querySelector('.admin-status-card dd.is-warn')).toHaveTextContent('Careers');
  });
});
