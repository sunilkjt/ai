import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { scanUniverse } from '../services/screener';
import { getAIProvider } from '../providers/ai/factory';
import { Card, Badge, CategoryTabs, CategoryBadge } from '../components/ui';
import { fmtPrice, fmtPct, timeAgo } from '../utils/format';
import type { CategoryFilter } from '../config/app';
import type { ScreenResult } from '../types';
import { log } from '../utils/logger';

type DirTab = 'ALL' | 'LONG' | 'SHORT' | 'WAIT';

function dirOf(r: ScreenResult): 'LONG' | 'SHORT' | 'WAIT' {
  if (r.aiDirection === 'LONG' || r.aiDirection === 'SHORT') return r.aiDirection;
  return 'WAIT';
}

function SignalCard({ r }: { r: ScreenResult }): JSX.Element {
  const [open, setOpen] = useState(false);
  const selectSymbol = useStore((s) => s.selectSymbol);
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontSize: 16 }}>{r.displaySymbol}</strong>{' '}
          <span className="muted">{r.assetName}</span>{' '}
          <CategoryBadge value={r.category} /> <span className="badge">{r.dexLabel}</span>{' '}
          <Badge value={r.aiDirection} /> <span className="badge">{r.status}</span>
          {r.stale && <span className="badge wait">STALE</span>}
        </div>
        <div className="row">
          <span className="muted">Quality {r.setupQuality ?? '—'} · Conf {r.confluence} · Trap {r.trapRisk ?? '—'}</span>
          <button className="btn secondary" onClick={() => setOpen((o) => !o)}>{open ? 'Collapse' : 'Why?'}</button>
          <Link className="btn" to="/analyst" onClick={() => selectSymbol(r.marketId)}>Review →</Link>
        </div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span>Price {fmtPrice(r.price)}</span>
        <span className={(r.change24h ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtPct(r.change24h)}</span>
        <span className="muted">Entry {fmtPrice(r.entry)} · SL {fmtPrice(r.stopLoss)} · TP1 {fmtPrice(r.takeProfit1)}{r.takeProfit2 ? ` · TP2 ${fmtPrice(r.takeProfit2)}` : ''} · R:R {r.riskReward?.toFixed(2) ?? '—'}</span>
        <span className="muted">AI {r.aiConfidence != null ? `${r.aiConfidence}/100 via ${r.aiProvider}` : 'not reviewed'}</span>
      </div>
      {open && (
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <div>
            <strong>WHY?</strong>
            <ul className="tight">{r.why.map((w, i) => <li key={i}>✓ {w}</li>)}</ul>
            {r.longSetup?.candidate && r.aiDirection === 'LONG' && (
              <ul className="tight">{r.longSetup.checks.filter((c) => c.pass).map((c, i) => <li key={i}>✓ {c.name}: {c.detail}</li>)}</ul>
            )}
            {r.shortSetup?.candidate && r.aiDirection === 'SHORT' && (
              <ul className="tight">{r.shortSetup.checks.filter((c) => c.pass).map((c, i) => <li key={i}>✓ {c.name}: {c.detail}</li>)}</ul>
            )}
          </div>
          <div>
            <strong>AGAINST / RISKS</strong>
            <ul className="tight">{r.against.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
            {(r.aiDirection === 'WAIT' && (r.longSetup?.missing.length || r.shortSetup?.missing.length)) ? (
              <div className="muted">Waiting for: {[...(r.longSetup?.missing ?? []), ...(r.shortSetup?.missing ?? [])].slice(0, 3).join(' · ')}</div>
            ) : null}
          </div>
          <div>
            <strong>AI CRITIC</strong>
            <div className="muted">{r.criticSummary ?? 'No AI review in this scan slice.'}</div>
          </div>
          <div>
            <strong>INVALIDATION</strong>
            <div className="muted">{r.invalidation}</div>
            <div className="muted" style={{ marginTop: 4 }}>{r.statusReason}</div>
          </div>
        </div>
      )}
      {open && r.explanation && <div style={{ marginTop: 8 }}>{r.explanation}</div>}
    </div>
  );
}

export default function Screener(): JSX.Element {
  const markets = useStore((s) => s.markets);
  const marketsLoading = useStore((s) => s.marketsLoading);
  const screenResults = useStore((s) => s.screenResults);
  const screenStats = useStore((s) => s.screenStats);
  const scanning = useStore((s) => s.scanning);
  const setScreener = useStore((s) => s.setScreener);
  const scanProgress = useStore((s) => s.scanProgress);
  const lastScanAt = useStore((s) => s.lastScanAt);
  const autoScanMinutes = useStore((s) => s.autoScanMinutes);
  const newMarketIds = useStore((s) => s.newMarketIds);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const riskPercent = useStore((s) => s.riskPercent);
  const leverage = useStore((s) => s.leverage);
  const accountBalance = useStore((s) => s.accountBalance);
  const memory = useStore((s) => s.memory);

  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [dir, setDir] = useState<DirTab>('ALL');
  const [error, setError] = useState('');

  async function runScan(): Promise<void> {
    if (useStore.getState().scanning) return;
    if (markets.length === 0) {
      setError('No Hyperliquid markets discovered yet — scan unavailable.');
      return;
    }
    setError('');
    setScreener({ scanning: true, scanProgress: { done: 0, total: markets.length } });
    log('SCREEN', `Scan started over ${markets.length} markets`);
    try {
      const st = useStore.getState();
      const { results, stats, ledger } = await scanUniverse(markets, {
        aiProvider: aiEnabled ? getAIProvider() : null,
        aiEnabled,
        riskOpts: { accountBalance: st.accountBalance, riskPercent: st.riskPercent, leverage: st.leverage },
        memoryOf: (symbol) => useStore.getState().memory[symbol] ?? [],
        onProgress: (done, total) => useStore.getState().setScreener({ scanProgress: { done, total } }),
      });
      setScreener({
        screenResults: results,
        screenStats: stats,
        scanning: false,
        scanProgress: null,
        lastScanAt: Date.now(),
        lastAgentLedger: ledger,
      });
      log('SCREEN', `Scan done: ${results.length} results, LONG ${stats.longCount} SHORT ${stats.shortCount} in ${(stats.durationMs / 1000).toFixed(1)}s`);
    } catch (e) {
      setScreener({ scanning: false });
      setError(e instanceof Error ? e.message : 'scan failed');
    }
  }

  useEffect(() => {
    if (!autoScanMinutes) return;
    const t = setInterval(() => { void runScan(); }, autoScanMinutes * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanMinutes, markets.length]);

  const rows = useMemo(() => {
    return screenResults.filter((r) => {
      if (category !== 'ALL' && r.category !== category) return false;
      if (dir !== 'ALL' && dirOf(r) !== dir) return false;
      return true;
    });
  }, [screenResults, category, dir]);

  const longs = screenResults.filter((r) => dirOf(r) === 'LONG').length;
  const shorts = screenResults.filter((r) => dirOf(r) === 'SHORT').length;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>AI Market Screener</h1>
          <p>Two-stage screening: fast deterministic scan → AI review of the top slice. Setup quality, never profit odds.</p>
        </div>
        <div className="row">
          <label className="muted">Auto
            <select value={autoScanMinutes} onChange={(e) => setScreener({ autoScanMinutes: Number(e.target.value) })}>
              <option value={0}>Off</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
            </select>
          </label>
          <button className="btn" disabled={scanning || marketsLoading} onClick={() => void runScan()}>
            {scanning ? 'Scanning…' : screenStats ? 'Re-scan' : 'Scan Now'}
          </button>
        </div>
      </div>

      {screenStats && (
        <Card title={`Last scan ${timeAgo(screenStats.finishedAt)} · ${(screenStats.durationMs / 1000).toFixed(1)}s`}>
          <div className="row">
            <span>Discovered: <strong>{screenStats.discovered}</strong></span>
            <span>Scanned: <strong>{screenStats.scanned}</strong></span>
            <span>Stage-0 rejected: <strong>{screenStats.stage0Rejected}</strong></span>
            <span>Shortlisted: <strong>{screenStats.fastCandidates}</strong></span>
            <span>AI reviewed: <strong>{screenStats.aiReviewed}</strong></span>
            <span>LONG: <strong className="positive">{screenStats.longCount}</strong></span>
            <span>SHORT: <strong className="negative">{screenStats.shortCount}</strong></span>
            <span>WAIT: <strong>{screenStats.waitCount}</strong></span>
            <span>Rejected: <strong>{screenStats.rejected}</strong></span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            Ranking: Highest Setup Quality first. AI assessment confidence — not probability of profit.
            {newMarketIds.length > 0 && <> {newMarketIds.length} new market(s) discovered since last visit — re-scan to include them.</>}
          </div>
        </Card>
      )}

      {error && <div className="banner">{error}</div>}
      {markets.length === 0 && !marketsLoading && <div className="banner">LIVE ANALYSIS UNAVAILABLE — no Hyperliquid markets discovered. Demo data is never screened as live.</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <CategoryTabs value={category} onChange={setCategory} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {(['ALL', 'LONG', 'SHORT', 'WAIT'] as DirTab[]).map((d) => (
          <button key={d} className={`btn${dir === d ? '' : ' secondary'}`} onClick={() => setDir(d)}>{d}</button>
        ))}
        <span className="muted">{longs} long · {shorts} short in current results</span>
      </div>

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 && !scanning && (
          <div className="banner">
            {screenStats ? 'No candidates under these filters. WAIT is a valid state.' : 'Run Scan Now — the screener analyzes the whole Hyperliquid universe so you do not have to open every market.'}
          </div>
        )}
        {scanning && screenResults.length === 0 && <div className="banner">Scanning the Hyperliquid universe… (fast deterministic stage first, AI only on the top slice)</div>}
        {scanning && scanProgress && <div className="banner">Stage 1 scanning {scanProgress.done}/{scanProgress.total} markets…</div>}
        {rows.map((r) => <SignalCard key={r.marketId} r={r} />)}
      </div>
    </div>
  );
}
