import {
  Children, cloneElement, isValidElement,
  useEffect, useId, useRef, useState,
  type FormEvent, type ReactElement,
} from 'react';
import { Spinner } from '../../components/Loader';
import { AdminApiError, type AdminUser, type StoreSettings } from '../../lib/admin-api';
import { useAdminStore } from './AdminStore';
import { Avatar, IconButton, PageHead, Panel, PanelHead, Toggle } from './AdminUi';
import { BulkUpload } from './BulkUpload';

const notificationRows: Array<{ key: string; title: string; copy: string }> = [
  { key: 'orders', title: 'New order placed', copy: 'Email the store team for every new order.' },
  { key: 'lowStock', title: 'Low stock alert', copy: 'Tell us when a product drops below 15 units.' },
  { key: 'partners', title: 'New partner application', copy: 'Notify when a parlour asks to be listed.' },
  { key: 'reviews', title: 'New product review', copy: 'Notify when a review needs moderation.' },
];

type Profile = StoreSettings['profile'];
type Delivery = StoreSettings['delivery'];
type Notifications = StoreSettings['notifications'];
type DeliveryKey = keyof Delivery;
type Section = 'profile' | 'delivery' | 'notifications' | 'preview';

const emptyProfile: Profile = { storeName: '', tagline: '', email: '', phone: '', address: '' };
const emptyDelivery: Record<DeliveryKey, string> = { freeAbove: '', deliveryFee: '', gst: '', returns: '' };

const deliveryFields: Array<{ key: DeliveryKey; label: string; min: number; max: number; whole: boolean }> = [
  { key: 'freeAbove', label: 'Free delivery above (₹)', min: 0, max: 9_999_999, whole: true },
  { key: 'deliveryFee', label: 'Standard delivery fee (₹)', min: 0, max: 99_999, whole: true },
  { key: 'gst', label: 'GST rate (%)', min: 0, max: 100, whole: false },
  { key: 'returns', label: 'Return window (days)', min: 0, max: 365, whole: true },
];

type Pending =
  | { kind: 'none' }
  | { kind: 'section'; section: Section }
  | { kind: 'role'; id: string }
  | { kind: 'password'; id: string }
  | { kind: 'invite' }
  | { kind: 'page'; slug: string }
  | { kind: 'demo'; dataset: string }
  | { kind: 'remove'; id: string }
  | { kind: 'copy' };

const idle: Pending = { kind: 'none' };

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof AdminApiError ? cause.message : fallback;
}

/**
 * Flattens the API's `profile.email` / `delivery.deliveryFee` paths down to the
 * field name, so a form can look up its own input by name without knowing which
 * section of the settings payload the server grouped it under.
 */
function fieldErrorsOf(cause: unknown) {
  if (!(cause instanceof AdminApiError)) return {};
  const flat: Record<string, string> = {};
  for (const [path, message] of Object.entries(cause.fieldErrors)) {
    if (typeof message === 'string') flat[path.split('.').pop() ?? path] = message;
  }
  return flat;
}

function formatStamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'recently';
  return parsed.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function SettingsPage({ onNotice }: { onNotice: (message: string) => void }) {
  const {
    users, roles, pages, datasets, settings, settingsUpdatedAt, summary, account,
    saveSettings, saveUser, removeUser, changePassword, setPageVisible, runDemoAction,
  } = useAdminStore();

  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [delivery, setDelivery] = useState<Record<DeliveryKey, string>>(emptyDelivery);
  const [notifications, setNotifications] = useState<Notifications>({});
  const [livePreview, setLivePreview] = useState(true);
  // One map per form. A single shared map made a rejected `profile.email`
  // highlight the invite form's "Email address" field as well, because both
  // inputs are named `email`.
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending>(idle);
  const [roleChoice, setRoleChoice] = useState('');
  const [passwordFor, setPasswordFor] = useState('');
  const [dangerFor, setDangerFor] = useState<{ dataset: string; label: string } | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  /**
   * The sections that have been edited but not saved yet.
   *
   * A demo-data reset re-reads the whole console, which produces a brand new
   * settings object. Adopting it unconditionally used to discard whatever had
   * been typed into the profile and delivery forms, so a save only overwrites
   * the sections nobody is currently editing. A ref, because adopting server
   * values must not itself count as an edit.
   */
  const editing = useRef(new Set<Section>());
  const setEditing = (section: Section, isEditing: boolean) => {
    if (isEditing) editing.current.add(section);
    else editing.current.delete(section);
  };

  useEffect(() => {
    if (!settings) return;
    if (!editing.current.has('profile')) setProfile(settings.profile);
    if (!editing.current.has('delivery')) {
      setDelivery({
        freeAbove: String(settings.delivery.freeAbove),
        deliveryFee: String(settings.delivery.deliveryFee),
        gst: String(settings.delivery.gst),
        returns: String(settings.delivery.returns),
      });
    }
    if (!editing.current.has('notifications')) setNotifications(settings.notifications);
    if (!editing.current.has('preview')) setLivePreview(settings.preview.livePreview);
  }, [settings]);

  /**
   * Saves a single section and reports what actually happened.
   *
   * `store.saveSettings` rejects on failure, so a rejected request leaves the
   * form exactly as the operator left it, keeps the server's field errors on
   * screen, and never announces a success. `message` describes the action that
   * was performed rather than the API's generic "Settings saved."
   *
   * Only the section being saved is sent. Sending the whole object is what let
   * a half-typed value in the delivery form silently block an unrelated
   * notification switch.
   */
  async function persist(section: Section, body: unknown, message: string, showErrors: (fields: Record<string, string>) => void) {
    setPending({ kind: 'section', section });
    showErrors({});
    try {
      await saveSettings(body);
      setEditing(section, false);
      onNotice(message);
      return true;
    } catch (saveError) {
      showErrors(fieldErrorsOf(saveError));
      onNotice(messageOf(saveError, 'That change could not be saved. Please try again.'));
      return false;
    } finally {
      setPending(idle);
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist('profile', { profile }, 'Store profile saved.', setProfileErrors);
  }

  function saveDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { freeAbove: 0, deliveryFee: 0, gst: 0, returns: 0 } as Delivery;
    const invalid: Record<string, string> = {};
    for (const field of deliveryFields) {
      const raw = delivery[field.key].trim();
      if (raw === '') {
        invalid[field.key] = `Enter the ${field.label.replace(/ \(.*$/, '').toLowerCase()}.`;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) invalid[field.key] = 'Enter a number.';
      else if (value < field.min) invalid[field.key] = `This cannot be below ${field.min}.`;
      else if (value > field.max) invalid[field.key] = `This cannot be above ${field.max}.`;
      else if (field.whole && !Number.isInteger(value)) invalid[field.key] = 'Enter a whole number, without a decimal point.';
      else payload[field.key] = value;
    }
    if (Object.keys(invalid).length > 0) {
      setDeliveryErrors(invalid);
      onNotice('Check the highlighted delivery values and try again.');
      return;
    }
    void persist('delivery', { delivery: payload }, 'Delivery and pricing settings saved.', setDeliveryErrors);
  }

  function toggleNotification(key: string, next: boolean) {
    const updated = { ...notifications, [key]: next };
    setNotifications(updated);
    setEditing('notifications', true);
    void persist('notifications', { notifications: updated }, `${notificationRows.find((row) => row.key === key)?.title ?? 'That'} notifications ${next ? 'enabled' : 'disabled'}.`, () => {})
      .then((saved) => {
        // Otherwise a rejected switch sits in the wrong position until the next
        // reload, claiming a change that was never stored.
        if (!saved) setNotifications(settings?.notifications ?? notifications);
      });
  }

  function toggleLivePreview(next: boolean) {
    setLivePreview(next);
    setEditing('preview', true);
    void persist('preview', { preview: { livePreview: next } }, `Live preview mode ${next ? 'enabled' : 'disabled'}.`, () => {})
      .then((saved) => {
        if (!saved) setLivePreview(settings?.preview.livePreview ?? next);
      });
  }

  async function togglePage(slug: string, visible: boolean) {
    setPending({ kind: 'page', slug });
    try {
      await setPageVisible(slug, visible);
      onNotice(visible ? 'Page is visible again.' : 'Page hidden from the storefront.');
    } catch (pageError) {
      // No optimistic flip to undo: the switch reads the store, which still
      // holds the value the API last confirmed.
      onNotice(messageOf(pageError, 'That page could not be changed.'));
    } finally {
      setPending(idle);
    }
  }

  async function saveRole(member: AdminUser) {
    const [id, role] = roleChoice.split('|');
    if (id !== member.id || !role) {
      onNotice('Pick a different role, then save it.');
      return;
    }
    if (role === member.role) {
      setRoleChoice('');
      return;
    }
    setPending({ kind: 'role', id: member.id });
    try {
      await saveUser({ role }, member.id);
      onNotice(`${member.name} is now a ${role}.`);
    } catch (roleError) {
      onNotice(messageOf(roleError, 'That role could not be changed.'));
    } finally {
      // Cleared either way, so a rejected save cannot leave the select showing
      // a role the database never accepted.
      setRoleChoice('');
      setPending(idle);
    }
  }

  async function copyPreviewLink() {
    setPending({ kind: 'copy' });
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(new URL('/', window.location.origin).toString());
      setCopied('done');
    } catch {
      // This button used to announce a copy that never happened.
      setCopied('failed');
    } finally {
      setPending(idle);
    }
  }

  const busy = pending.kind !== 'none';
  const roleOptions = roles.length > 0 ? roles : ['Store Administrator'];
  const removable = users.filter((member) => member.role !== 'Store Administrator' && member.id !== account?.id);
  const hiddenPages = pages.filter((page) => !page.visible);

  return (
    <>
      <PageHead crumb="Settings" title="Settings" sub="Store profile, delivery, team access, pages and demo data." />

      <div className="admin-settings">
        <div className="admin-settings-main">
          <Panel>
            <PanelHead title="Store profile" sub="Details shown across the storefront" />
            <form onSubmit={saveProfile} noValidate>
              <div className="admin-grid-2">
                <Field name="storeName" label="Store name" error={profileErrors.storeName}>
                  <input
                    name="storeName" required maxLength={120} value={profile.storeName} disabled={busy}
                    aria-invalid={profileErrors.storeName ? true : undefined}
                    onChange={(event) => { setProfile((current) => ({ ...current, storeName: event.target.value })); setEditing('profile', true); }}
                  />
                </Field>
                <Field name="tagline" label="Tagline" error={profileErrors.tagline}>
                  <input
                    name="tagline" maxLength={160} value={profile.tagline} disabled={busy}
                    onChange={(event) => { setProfile((current) => ({ ...current, tagline: event.target.value })); setEditing('profile', true); }}
                  />
                </Field>
                <Field name="email" label="Contact email" error={profileErrors.email}>
                  <input
                    name="email" type="email" required maxLength={254} value={profile.email} disabled={busy}
                    aria-invalid={profileErrors.email ? true : undefined}
                    onChange={(event) => { setProfile((current) => ({ ...current, email: event.target.value })); setEditing('profile', true); }}
                  />
                </Field>
                <Field name="phone" label="Phone" error={profileErrors.phone}>
                  <input
                    name="phone" maxLength={32} value={profile.phone} disabled={busy}
                    onChange={(event) => { setProfile((current) => ({ ...current, phone: event.target.value })); setEditing('profile', true); }}
                  />
                </Field>
                <Field name="address" label="Studio address" error={profileErrors.address} wide>
                  <textarea
                    name="address" rows={3} maxLength={300} value={profile.address} disabled={busy}
                    onChange={(event) => { setProfile((current) => ({ ...current, address: event.target.value })); setEditing('profile', true); }}
                  />
                </Field>
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit" disabled={busy}>
                  {pending.kind === 'section' && pending.section === 'profile' ? <><Spinner /> Saving…</> : 'Save profile'}
                </button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Delivery &amp; pricing" sub="Shipping thresholds and tax" />
            <form onSubmit={saveDelivery} noValidate>
              <div className="admin-grid-2">
                {deliveryFields.map((field) => (
                  <Field key={field.key} name={field.key} label={field.label} error={deliveryErrors[field.key]}>
                    <input
                      name={field.key}
                      type="number"
                      inputMode="numeric"
                      step={field.whole ? '1' : 'any'}
                      min={field.min}
                      max={field.max}
                      value={delivery[field.key]}
                      disabled={busy}
                      aria-invalid={deliveryErrors[field.key] ? true : undefined}
                      onChange={(event) => { setDelivery((current) => ({ ...current, [field.key]: event.target.value })); setEditing('delivery', true); }}
                    />
                  </Field>
                ))}
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit" disabled={busy}>
                  {pending.kind === 'section' && pending.section === 'delivery' ? <><Spinner /> Saving…</> : 'Save delivery settings'}
                </button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Team" sub="People helping run the beauty house" action={<BulkUpload dataset="users" plural="team members" />} />
            <ul className="admin-team-list">
              {users.map((member) => {
                const [chosenId, chosenRole] = roleChoice.split('|');
                const chosen = chosenId === member.id ? chosenRole : member.role;
                return (
                  <li key={member.id}>
                    <Avatar src={member.avatar} name={member.name} round />
                    <span className="admin-team-info"><strong>{member.name}</strong><small>{member.email} · {member.status}</small></span>
                    <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.name}</label>
                    <select
                      id={`role-${member.id}`}
                      value={chosen}
                      disabled={busy}
                      onChange={(event) => setRoleChoice(`${member.id}|${event.target.value}`)}
                    >
                      {roleOptions.map((role) => <option key={role}>{role}</option>)}
                    </select>
                    <IconButton
                      label={`Save role for ${member.name}`}
                      icon="check"
                      disabled={busy || chosen === member.role}
                      onClick={() => void saveRole(member)}
                    />
                    <button
                      className="admin-btn admin-btn-light"
                      type="button"
                      disabled={busy}
                      aria-expanded={passwordFor === member.id}
                      onClick={() => { setPasswordFor(passwordFor === member.id ? '' : member.id); setPasswordErrors({}); }}
                    >
                      {passwordFor === member.id ? 'Cancel' : 'Password'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {users.length === 0 && <p className="admin-muted">No team members loaded yet.</p>}

            {passwordFor && (
              <form
                className="admin-password-form"
                noValidate
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  const currentPassword = String(values.get('currentPassword') ?? '');
                  const newPassword = String(values.get('newPassword') ?? '');
                  setPending({ kind: 'password', id: passwordFor });
                  setPasswordErrors({});
                  try {
                    await changePassword(passwordFor, currentPassword, newPassword);
                    form.reset();
                    setPasswordFor('');
                    onNotice('Password updated. Other sessions were signed out.');
                  } catch (passwordError) {
                    // The form deliberately stays open with the new password still
                    // in it: closing it used to discard everything the operator
                    // typed, because a rejected save could not be told apart
                    // from a successful one.
                    setPasswordErrors(causeField(passwordError));
                    onNotice(messageOf(passwordError, 'The password could not be changed.'));
                  } finally {
                    setPending(idle);
                  }
                }}
              >
                <Field name="currentPassword" label="Current password" error={passwordErrors.currentPassword}>
                  <input type="password" name="currentPassword" required autoComplete="current-password" disabled={busy} aria-invalid={passwordErrors.currentPassword ? true : undefined} />
                </Field>
                <Field name="newPassword" label="New password" error={passwordErrors.newPassword} hint="At least 8 characters.">
                  <input type="password" name="newPassword" required minLength={8} autoComplete="new-password" disabled={busy} aria-invalid={passwordErrors.newPassword ? true : undefined} />
                </Field>
                <div className="admin-form-actions">
                  <button className="admin-btn admin-btn-dark" type="submit" disabled={busy}>
                    {pending.kind === 'password' ? <><Spinner /> Updating…</> : 'Update password'}
                  </button>
                </div>
              </form>
            )}

            <form
              className="admin-invite-form"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                setPending({ kind: 'invite' });
                setInviteErrors({});
                try {
                  await saveUser({
                    name: String(values.get('name') ?? '').trim(),
                    email: String(values.get('email') ?? '').trim(),
                    role: String(values.get('role') ?? ''),
                    password: String(values.get('password') ?? ''),
                    avatar: '',
                  });
                  form.reset();
                  onNotice('Team member added. They can sign in with the password you set.');
                } catch (inviteError) {
                  setInviteErrors(fieldErrorsOf(inviteError));
                  onNotice(messageOf(inviteError, 'The team member could not be added.'));
                } finally {
                  setPending(idle);
                }
              }}
            >
              <h3 className="admin-subhead">Add a team member</h3>
              <div className="admin-invite-grid">
                <Field name="name" label="Full name" error={inviteErrors.name}>
                  <input name="name" required minLength={2} maxLength={120} autoComplete="off" disabled={busy} aria-invalid={inviteErrors.name ? true : undefined} />
                </Field>
                <Field name="email" label="Email address" error={inviteErrors.email}>
                  <input name="email" type="email" required maxLength={254} autoComplete="off" disabled={busy} aria-invalid={inviteErrors.email ? true : undefined} />
                </Field>
                <Field name="role" label="Role" error={inviteErrors.role}>
                  <select name="role" defaultValue={roleOptions.find((role) => role !== 'Store Administrator') ?? 'Store Manager'} disabled={busy}>
                    {roleOptions.map((role) => <option key={role}>{role}</option>)}
                  </select>
                </Field>
                <Field name="password" label="Temporary password" error={inviteErrors.password} hint="At least 8 characters.">
                  <input name="password" type="password" required minLength={8} autoComplete="new-password" disabled={busy} aria-invalid={inviteErrors.password ? true : undefined} />
                </Field>
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit" disabled={busy}>
                  {pending.kind === 'invite' ? <><Spinner /> Adding…</> : 'Add team member'}
                </button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Pages" sub="Show or hide a storefront page without deleting it" />
            <ul className="admin-switch-list">
              {pages.map((page) => (
                <li key={page.slug}>
                  <span><strong>{page.label}</strong><small>{page.path}</small></span>
                  <Toggle
                    label={`Show ${page.label}`}
                    checked={page.visible}
                    disabled={busy}
                    onChange={(next) => void togglePage(page.slug, next)}
                  />
                </li>
              ))}
            </ul>
            {pages.length === 0 && <p className="admin-muted">No switchable pages are available.</p>}
          </Panel>

          <Panel>
            <PanelHead title="Notifications" sub="Choose what the team hears about" />
            <ul className="admin-switch-list">
              {notificationRows.map((row) => (
                <li key={row.key}>
                  <span><strong>{row.title}</strong><small>{row.copy}</small></span>
                  <Toggle
                    label={row.title}
                    checked={notifications[row.key] ?? false}
                    disabled={busy}
                    onChange={(next) => toggleNotification(row.key, next)}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="admin-settings-side">
          <Panel>
            <PanelHead title="Store status" />
            <div className="admin-status-card">
              <span className="admin-live"><i />{hiddenPages.length > 0 ? 'Live, with pages hidden' : 'Store is live'}</span>
              <p>{settingsUpdatedAt ? `Settings last saved ${formatStamp(settingsUpdatedAt)}.` : 'These settings have never been changed.'}</p>
              <dl>
                <div><dt>Orders</dt><dd className="is-ok">{summary?.orders ?? 0} placed</dd></div>
                <div><dt>Products</dt><dd className="is-ok">{summary?.products ?? 0} in the catalogue</dd></div>
                <div><dt>Placements</dt><dd>{summary?.jobs ?? 0} open roles</dd></div>
                <div><dt>Reviews</dt><dd>{summary?.reviews ?? 0} records</dd></div>
                <div><dt>Team</dt><dd>{users.length} members</dd></div>
                <div>
                  <dt>Hidden pages</dt>
                  <dd className={hiddenPages.length > 0 ? 'is-warn' : undefined}>
                    {hiddenPages.length > 0 ? hiddenPages.map((page) => page.label).join(', ') : 'None'}
                  </dd>
                </div>
              </dl>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Preview" sub="Storefront sandbox" />
            <div className="admin-switch-list is-compact">
              <li>
                <span><strong>Live preview mode</strong><small>Publish edits straight to the storefront</small></span>
                <Toggle
                  label="Live preview mode"
                  checked={livePreview}
                  disabled={busy}
                  onChange={toggleLivePreview}
                />
              </li>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-light" type="button" disabled={busy} onClick={() => void copyPreviewLink()}>
                {pending.kind === 'copy' ? <><Spinner /> Copying…</> : 'Copy preview link'}
              </button>
            </div>
            <p className="admin-bulk-note" role="status" aria-live="polite">
              {copied === 'done' && 'Storefront link copied to your clipboard.'}
              {copied === 'failed' && 'Your browser blocked the clipboard. Copy the address bar instead.'}
            </p>
          </Panel>

          <Panel className="admin-danger">
            <PanelHead title="Danger zone" sub="These actions cannot be undone" />
            <ul className="admin-danger-list">
              {datasets.map((dataset) => (
                <li key={dataset.key}>
                  <span>
                    <strong>{dataset.label}</strong>
                    <small>{dataset.rowCount} {dataset.rowCount === 1 ? 'row' : 'rows'} · {dataset.visible ? 'visible to shoppers' : 'hidden from shoppers'}</small>
                  </span>
                  <button
                    className="admin-btn admin-btn-outline-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => setDangerFor({ dataset: dataset.key, label: dataset.label })}
                  >
                    {dataset.visible ? 'Hide' : 'Show'}
                  </button>
                </li>
              ))}
              <li>
                <span><strong>Reset demo data</strong><small>Restore every sample order, job and review</small></span>
                <button className="admin-btn admin-btn-outline-danger" type="button" disabled={busy} onClick={() => setDangerFor({ dataset: 'all', label: 'every demo dataset' })}>Reset</button>
              </li>
            </ul>
            {dangerFor && (
              <DangerConfirm
                target={dangerFor}
                busy={pending.kind === 'demo' && pending.dataset === dangerFor.dataset}
                onCancel={() => setDangerFor(null)}
                onConfirm={async () => {
                  const target = dangerFor;
                  const dataset = datasets.find((entry) => entry.key === target.dataset);
                  const hiding = dataset ? dataset.visible : true;
                  setPending({ kind: 'demo', dataset: target.dataset });
                  try {
                    if (target.dataset === 'all') await runDemoAction('all', 'reset-all');
                    else await runDemoAction(target.dataset, hiding ? 'hide' : 'show');
                    setDangerFor(null);
                    onNotice(target.dataset === 'all'
                      ? 'Demo data restored.'
                      : `${target.label} ${hiding ? 'hidden' : 'shown again'}.`);
                  } catch (demoError) {
                    onNotice(messageOf(demoError, 'That demo-data action failed.'));
                  } finally {
                    setPending(idle);
                  }
                }}
              />
            )}
          </Panel>

          {removable.length > 0 && (
            <Panel className="admin-danger">
              <PanelHead title="Remove team member" sub="They lose console access immediately" />
              <ul className="admin-danger-list">
                {removable.map((member) => (
                  <li key={member.id}>
                    <span><strong>{member.name}</strong><small>{member.role}</small></span>
                    <button
                      className="admin-btn admin-btn-outline-danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setPending({ kind: 'remove', id: member.id });

                        try {
                          await removeUser(member.id);
                          onNotice(`${member.name} was removed from the console.`);
                        } catch (removeError) {
                          onNotice(messageOf(removeError, 'That team member could not be removed.'));
                        } finally {
                          setPending(idle);
                        }
                      }}
                    >
                      {pending.kind === 'remove' && pending.id === member.id ? <Spinner /> : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * Points the wrong-field error at the input that caused it.
 *
 * The API reports a rejected current password as a top-level message, so it is
 * attached to that field rather than being dropped.
 */
function causeField(cause: unknown): Record<string, string> {
  if (cause instanceof AdminApiError && cause.code === 'wrong_password') {
    return { currentPassword: cause.message };
  }
  return { newPassword: messageOf(cause, 'The password could not be changed.') };
}

/**
 * A labelled control that owns the id and the `aria-describedby` /
 * `aria-invalid` wiring, so every settings input reports its own problem
 * instead of a single line at the bottom of the page.
 *
 * The label is a sibling rather than a wrapper: a wrapping label's text content
 * becomes the control's accessible name, which would fold any hint or error
 * message into the name a screen reader announces.
 */
function Field({
  name, label, error, hint, wide = false, children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactElement;
}) {
  const unique = useId();
  const id = `settings-${name}-${unique}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : '', hint && !error ? hintId : ''].filter(Boolean).join(' ') || undefined;
  const child = Children.only(children);
  const control = isValidElement<Record<string, unknown>>(child)
    ? cloneElement(child, { id, 'aria-describedby': describedBy })
    : child;
  return (
    <div className={wide ? 'admin-field admin-span-2' : 'admin-field'}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && !error && <small className="admin-field-hint" id={hintId}>{hint}</small>}
      {error && <small className="admin-field-error" id={errorId}>{error}</small>}
    </div>
  );
}

/**
 * A real dialog for the danger zone: focus starts on the safe action, Escape
 * cancels, and focus returns to whatever opened it.
 */
function DangerConfirm({
  target, busy, onCancel, onConfirm,
}: {
  target: { dataset: string; label: string };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [busy, onCancel]);

  const action = target.dataset === 'all'
    ? 'reset every demo dataset back to its sample rows'
    : `${target.dataset === 'products' ? 'unpublish' : 'change'} ${target.label}`;

  return (
    <div className="admin-danger-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h4 id={titleId}>Confirm this action</h4>
      <p>This will {action} immediately.</p>
      <div className="admin-form-actions">
        <button className="admin-btn admin-btn-light" type="button" ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="admin-btn admin-btn-danger" type="button" disabled={busy} onClick={() => void onConfirm()}>
          {busy ? <><Spinner /> Working…</> : 'Yes, continue'}
        </button>
      </div>
    </div>
  );
}

