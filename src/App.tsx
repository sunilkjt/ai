import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Screener from './pages/Screener';
import Markets from './pages/Markets';
import Analyst from './pages/Analyst';
import Signals from './pages/Signals';
import Watchlist from './pages/Watchlist';
import Backtest from './pages/Backtest';
import AgentMonitor from './pages/AgentMonitor';
import History from './pages/History';
import Settings from './pages/Settings';
import SignalDetail from './pages/SignalDetail';

export default function App(): JSX.Element {
  // Adapts to host: '/' locally & on Vercel, '/ai' on GitHub Project Pages.
  const base = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <BrowserRouter basename={base}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="screener" element={<Screener />} />
          <Route path="markets" element={<Markets />} />
          <Route path="analyst" element={<Analyst />} />
          <Route path="signals" element={<Signals />} />
          <Route path="signals/:id" element={<SignalDetail />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="backtest" element={<Backtest />} />
          <Route path="agents" element={<AgentMonitor />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
