import { useEffect, useState, type FormEvent } from 'react';
import { useAdminStore } from './AdminStore';
import { Avatar, IconButton, PageHead, Panel, PanelHead, Toggle } from './AdminUi';

const notificationRows: Array<{ key: string; title: string; copy: string }> = [
  { key: 'orders', title: 'New order placed', copy: 'Email the store team for every new order.' },
  { key: 'lowStock', title: 'Low stock alert', copy: 'Tell us when a product drops below 15 units.' },
  { key: 'partners', title: 'New partner application', copy: 'Notify when a parlour asks to be listed.' },
  { key: 'reviews', title: 'New product review', copy: 'Notify when a review needs moderation.' },
];

const emptyProfile = { storeName: '', tagline: '', email: '', phone: '', address: '' };
const emptyDelivery = { freeAbove: 0, deliveryFee: 0, gst: 0, returns: 0 };

export function SettingsPage({ onNotice }: { onNotice: (message: string) => void }) {
  const { users, roles, pages, datasets, settings, summary, saveSettings, saveUser, removeUser, changePassword, setPageVisible, runDemoAction } = useAdminStore();
  const [profile, setProfile] = useState(emptyProfile);
  const [delivery, setDelivery] = useState(emptyDelivery);
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingRole, setPendingRole] = useState('');
  const [passwordFor, setPasswordFor] = useState('');
  const [dangerFor, setDangerFor] = useState<{ dataset: string; label: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setProfile(settings.profile);
    setDelivery(settings.delivery);
    setNotifications(settings.notifications);
  }, [settings]);

  async function persist(next: Partial<typeof settings> = {}, message: string) {
    setSaving(true);
    setError('');
    try {
      await saveSettings({ profile, delivery, notifications, ...next });
      onNotice(message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist({}, 'Store profile saved.');
  }

  function saveDelivery() {
    void persist({
      delivery: {
        freeAbove: Number(delivery.freeAbove),
        deliveryFee: Number(delivery.deliveryFee),
        gst: Number(delivery.gst),
        returns: Number(delivery.returns),
      },
    }, 'Delivery and pricing settings saved.');
  }

  return (
    <>
      <PageHead crumb="Settings" title="Settings" sub="Store profile, delivery, team access, pages and demo data." />

      <div className="admin-settings">
        <div className="admin-settings-main">
          <Panel>
            <PanelHead title="Store profile" sub="Details shown across the storefront" />
            <form onSubmit={saveProfile}>
              <div className="admin-grid-2">
                <label className="admin-field">Store name<input name="storeName" value={profile.storeName} onChange={(event) => setProfile((current) => ({ ...current, storeName: event.target.value }))} /></label>
                <label className="admin-field">Tagline<input name="tagline" value={profile.tagline} onChange={(event) => setProfile((current) => ({ ...current, tagline: event.target.value }))} /></label>
                <label className="admin-field">Contact email<input type="email" name="email" value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} /></label>
                <label className="admin-field">Phone<input name="phone" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label className="admin-field admin-span-2">Studio address<textarea name="address" rows={3} value={profile.address} onChange={(event) => setProfile((current) => ({ ...current, address: event.target.value }))} /></label>
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Delivery &amp; pricing" sub="Shipping thresholds and tax" />
            <div className="admin-grid-2">
              <label className="admin-field">Free delivery above (₹)<input type="number" name="freeAbove" value={delivery.freeAbove} onChange={(event) => setDelivery((current) => ({ ...current, freeAbove: Number(event.target.value) }))} /></label>
              <label className="admin-field">Standard delivery fee (₹)<input type="number" name="deliveryFee" value={delivery.deliveryFee} onChange={(event) => setDelivery((current) => ({ ...current, deliveryFee: Number(event.target.value) }))} /></label>
              <label className="admin-field">GST rate (%)<input type="number" name="gst" value={delivery.gst} onChange={(event) => setDelivery((current) => ({ ...current, gst: Number(event.target.value) }))} /></label>
              <label className="admin-field">Return window (days)<input type="number" name="returns" value={delivery.returns} onChange={(event) => setDelivery((current) => ({ ...current, returns: Number(event.target.value) }))} /></label>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-dark" type="button" onClick={saveDelivery} disabled={saving}>Save delivery settings</button>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Team" sub="People helping run the beauty house" />
            <ul className="admin-team-list">
              {users.map((member) => (
                <li key={member.id}>
                  <Avatar src={member.avatar} name={member.name} round />
                  <span className="admin-team-info"><strong>{member.name}</strong><small>{member.email} · {member.status}</small></span>
                  <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.name}</label>
                  <select
                    id={`role-${member.id}`}
                    value={pendingRole && pendingRole.split('|')[0] === member.id ? pendingRole.split('|')[1] : member.role}
                    onChange={(event) => setPendingRole(`${member.id}|${event.target.value}`)}
                    disabled={saving}
                  >
                    {(roles.length > 0 ? roles : [member.role]).map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <IconButton
                    label={`Save role for ${member.name}`}
                    icon="check"
                    onClick={async () => {
                      if (!pendingRole || pendingRole.split('|')[0] !== member.id) {
                        onNotice('Pick a role first, then save it.');
                        return;
                      }
                      setSaving(true);
                      setError('');
                      try {
                        await saveUser({ role: pendingRole.split('|')[1] }, member.id);
                        setPendingRole('');
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : 'The role could not be changed.');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                  <button className="admin-btn admin-btn-light" type="button" onClick={() => setPasswordFor(passwordFor === member.id ? '' : member.id)}>
                    {passwordFor === member.id ? 'Cancel' : 'Password'}
                  </button>
                </li>
              ))}
            </ul>
            {passwordFor && (
              <form
                className="admin-password-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  setSaving(true);
                  setError('');
                  try {
                    await changePassword(
                      passwordFor,
                      String(values.get('currentPassword') ?? ''),
                      String(values.get('newPassword') ?? ''),
                    );
                    form.reset();
                    setPasswordFor('');
                  } catch (saveError) {
                    setError(saveError instanceof Error ? saveError.message : 'The password could not be changed.');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label className="admin-field">Current password<input type="password" name="currentPassword" required autoComplete="current-password" /></label>
                <label className="admin-field">New password<input type="password" name="newPassword" required minLength={8} autoComplete="new-password" /></label>
                <div className="admin-form-actions">
                  <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>Update password</button>
                </div>
              </form>
            )}
            {users.length === 0 && <p className="admin-muted">No team members loaded yet.</p>}
            <form
              className="admin-invite-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                setSaving(true);
                setError('');
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
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : 'The team member could not be added.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              <h3 className="admin-subhead">Add a team member</h3>
              <div className="admin-invite-grid">
                <label className="admin-field">Full name<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
                <label className="admin-field">Email address<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
                <label className="admin-field">Role
                  <select name="role" defaultValue={roles.find((role) => role !== 'Store Administrator') ?? 'Store Manager'}>
                    {(roles.length > 0 ? roles : ['Store Manager', 'Content Editor', 'Support']).map((role) => <option key={role}>{role}</option>)}
                  </select>
                </label>
                <label className="admin-field">Temporary password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>Add team member</button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Pages" sub="Hide a storefront page without deleting it" />
            <ul className="admin-switch-list">
              {pages.map((page) => (
                <li key={page.slug}>
                  <span><strong>{page.label}</strong><small>{page.path}</small></span>
                  <Toggle
                    label={`Show ${page.label}`}
                    checked={page.visible}
                    onChange={(next) => { void setPageVisible(page.slug, next); }}
                  />
                </li>
              ))}
            </ul>
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
                    onChange={(next) => {
                      const updated = { ...notifications, [row.key]: next };
                      setNotifications(updated);
                      void persist({ notifications: updated }, `${row.title} notifications ${next ? 'enabled' : 'disabled'}.`);
                    }}
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
              <span className="admin-live"><i />Store is live</span>
              <p>Catalogue sync last ran 4 minutes ago.</p>
              <dl>
                <div><dt>Orders API</dt><dd className="is-ok">Connected</dd></div>
                <div><dt>Products</dt><dd className="is-ok">{summary?.products ?? 0} live</dd></div>
                <div><dt>Placements</dt><dd>{summary?.jobs ?? 0} open roles</dd></div>
                <div><dt>Reviews</dt><dd>{summary?.reviews ?? 0} records</dd></div>
                <div><dt>Hidden pages</dt><dd>{pages.filter((page) => !page.visible).length}</dd></div>
              </dl>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Preview" sub="Storefront sandbox" />
            <div className="admin-switch-list is-compact">
              <li>
                <span><strong>Live preview mode</strong><small>Publish edits straight to the storefront</small></span>
                <Toggle label="Live preview mode" checked onChange={(next) => onNotice(`Live preview mode ${next ? 'enabled' : 'disabled'}.`)} />
              </li>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-light" type="button" onClick={() => onNotice('Preview link copied to your clipboard.')}>Copy preview link</button>
            </div>
          </Panel>

          <Panel className="admin-danger">
            <PanelHead title="Danger zone" sub="These actions cannot be undone" />
            <ul className="admin-danger-list">
              {datasets.filter((dataset) => dataset.seeded).map((dataset) => (
                <li key={dataset.key}>
                  <span><strong>{dataset.label}</strong><small>{dataset.rowCount} rows · {dataset.visible ? 'visible to shoppers' : 'hidden from shoppers'}</small></span>
                  <button
                    className="admin-btn admin-btn-outline-danger"
                    type="button"
                    onClick={() => setDangerFor({ dataset: dataset.key, label: dataset.label })}
                  >
                    {dataset.visible ? 'Hide' : 'Show'}
                  </button>
                </li>
              ))}
              <li>
                <span><strong>Reset demo data</strong><small>Restore the sample orders, jobs and reviews</small></span>
                <button className="admin-btn admin-btn-outline-danger" type="button" onClick={() => setDangerFor({ dataset: 'all', label: 'every demo dataset' })}>Reset</button>
              </li>
            </ul>
            {dangerFor && (
              <div className="admin-danger-confirm" role="alertdialog" aria-label={`Confirm ${dangerFor.label} action`}>
                <p>
                  This will {dangerFor.dataset === 'all' ? 'reset every demo dataset' : `${dangerFor.dataset === 'products' ? 'unpublish' : 'change'} ${dangerFor.label}`} immediately.
                </p>
                <div className="admin-form-actions">
                  <button className="admin-btn admin-btn-light" type="button" onClick={() => setDangerFor(null)}>Cancel</button>
                  <button
                    className="admin-btn admin-btn-danger"
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      const target = dangerFor;
                      setDangerFor(null);
                      setSaving(true);
                      setError('');
                      try {
                        const dataset = datasets.find((entry) => entry.key === target.dataset);
                        if (target.dataset === 'all') await runDemoAction('all', 'reset-all');
                        else if (dataset) await runDemoAction(target.dataset, dataset.visible ? 'hide' : 'show');
                        else if (summary?.hiddenDatasets.includes(target.dataset)) await runDemoAction(target.dataset, 'show');
                        else await runDemoAction(target.dataset, 'hide');
                      } catch (actionError) {
                        setError(actionError instanceof Error ? actionError.message : 'That demo-data action failed.');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Yes, continue
                  </button>
                </div>
              </div>
            )}
          </Panel>

          {users.length > 1 && (
            <Panel className="admin-danger">
              <PanelHead title="Remove team member" sub="They lose console access immediately" />
              <ul className="admin-danger-list">
                {users.filter((member) => member.role !== 'Store Administrator').map((member) => (
                  <li key={member.id}>
                    <span><strong>{member.name}</strong><small>{member.role}</small></span>
                    <button
                      className="admin-btn admin-btn-outline-danger"
                      type="button"
                      onClick={async () => {
                        setSaving(true);
                        setError('');
                        try {
                          await removeUser(member.id);
                        } catch (removeError) {
                          setError(removeError instanceof Error ? removeError.message : 'That team member could not be removed.');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {error && <p className="admin-alert-inline" role="alert">{error}</p>}
        </aside>
      </div>
    </>
  );
}
