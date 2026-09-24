import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Card, Badge } from '../components/ui';
import { timeAgo } from '../utils/format';
import type { AgentName } from '../types';

const AGENTS: { name: AgentName; label: string }[] = [
  { name: 'discovery', label: 'Market Discovery' },
  { name: 'market-data', label: 'Market Data' },
  { name: 'mtf', label: 'Multi-Timeframe' },
  { name: 'technical', label: 'Technical' },
  { name: 'structure', label: 'Structure' },
  { name: 'smc', label: 'SMC' },
  { name: 'ict', label: 'ICT' },
  { name: 'liquidity', label: 'Liquidity' },
  { name: 'derivatives', label: 'Derivatives' },
  { name: 'regime', label: 'Market Regime' },
  { name: 'asset-class', label: 'Asset Class' },
  { name: 'confluence', label: 'Confluence' },
  { name: 'long', label: 'Long Agent' },
  { name: 'short', label: 'Short Agent' },
  { name: 'contrarian', label: 'Contrarian' },
  { name: 'trap', label: 'Trap Detector' },
  { name: 'critic', label: 'Critic' },
  { name: 'analyst', label: 'AI Analyst' },
  { name: 'risk', label: 'Risk Agent' },
  { name: 'final', label: 'Final Signal' },
];

export default function AgentMonitor(): JSX.Element {
  const lastAgentLedger = useStore((s) => s.lastAgentLedger);
  const lastToolLog = useStore((s) => s.lastToolLog);
  const screenStats = useStore((s) => s.screenStats);
  const scanning = useStore((s) => s.scanning);
  const lastScanAt = useStore((s) => s.lastScanAt);
  const screenResults = useStore((s) => s.screenResults);
  const [logOpen, setLogOpen] = useState(false);
  const [logAgent, setLogAgent] = useState<string>('ALL');

  const topSpecialists = screenResults[0]?.specialists ?? [];
  const logAgents = useMemo(() => ['ALL', ...[...new Set(lastToolLog.map((e) => e.agent))]], [lastToolLog]);
  const logRows = useMemo(
    () => lastToolLog.filter((e) => logAgent === 'ALL' || e.agent === logAgent).slice(-200).reverse(),
    [lastToolLog, logAgent],
  );
  const perAgentTools = useMemo(() => {
    const m = new Map<string, { requested: number; completed: number; failed: number; cached: number; timeouts: number }>();
    for (const e of lastToolLog) {
      const cur = m.get(e.agent) ?? { requested: 0, completed: 0, failed: 0, cached: 0, timeouts: 0 };
      cur.requested += 1;
      if (e.ok) cur.completed += 1;
      else cur.failed += 1;
      if (e.cached) cur.cached += 1;
      if (!e.ok && (e.error ?? '').includes('timeout')) cur.timeouts += 1;
      m.set(e.agent, cur);
    }
    return [...m.entries()];
  }, [lastToolLog]);

  const byAgent = useMemo(() => {
    const m = new Map<AgentName, { ok: number; skipped: number; failed: number; last: string }>();
    for (const e of lastAgentLedger) {
      const cur = m.get(e.agent) ?? { ok: 0, skipped: 0, failed: 0, last: '' };
      cur[e.status] += 1;
      cur.last = e.summary;
      m.set(e.agent, cur);
    }
    return m;
  }, [lastAgentLedger]);

  const aiCalls = lastAgentLedger.filter((e) => e.agent === 'analyst' || e.agent === 'critic').length;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>AI Agent Monitor</h1>
          <p>Transparent view of what the agent system did in the last scan. <Link to="/screener">Open Market Screener →</Link></p>
        </div>
      </div>

      <div className="grid grid-4">
        <Card title="Markets scanned"><div className="big">{screenStats?.scanned ?? '—'}</div><div className="muted">{lastScanAt ? `last scan ${timeAgo(lastScanAt)}` : 'no scan yet'}</div></Card>
        <Card title="Fast candidates"><div className="big">{screenStats?.fastCandidates ?? '—'}</div><div className="muted">deterministic stage</div></Card>
        <Card title="AI analyses"><div className="big">{screenStats?.aiReviewed ?? '—'}</div><div className="muted">{aiCalls} agent calls in ledger</div></Card>
        <Card title="Generated / rejected">
          <div className="big">{(screenStats?.longCount ?? 0) + (screenStats?.shortCount ?? 0)}<span className="muted"> / {screenStats?.rejected ?? '—'}</span></div>
          <div className="muted">{scanning ? 'scan in progress…' : `scan took ${screenStats ? (screenStats.durationMs / 1000).toFixed(1) : '—'}s`}</div>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Agent checklist (last scan)">
          {lastAgentLedger.length === 0 && <div className="muted">No scan yet — run Scan Now on the Market Screener.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Status</th><th>Runs ok</th><th>Skipped</th><th>Failed</th><th>Last summary</th></tr></thead>
              <tbody>
                {AGENTS.map((a) => {
                  const s = byAgent.get(a.name);
                  const state = !s ? '—' : s.failed > 0 ? 'failed' : s.ok > 0 ? 'ok' : 'skipped';
                  return (
                    <tr key={a.name}>
                      <td><strong>{a.label}</strong></td>
                      <td>{state === '—' ? <span className="muted">—</span> : state === 'ok' ? <span className="badge">✓ {state}</span> : <span className="badge wait">{state}</span>}</td>
                      <td>{s?.ok ?? 0}</td>
                      <td>{s?.skipped ?? 0}</td>
                      <td>{s?.failed ?? 0}</td>
                      <td className="muted">{s?.last ?? 'not run'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card
          title={`Agent execution detail — top candidate ${screenResults[0] ? `${screenResults[0].displaySymbol} (${screenResults[0].marketId})` : '(no scan yet)'}`}
        >
          {topSpecialists.length === 0 && <div className="muted">Run Scan Now on the Market Screener — only actions that actually happened are shown.</div>}
          {topSpecialists.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th>Status</th><th>Exec ms</th><th>Result</th><th>Decision</th><th>Confidence</th><th>Contradictions</th><th>Tools used</th><th>Errors</th></tr></thead>
                <tbody>
                  {topSpecialists.map((sp) => (
                    <tr key={sp.agent}>
                      <td><strong>{sp.agent}</strong></td>
                      <td>{sp.ok ? <span className="badge">✓ COMPLETE</span> : <span className="badge wait">failed</span>}</td>
                      <td className="muted">{sp.ms}</td>
                      <td>{sp.summary}</td>
                      <td><Badge value={sp.decision} /></td>
                      <td>{sp.confidence}/100 <span className="muted">(evidence)</span></td>
                      <td className="muted">{sp.contradictions.join('; ') || '—'}</td>
                      <td className="muted">{sp.toolsUsed.join(', ') || '—'}</td>
                      <td className="muted">{sp.error ?? (sp.risks[0] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card
          title={`Tool-call log (${lastToolLog.length} traced calls)`}
          action={<button className="btn secondary" onClick={() => setLogOpen((o) => !o)}>{logOpen ? 'Collapse' : 'Expand'}</button>}
        >
          {logOpen && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="muted">Agent</span>
                <select value={logAgent} onChange={(e) => setLogAgent(e.target.value)}>
                  {logAgents.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              {logRows.length === 0 && <div className="muted">No traced tool calls yet.</div>}
              {logRows.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Agent</th><th>Tool</th><th>Input</th><th>Result</th><th>Origin</th><th>Cached</th><th>Duration ms</th><th>Timestamp</th></tr></thead>
                    <tbody>
                      {logRows.map((e, i) => (
                        <tr key={i}>
                          <td>{e.agent}</td>
                          <td><strong>{e.tool}</strong></td>
                          <td className="muted">{e.input}</td>
                          <td>{e.ok ? <span className="badge">✓ ok</span> : <span className="badge wait" title={e.error ?? ''}>failed</span>}</td>
                          <td><span className="badge">{e.origin === 'ai' ? 'AI REQUEST' : e.origin === 'deterministic' ? 'DETERMINISTIC' : 'SYSTEM'}</span></td>
                          <td>{e.cached ? <span className="badge">CACHED</span> : <span className="muted">live</span>}</td>
                          <td className="muted">{e.ms}</td>
                          <td className="muted">{new Date(e.at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {perAgentTools.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Agent</th><th>Requested</th><th>Completed</th><th>Failed</th><th>Cached</th><th>Timeouts</th></tr></thead>
                    <tbody>
                      {perAgentTools.map(([agent, s]) => (
                        <tr key={agent}>
                          <td><strong>{agent}</strong></td>
                          <td>{s.requested}</td>
                          <td className="positive">{s.completed}</td>
                          <td className={s.failed > 0 ? 'negative' : ''}>{s.failed}</td>
                          <td>{s.cached}</td>
                          <td>{s.timeouts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {!logOpen && <div className="muted">Every entry is a real traced invocation from the last scan — nothing is simulated.</div>}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Scan ledger (latest entries)">
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Agent</th><th>Status</th><th>Summary</th><th>ms</th></tr></thead>
              <tbody>
                {[...lastAgentLedger].slice(-60).reverse().map((e, i) => (
                  <tr key={i}><td>{e.agent}</td><td><Badge value={e.status.toUpperCase()} /></td><td>{e.summary}</td><td className="muted">{e.durationMs}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{screenResults.length} candidates retained from the last scan. Signals tracked: see Signals + History.</div>
        </Card>
      </div>
    </div>
  );
}
