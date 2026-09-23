import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Markets from './pages/Markets';
import Analyst from './pages/Analyst';
import Signals from './pages/Signals';
import Watchlist from './pages/Watchlist';
import Backtest from './pages/Backtest';
import History from './pages/History';
import Settings from './pages/Settings';
import SignalDetail from './pages/SignalDetail';

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="markets" element={<Markets />} />
          <Route path="analyst" element={<Analyst />} />
          <Route path="signals" element={<Signals />} />
          <Route path="signals/:id" element={<SignalDetail />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="backtest" element={<Backtest />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
