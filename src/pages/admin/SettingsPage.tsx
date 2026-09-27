import { useState, type FormEvent } from 'react';
import { seedTeam } from './AdminData';
import { Avatar, Icon, PageHead, Panel, PanelHead, Toggle } from './AdminUi';

const notificationRows: Array<{ key: string; title: string; copy: string }> = [
  { key: 'orders', title: 'New order placed', copy: 'Email the store team for every new order.' },
  { key: 'lowStock', title: 'Low stock alert', copy: 'Tell us when a product drops below 15 units.' },
  { key: 'partners', title: 'New partner application', copy: 'Notify when a parlour asks to be listed.' },
  { key: 'reviews', title: 'New product review', copy: 'Notify when a review needs moderation.' },
];

export function SettingsPage({ onNotice }: { onNotice: (message: string) => void }) {
  const [notifications, setNotifications] = useState<Record<string, boolean>>({ orders: true, lowStock: true, partners: true, reviews: false });
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [livePreview, setLivePreview] = useState(true);

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onNotice('Store profile saved.');
  }

  return (
    <>
      <PageHead crumb="Settings" title="Settings" sub="Store profile, delivery, team access and notifications." />

      <div className="admin-settings">
        <div className="admin-settings-main">
          <Panel>
            <PanelHead title="Store profile" sub="Details shown across the storefront" />
            <form onSubmit={saveProfile}>
              <div className="admin-grid-2">
                <label className="admin-field">Store name<input name="storeName" defaultValue="Glow & Grace" /></label>
                <label className="admin-field">Tagline<input name="tagline" defaultValue="A complete beauty & career destination" /></label>
                <label className="admin-field">Contact email<input type="email" name="email" defaultValue="care@glowngrace.in" /></label>
                <label className="admin-field">Phone<input name="phone" defaultValue="+91 98765 43210" /></label>
                <label className="admin-field admin-span-2">Studio address<textarea name="address" rows={3} defaultValue="Hazratganj, Lucknow, Uttar Pradesh 226001" /></label>
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-dark" type="submit">Save profile</button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHead title="Delivery &amp; pricing" sub="Shipping thresholds and tax" />
            <div className="admin-grid-2">
              <label className="admin-field">Free delivery above (₹)<input type="number" name="freeAbove" defaultValue="999" /></label>
              <label className="admin-field">Standard delivery fee (₹)<input type="number" name="deliveryFee" defaultValue="59" /></label>
              <label className="admin-field">GST rate (%)<input type="number" name="gst" defaultValue="18" /></label>
              <label className="admin-field">Return window (days)<input type="number" name="returns" defaultValue="7" /></label>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-dark" type="button" onClick={() => onNotice('Delivery and pricing settings saved.')}>Save delivery settings</button>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Team"
              sub="People helping run the beauty house"
              action={<button className="admin-btn admin-btn-light" type="button" onClick={() => onNotice('Invites are sent from the team email once connected.')}><Icon name="plus" />Invite member</button>}
            />
            <ul className="admin-team-list">
              {seedTeam.map((member) => (
                <li key={member.name}>
                  <Avatar src={member.avatar} name={member.name} round />
                  <span className="admin-team-info"><strong>{member.name}</strong><small>{member.email}</small></span>
                  <label className="sr-only" htmlFor={`role-${member.name.replaceAll(' ', '-')}`}>Role for {member.name}</label>
                  <select
                    id={`role-${member.name.replaceAll(' ', '-')}`}
                    value={roles[member.name] ?? member.role.split(' · ')[0]}
                    onChange={(event) => {
                      setRoles((current) => ({ ...current, [member.name]: event.target.value }));
                      onNotice(`${member.name} is now ${event.target.value}.`);
                    }}
                  >
                    <option>Store Administrator</option>
                    <option>Store Manager</option>
                    <option>Inventory Manager</option>
                    <option>Partnerships Lead</option>
                    <option>Content &amp; Reviews</option>
                    <option>Placements Coordinator</option>
                  </select>
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
                      setNotifications((current) => ({ ...current, [row.key]: next }));
                      onNotice(`${row.title} notifications ${next ? 'enabled' : 'disabled'}.`);
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
              <p>All systems are operating normally. Catalogue sync last ran 4 minutes ago.</p>
              <dl>
                <div><dt>Orders API</dt><dd className="is-ok">Connected</dd></div>
                <div><dt>Placements</dt><dd>Preview data</dd></div>
                <div><dt>Reviews</dt><dd>Preview data</dd></div>
              </dl>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Preview" sub="Storefront sandbox" />
            <div className="admin-switch-list is-compact">
              <li>
                <span><strong>Live preview mode</strong><small>Publish edits straight to the storefront</small></span>
                <Toggle label="Live preview mode" checked={livePreview} onChange={setLivePreview} />
              </li>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-light" type="button" onClick={() => onNotice('Preview link copied to your clipboard.')}>Copy preview link</button>
            </div>
          </Panel>

          <Panel className="admin-danger">
            <PanelHead title="Danger zone" sub="These actions cannot be undone" />
            <ul className="admin-danger-list">
              <li>
                <span><strong>Reset demo data</strong><small>Restore the sample orders, jobs and reviews</small></span>
                <button className="admin-btn admin-btn-outline-danger" type="button" onClick={() => onNotice('Demo data reset to the original sample set.')}>Reset</button>
              </li>
              <li>
                <span><strong>Pause storefront</strong><small>Temporarily hide the storefront from shoppers</small></span>
                <button className="admin-btn admin-btn-outline-danger" type="button" onClick={() => onNotice('The storefront stays visible. Pausing needs a live store connection.')}>Pause</button>
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
