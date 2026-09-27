import { money, seedAlerts, seedChannel, seedFeed, seedTeam, type IconName } from './AdminData';
import { Avatar, DataTable, Icon, PageHead, Panel, PanelHead, Pill, Stars, Stat } from './AdminUi';

export type DashboardProps = {
  products: Array<{ id: number; name: string; category: string; price: number; image: string; imageUrl: string; units: number; revenue: number }>;
  orders: Array<{ id: string; customer: string; items: number; total: number; date: string; status: string }>;
  alerts: typeof seedAlerts;
  openAlerts: boolean;
  onToggleAlerts: () => void;
  onAddProduct: () => void;
  onExport: () => void;
  onOpenOrders: () => void;
  onOpenJobs: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenProduct: (productId: number) => void;
  adminName: string;
};

const monthlyRevenue: Array<[string, number]> = [
  ['Mar', 2.1],
  ['Apr', 2.6],
  ['May', 1.9],
  ['Jun', 3.1],
  ['Jul', 2.7],
  ['Aug', 3.4],
  ['Sep', 3.2],
];

const categorySplit: Array<[string, number, string]> = [
  ['Makeup', 38, '₹2.42L'],
  ['Skincare', 29, '₹1.86L'],
  ['Fragrance', 19, '₹1.24L'],
  ['Gifting', 14, '₹0.90L'],
];

const alertToneIcon: Record<string, IconName> = {
  warn: 'warn',
  rose: 'heart',
  info: 'spark',
  ok: 'check',
};

export function DashboardPage({
  products,
  orders,
  alerts,
  openAlerts,
  onToggleAlerts,
  onAddProduct,
  onExport,
  onOpenOrders,
  onOpenJobs,
  onOpenOrder,
  onOpenProduct,
  adminName,
}: DashboardProps) {
  const revenuePeak = Math.max(...monthlyRevenue.map(([, value]) => value));
  const visibleAlerts = openAlerts ? alerts : alerts.slice(0, 3);
  const topProducts = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <>
      <PageHead
        crumb="Dashboard"
        title="Dashboard"
        sub={`Welcome back, ${adminName.split(' ')[0]} — here is what is happening with your store today.`}
        actions={
          <>
            <button className="admin-btn admin-btn-light" type="button" onClick={onExport}>Export report</button>
            <button className="admin-btn admin-btn-dark" type="button" onClick={onAddProduct}><Icon name="plus" />Add product</button>
          </>
        }
      />

      <div className="admin-stats">
        <Stat label="Revenue (MTD)" value="₹6.42L" sub="▲ 18.2% vs last month" icon="cart" tone="rose" />
        <Stat label="Orders" value="1,248" sub="▲ 8.2% this month" icon="box" />
        <Stat label="Customers" value="5,024" sub="▲ 5.1% new signups" icon="users" />
        <Stat label="Open roles" value="32" sub="▼ 2.3% vs last month" icon="case" tone="gold" onClick={onOpenJobs} />
      </div>

      <div className="admin-dash">
        <Panel className="admin-dash-chart">
          <PanelHead
            title="Revenue"
            sub="Last 7 months"
            action={<div className="admin-legend"><span className="admin-legend-dot" />Revenue</div>}
          />
          <div
            className="admin-chart"
            role="img"
            aria-label={`Monthly revenue from March to September. Peak ${revenuePeak} lakh in August.`}
          >
            {monthlyRevenue.map(([month, value]) => (
              <div className="admin-chart-col" key={month}>
                <span className="admin-chart-bar" style={{ height: `${Math.round((value / revenuePeak) * 100)}%` }}>
                  <i>{value}L</i>
                </span>
                <small>{month}</small>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="admin-dash-alerts">
          <PanelHead
            title="Needs attention"
            sub={`${alerts.length} open items`}
            action={
              <button className="admin-text-btn" type="button" onClick={onToggleAlerts} aria-expanded={openAlerts}>
                {openAlerts ? 'Show less' : 'View all'}
              </button>
            }
          />
          <ul className="admin-alerts">
            {visibleAlerts.map((alert) => (
              <li className={`is-${alert.tone}`} key={alert.id}>
                <span className="admin-alert-icon"><Icon name={alertToneIcon[alert.tone] ?? 'spark'} /></span>
                <p>{alert.text}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="admin-dash-categories">
          <PanelHead title="Sales by category" sub="This month" />
          <ul className="admin-bars">
            {categorySplit.map(([label, percent, value]) => (
              <li key={label}>
                <span>{label}</span>
                <i className="admin-bar"><b style={{ width: `${percent}%` }} /></i>
                <strong>{value}</strong>
                <em>{percent}%</em>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="admin-dash-feed">
          <PanelHead title="Recent activity" sub="Live updates" />
          <ul className="admin-feed">
            {seedFeed.map((item) => (
              <li key={`${item.name}-${item.time}`}>
                <Avatar src={item.avatar} name={item.name} round />
                <p><strong>{item.name}</strong> {item.text}</p>
                <time>{item.time}</time>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="admin-panel-wide admin-dash-top">
          <PanelHead
            title="Top products"
            sub="By revenue this month"
            action={<button className="admin-text-btn" type="button" onClick={onAddProduct}>View all →</button>}
          />
          <DataTable head={['Product', 'Units', 'Revenue', 'Rating']} minWidth={620}>
            {topProducts.map((product) => (
              <tr key={product.id}>
                <td>
                  <button className="admin-product-cell" type="button" onClick={() => onOpenProduct(product.id)}>
                    <img src={product.imageUrl} alt="" loading="lazy" />
                    <span><strong>{product.name}</strong><small>{product.category}</small></span>
                  </button>
                </td>
                <td>{product.units}</td>
                <td><strong>{money(product.revenue)}</strong></td>
                <td><Stars rating={4.6} /></td>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel className="admin-panel-wide admin-dash-orders">
          <PanelHead
            title="Recent orders"
            sub="Latest from the store"
            action={<button className="admin-text-btn" type="button" onClick={onOpenOrders}>View all →</button>}
          />
          <DataTable head={['Order', 'Customer', 'Items', 'Total', 'Status', '']} minWidth={680}>
            {orders.slice(0, 5).map((order) => (
              <tr key={order.id}>
                <td><strong>{order.id}</strong></td>
                <td>{order.customer}</td>
                <td>{order.items} items</td>
                <td>{money(order.total)}</td>
                <td><Pill label={order.status} /></td>
                <td><button className="admin-text-btn" type="button" onClick={() => onOpenOrder(order.id)}>View</button></td>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel className="admin-dash-team">
          <PanelHead title="Your team" sub="5 members" />
          <ul className="admin-team">
            {seedTeam.map((member) => (
              <li key={member.name}>
                <Avatar src={member.avatar} name={member.name} round />
                <span><strong>{member.name}</strong><small>{member.role}</small></span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="admin-dash-channels">
          <PanelHead title="Sales channels" sub="This month" />
          <div className="admin-donut-wrap">
            <div className="admin-donut" role="img" aria-label="Sales channels: website 52 percent, marketplace 22 percent, walk-in 26 percent.">
              <span>52%<small>Website</small></span>
            </div>
            <ul className="admin-legend-list">
              {seedChannel.map((channel) => (
                <li key={channel.label}>
                  <span className={`admin-legend-dot is-${channel.tone}`} />
                  {channel.label}
                  <strong>{channel.percent}</strong>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
    </>
  );
}
