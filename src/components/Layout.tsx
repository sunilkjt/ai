import { NavLink, Outlet } from 'react-router-dom';
import { APP_CONFIG } from '../config/app';
import { useStore } from '../store/useStore';
import { useMarketDiscovery } from '../hooks/useMarketData';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/screener', label: 'Market Screener', icon: '◎' },
  { to: '/markets', label: 'Markets', icon: '▦' },
  { to: '/analyst', label: 'AI Analyst', icon: '✦' },
  { to: '/signals', label: 'Signals', icon: '⚡' },
  { to: '/watchlist', label: 'Watchlist', icon: '★' },
  { to: '/backtest', label: 'Backtest', icon: '⬣' },
  { to: '/agents', label: 'Agent Monitor', icon: '⬡' },
  { to: '/history', label: 'History', icon: '◔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout(): JSX.Element {
  useMarketDiscovery();
  const lastUpdated = useStore((s) => s.lastUpdated);
  const marketsUpdatedAt = useStore((s) => s.marketsUpdatedAt);
  const markets = useStore((s) => s.markets);
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">
          {APP_CONFIG.appName}
          <small>{APP_CONFIG.fullName}</small>
          <small style={{ color: '#4f8cff' }}>{APP_CONFIG.tagline}</small>
        </div>
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {l.icon} <span>{l.label}</span>
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '8px', fontSize: 11, color: '#8b96ab' }}>
          <div>{markets.length} Hyperliquid markets</div>
          <div>{marketsUpdatedAt ? `Discovered ${new Date(marketsUpdatedAt).toLocaleTimeString()}` : 'Discovering…'}</div>
          <div>{lastUpdated ? `Analyzed ${new Date(lastUpdated).toLocaleTimeString()}` : ''}</div>
        </div>
      </nav>
      <main className="main">
        <Outlet />
        <div className="disclaimer">{APP_CONFIG.disclaimer}</div>
      </main>
    </div>
  );
}
