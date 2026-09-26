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
  { role: 'customer', label: 'Customer', email: 'customer@glowngrace.in', password: 'demo123', name: 'Ritika Srivastava', description: 'Shopping and your wishlist', destination: '/shop' },
  { role: 'candidate', label: 'Candidate', email: 'candidate@glowngrace.in', password: 'demo123', name: 'Anjali Verma', description: 'Applications and training', destination: '/candidate' },
  { role: 'partner', label: 'Partner salon', email: 'partner@glowngrace.in', password: 'demo123', name: 'Blush Beauty Lounge', description: 'Vacancies and salon tools', destination: '/partner' },
  { role: 'admin', label: 'Administrator', email: 'admin@glowngrace.in', password: 'demo123', name: 'Glow & Grace Admin', description: 'Platform overview', destination: '/admin' },
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
    return demoAccounts.find((account) => account.role === stored.role) ?? null;
  } catch {
    return null;
  }
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
