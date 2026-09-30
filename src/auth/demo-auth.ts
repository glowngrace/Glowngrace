import { demoPassword } from '../lib/demo-credentials';

export type DemoRole = 'customer' | 'candidate' | 'partner' | 'admin';

export type DemoAccount = {
  role: DemoRole;
  label: string;
  email: string;
  password: string;
  name: string;
  description: string;
  destination: string;
};

export const demoAccounts: DemoAccount[] = [
  { role: 'customer', label: 'Customer', email: 'customer@glowngrace.in', password: demoPassword, name: 'Ritika Srivastava', description: 'Shopping and your wishlist', destination: '/shop' },
  { role: 'candidate', label: 'Candidate', email: 'candidate@glowngrace.in', password: demoPassword, name: 'Anjali Verma', description: 'Applications and training', destination: '/candidate' },
  { role: 'partner', label: 'Partner salon', email: 'partner@glowngrace.in', password: demoPassword, name: 'Blush Beauty Lounge', description: 'Vacancies and salon tools', destination: '/partner' },
  { role: 'admin', label: 'Administrator', email: 'admin@glowngrace.in', password: demoPassword, name: 'Glow & Grace Admin', description: 'Platform overview', destination: '/admin' },
];

const SESSION_KEY = 'glow-grace-demo-account';
const CHANGE_EVENT = 'glow-grace-auth-change';

function notifyAccountChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const accountChangedEvent = CHANGE_EVENT;

export function getDemoAccount(): DemoAccount | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object' || !('role' in stored) || typeof stored.role !== 'string') return null;
    const entry = demoAccounts.find((account) => account.role === stored.role);
    if (!entry) return null;
    // A real server sign-in stores the person's own name and address; the sample
    // entry only supplies the role and the portal that role belongs to.
    const record = stored as { email?: unknown; name?: unknown };
    return {
      ...entry,
      email: typeof record.email === 'string' && record.email ? record.email : entry.email,
      name: typeof record.name === 'string' && record.name ? record.name : entry.name,
    };
  } catch {
    return null;
  }
}

/**
 * Records a session the server actually issued. The console gate only inspects
 * the role, so this is what lets an administrator whose address is not one of
 * the four samples open it after a real sign-in.
 */
export function signInConsoleAccount(user: { email: string; name: string }) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'admin', email: user.email, name: user.name }));
  notifyAccountChanged();
}

export function signInDemo(email: string, password: string): DemoAccount | null {
  const account = demoAccounts.find(
    (demo) => demo.email === email.trim().toLowerCase() && demo.password === password,
  );
  if (account) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ role: account.role }));
    notifyAccountChanged();
  }
  return account ?? null;
}

export function signOutDemo() {
  localStorage.removeItem(SESSION_KEY);
  notifyAccountChanged();
}
