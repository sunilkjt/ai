import { useMemo, useState } from 'react';
import { TIMEFRAMES } from '../config/app';
import { useStore, filteredMarkets } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { analyzeSymbol } from '../services/marketService';
import { getAIProvider } from '../providers/ai/factory';
import { runFullAnalysis } from '../agents/orchestrator';
import { Card, Badge, RegimeBadge, CategoryBadge } from '../components/ui';
import { fmtPrice } from '../utils/format';
import { log } from '../utils/logger';

export default function Analyst(): JSX.Element {
  useMarketPolling(false);
  const markets = useStore((s) => s.markets);
  const category = useStore((s) => s.category);
  const dexFilter = useStore((s) => s.dexFilter);
  const search = useStore((s) => s.search);
  const selectedSymbol = useStore((s) => s.selectedSymbol);
  const selectSymbol = useStore((s) => s.selectSymbol);
  const analyses = useStore((s) => s.analyses);
  const fullAnalyses = useStore((s) => s.fullAnalyses);
  const setFull = useStore((s) => s.setFull);
  const executionTimeframe = useStore((s) => s.executionTimeframe);
  const setExecutionTimeframe = useStore((s) => s.setExecutionTimeframe);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const setRisk = useStore((s) => s.setRisk);
  const riskPercent = useStore((s) => s.riskPercent);
  const leverage = useStore((s) => s.leverage);
  const accountBalance = useStore((s) => s.accountBalance);
  const loading = useStore((s) => s.loading);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => filteredMarkets({ markets, category, search, dexFilter }).slice(0, 200), [markets, category, search, dexFilter]);
  const effectiveSymbol = options.some((m) => m.internalSymbol === selectedSymbol) ? selectedSymbol : (options[0]?.internalSymbol ?? selectedSymbol);
  const analysis = analyses[effectiveSymbol];
  const full = fullAnalyses[effectiveSymbol];
  const market = markets.find((m) => m.internalSymbol === effectiveSymbol);

  const exec = useMemo(
    () => analysis?.timeframes.find((t) => t.timeframe === executionTimeframe) ?? analysis?.timeframes[3],
    [analysis, executionTimeframe],
  );

  async function requestAI(): Promise<void> {
    if (!analysis) return;
    setBusy(true);
    setError('');
    try {
      log('AI', `Analysis requested for ${effectiveSymbol} (${analysis.category})`);
      if (!aiEnabled) {
        const fresh = await analyzeSymbol(effectiveSymbol, { executionTimeframe, withAI: true, aiProvider: null, riskOpts: { accountBalance, riskPercent, leverage }, markets });
        if (fresh.full) setFull(effectiveSymbol, fresh.full);
      } else {
        const result = await runFullAnalysis({
          symbol: analysis.symbol,
          category: analysis.category,
          identity: analysis.identity,
          executionTimeframe,
          price: analysis.price,
          regime: analysis.regime,
          timeframes: analysis.timeframes,
          confluence: {
            total: analysis.signal.confluenceScore,
            band: analysis.signal.confluenceScore >= 75 ? 'STRONG' : analysis.signal.confluenceScore >= 60 ? 'MODERATE' : analysis.signal.confluenceScore >= 40 ? 'DEVELOPING' : 'WEAK',
            direction: analysis.signal.direction === 'WAIT' ? 'NEUTRAL' : analysis.signal.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
            items: [],
            supportingReasons: analysis.signal.supportingReasons,
            opposingReasons: analysis.signal.opposingReasons,
          },
          signal: analysis.signal,
          derivatives: analysis.derivatives,
          hyperliquid: analysis.hyperliquid,
          assetInsights: analysis.assetInsights,
          provider: getAIProvider(),
          riskOpts: { accountBalance, riskPercent, leverage },
          forceRefresh: true,
        });
        setFull(effectiveSymbol, result);
        log('FINAL', `${effectiveSymbol} final decision: ${result.finalDecision}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI analysis failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>AI Analyst {market ? <><CategoryBadge value={market.category} /> <span className="muted">{market.displaySymbol} · Hyperliquid perp</span></> : null}</h1>
          <p>Deterministic facts first · AI reasons over them · critic validates · risk engine prices the trade. AI assessment confidence — not probability of profit.</p>
        </div>
        <div className="row">
          <select value={effectiveSymbol} onChange={(e) => selectSymbol(e.target.value)}>
            {options.map((m) => <option key={m.internalSymbol} value={m.internalSymbol}>{m.displaySymbol} · {m.assetName} · {m.category} · {m.dexLabel}</option>)}
          </select>
          <select value={executionTimeframe} onChange={(e) => setExecutionTimeframe(e.target.value)}>
            {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.label}</option>)}
          </select>
          <button className="btn" disabled={busy || !analysis} onClick={() => void requestAI()}>
            {busy ? 'Analyzing…' : full ? 'Re-analyze' : 'Analyze with AI'}
          </button>
        </div>
      </div>

      {!analysis && <div className="banner">{loading[effectiveSymbol] ? 'Loading market data…' : 'Waiting for data — select a market above.'}</div>}
      {error && <div className="banner">AI error: {error} — deterministic analysis still available.</div>}

      {analysis && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Card
              title={`Market · ${analysis.assetName}`}
              action={analysis.stale ? <span className="badge wait">STALE — not live</span> : <span className="badge">LIVE</span>}
            >
              <dl className="kv">
                <dt>Market</dt><dd>{analysis.symbol} · {analysis.assetName}</dd>
                <dt>DEX</dt><dd>{analysis.dexLabel} ({analysis.dex === '' ? 'main Hyperliquid dex' : `actual dex "${analysis.dex}"`})</dd>
                <dt>Underlying</dt><dd>{analysis.identity.underlying}</dd>
                <dt>Category</dt><dd><CategoryBadge value={analysis.category} /> <span className="muted">via {analysis.identity.classificationSource}</span></dd>
                <dt>Last</dt><dd>{fmtPrice(analysis.price)}</dd>
                <dt>Mark</dt><dd>{analysis.derivatives.markPrice != null ? fmtPrice(analysis.derivatives.markPrice) : 'N/A'}</dd>
                <dt>Oracle</dt><dd>{analysis.derivatives.oraclePrice != null ? fmtPrice(analysis.derivatives.oraclePrice) : 'N/A'}</dd>
                <dt>24H volume</dt><dd>{analysis.derivatives.dayVolumeNotional != null ? `$${Math.round(analysis.derivatives.dayVolumeNotional).toLocaleString()}` : 'N/A'}</dd>
                <dt>Open interest</dt><dd>{analysis.openInterest != null ? analysis.openInterest.toLocaleString() : 'N/A'}</dd>
                <dt>Funding</dt><dd>{analysis.fundingRate != null ? `${(analysis.fundingRate * 100).toFixed(4)}%` : 'N/A'}</dd>
              </dl>
              {analysis.stale && <div className="muted">Discovery data is stale — the AI is told not to present this read as live.</div>}
            </Card>
          </div>
          <div className="grid grid-4">
            <Card title="Market regime"><div className="big"><RegimeBadge value={analysis.regime} /></div><div className="muted">{analysis.category} · higher-TF vs execution-TF synthesis</div></Card>
            <Card title="AI assessment">
              <div className="big">{full?.ai ? <Badge value={full.finalDecision} /> : <span className="muted">—</span>}</div>
              <div className="muted">
                {full?.ai ? <>confidence {full.ai.confidence}/100 · via {full.ai.provider}{full.ai.cached ? ' · cached' : ''}</> : 'Run AI analysis to get a validated decision'}
              </div>
              <div className="muted">Direction bias: <Badge value={analysis.signal.direction} /></div>
            </Card>
            <Card title="Confidence">
              <div className="big">{full?.ai ? `${full.ai.confidence}/100` : '—'}</div>
              <div className="muted">AI assessment confidence — not probability of profit.</div>
            </Card>
            <Card title="Price">
              <div className="big">{fmtPrice(analysis.price)}</div>
              <div className="muted">RSI {exec?.indicators.rsi != null ? exec.indicators.rsi.toFixed(1) : '—'} · ATR {exec?.indicators.atrPercent?.toFixed(2) ?? '—'}% · Vol {exec?.indicators.volumeState}</div>
              <div className="muted">OI {analysis.openInterest != null ? analysis.openInterest.toLocaleString() : 'N/A'} · Funding {analysis.fundingRate != null ? `${(analysis.fundingRate * 100).toFixed(4)}%` : 'N/A'}</div>
            </Card>
          </div>

          {analysis.assetInsights.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Card title={`${analysis.category} lens — asset-aware notes`}>
                <ul className="tight">{analysis.assetInsights.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </Card>
            </div>
          )}

          {full?.ai && (
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <Card title="Why? — supporting factors">
                <ul className="tight">{full.ai.supportingFactors.map((f, i) => <li key={i}>✓ {f}</li>)}</ul>
              </Card>
              <Card title="Risks — opposing factors">
                <ul className="tight">{full.ai.opposingFactors.map((f, i) => <li key={i}>⚠ {f}</li>)}</ul>
              </Card>
            </div>
          )}

          {full?.ai && (
            <div style={{ marginTop: 12 }}>
              <Card title="AI explanation"><div>{full.ai.explanation}</div><div className="muted" style={{ marginTop: 6 }}>Invalidation: {full.ai.invalidation}</div></Card>
            </div>
          )}

          {full?.critique && (
            <div style={{ marginTop: 12 }}>
              <div className="critic">
                <strong>WHAT COULD MAKE THIS TRADE FAIL? {full.critique.downgraded ? '(downgraded to WAIT)' : ''}</strong>
                <div style={{ marginTop: 6 }}>Verdict: <Badge value={full.critique.verdict} /></div>
                <ul className="tight">{full.critique.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                <div>{full.critique.critique}</div>
              </div>
            </div>
          )}

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <Card title="Trade plan (deterministic risk engine)">
              {full?.risk && (full.finalDecision === 'LONG' || full.finalDecision === 'SHORT') ? (
                <dl className="kv">
                  <dt>Entry</dt><dd>{fmtPrice(full.risk.entry)}</dd>
                  <dt>Stop loss</dt><dd>{fmtPrice(full.risk.stopLoss)}</dd>
                  <dt>TP1</dt><dd>{fmtPrice(full.risk.takeProfit1)}</dd>
                  {full.risk.takeProfit2 && <><dt>TP2</dt><dd>{fmtPrice(full.risk.takeProfit2)}</dd></>}
                  <dt>R:R</dt><dd>{full.risk.riskReward.toFixed(2)}</dd>
                  <dt>Position</dt><dd>{full.risk.positionSize.toFixed(5)} units · ${full.risk.notional.toFixed(0)} notional</dd>
                  <dt>Invalidation</dt><dd>{analysis.signal.invalidation ?? '—'}</dd>
                </dl>
              ) : (
                <div>
                  <strong>NO VALID TRADE PLAN</strong>
                  <div className="muted">Reason: {full ? 'waiting for confirmation — deterministic rules not satisfied.' : 'run AI analysis first (deterministic signal is WAIT or risk uncomputable).'}</div>
                </div>
              )}
              {full?.risk?.warnings.map((w, i) => <div key={i} className="muted">⚠ {w}</div>)}
              <div className="row" style={{ marginTop: 8 }}>
                <label className="muted">Risk % <input type="number" value={riskPercent} min={0.1} max={5} step={0.1} onChange={(e) => setRisk({ riskPercent: Number(e.target.value) })} style={{ width: 70 }} /></label>
                <label className="muted">Leverage <input type="number" value={leverage} min={1} max={20} step={1} onChange={(e) => setRisk({ leverage: Number(e.target.value) })} style={{ width: 70 }} /></label>
                <label className="muted">Balance $ <input type="number" value={accountBalance} min={100} step={100} onChange={(e) => setRisk({ accountBalance: Number(e.target.value) })} style={{ width: 110 }} /></label>
              </div>
            </Card>
            <Card title="Multi-timeframe (1D macro → 4H → 1H → 15M → 5M → 1M)">
              <div className="table-wrap"><table>
                <thead><tr><th>TF</th><th>Role</th><th>Bias</th><th>EMA</th><th>RSI</th><th>BOS/CHoCH</th><th>SMC</th></tr></thead>
                <tbody>
                  {analysis.timeframes.map((t) => (
                    <tr key={t.timeframe}>
                      <td><strong>{t.timeframe}</strong></td>
                      <td className="muted">{t.role}</td>
                      <td><Badge value={t.bias} /></td>
                      <td>{t.indicators.emaTrend}</td>
                      <td>{t.indicators.rsi != null ? t.indicators.rsi.toFixed(0) : '—'}</td>
                      <td>{t.structure.bos ? `BOS ${t.structure.bos}` : t.structure.choch ? `CHoCH ${t.structure.choch}` : '—'}</td>
                      <td>{t.smc.swept ? `sweep ${t.smc.liquiditySweep}` : `${t.smc.points} pts`}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Card>
          </div>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <Card title="SMC / ICT (execution TF)">
              {exec ? (
                <div>
                  <div className="muted">Dealing range {exec.smc.equilibrium != null ? `EQ ${fmtPrice(exec.smc.equilibrium)}` : ''} · {exec.smc.premium ? 'PREMIUM' : exec.smc.discount ? 'DISCOUNT' : 'mid-range'} · displacement {exec.smc.displacement ?? 'none'}</div>
                  <ul className="tight">{exec.smc.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  <div className="muted">ICT: {exec.ict.reliable ? exec.ict.notes.join(' · ') : 'ICT unconfirmed — insufficient data (never faked).'} {exec.ict.judasSwing ? `· Judas ${exec.ict.judasSwing}` : ''}</div>
                </div>
              ) : <div className="muted">No execution timeframe data.</div>}
            </Card>
            <Card title="Hyperliquid derivatives">
              <dl className="kv">
                <dt>Open interest</dt><dd>{analysis.derivatives.openInterest != null ? analysis.derivatives.openInterest.toLocaleString() : 'Data unavailable'}</dd>
                <dt>Funding</dt><dd>{analysis.derivatives.fundingRate != null ? `${(analysis.derivatives.fundingRate * 100).toFixed(4)}%` : 'Data unavailable'}</dd>
                <dt>Mark / Oracle</dt><dd>{fmtPrice(analysis.derivatives.markPrice)} / {fmtPrice(analysis.derivatives.oraclePrice)}</dd>
                <dt>Premium/Basis</dt><dd>{analysis.derivatives.premium != null ? `${(analysis.derivatives.premium * 100).toFixed(3)}%` : '—'} / {analysis.derivatives.basis != null ? `${analysis.derivatives.basis.toFixed(3)}%` : '—'}</dd>
              </dl>
              <ul className="tight">{analysis.derivatives.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              <div className="muted">{analysis.hyperliquid.interpretation}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
