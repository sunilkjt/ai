import { TIMEFRAMES } from '../config/app';
import { useStore } from '../store/useStore';
import { Card } from '../components/ui';
import { clearAnalysisCache } from '../agents/orchestrator';

export default function Settings(): JSX.Element {
  const executionTimeframe = useStore((s) => s.executionTimeframe);
  const setExecutionTimeframe = useStore((s) => s.setExecutionTimeframe);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const riskPercent = useStore((s) => s.riskPercent);
  const leverage = useStore((s) => s.leverage);
  const accountBalance = useStore((s) => s.accountBalance);
  const setRisk = useStore((s) => s.setRisk);
  const category = useStore((s) => s.category);
  const setCategory = useStore((s) => s.setCategory);

  const aiKeyConfigured =
    (typeof window !== 'undefined' && Boolean(window.__SUNIL_AI__?.apiKey)) ||
    Boolean(import.meta.env.VITE_AI_API_KEY);

  return (
    <div>
      <div className="topbar">
        <div><h1>Settings</h1><p>Defaults, risk, AI usage. No auto-trading in v1 — this terminal never places orders.</p></div>
      </div>
      <div className="grid grid-2">
        <Card title="Defaults">
          <dl className="kv">
            <dt>Default category</dt>
            <dd>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                {(['ALL', 'STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO'] as const).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </dd>
            <dt>Execution TF</dt>
            <dd>
              <select value={executionTimeframe} onChange={(e) => setExecutionTimeframe(e.target.value)}>
                {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.label}</option>)}
              </select>
            </dd>
          </dl>
          <div className="muted">Suggested: 1D macro · 4H structure · 1H setup · 15M confirmation · 5M entry. Remap freely — the engine follows your mapping.</div>
        </Card>
        <Card title="Risk">
          <dl className="kv">
            <dt>Risk %</dt><dd><input type="number" value={riskPercent} min={0.1} max={5} step={0.1} onChange={(e) => setRisk({ riskPercent: Number(e.target.value) })} style={{ width: 90 }} /></dd>
            <dt>Leverage</dt><dd><input type="number" value={leverage} min={1} max={50} step={1} onChange={(e) => setRisk({ leverage: Number(e.target.value) })} style={{ width: 90 }} /></dd>
            <dt>Balance $</dt><dd><input type="number" value={accountBalance} min={100} step={100} onChange={(e) => setRisk({ accountBalance: Number(e.target.value) })} style={{ width: 130 }} /></dd>
          </dl>
          <div className="muted">Risk math is deterministic. The AI reviews the numbers — it never invents them.</div>
        </Card>
        <Card title="AI usage & cost control">
          <div className="row">
            <label><input type="checkbox" checked={aiEnabled} onChange={(e) => setRisk({ aiEnabled: e.target.checked })} /> AI enabled</label>
          </div>
          <ul className="tight">
            <li>AI key: {aiKeyConfigured ? 'configured (live reasoning)' : 'not configured (local fallback analyst)'}</li>
            <li>AI is called only on: user request · new signal · structure change · volatility event · refresh interval.</li>
            <li>Results cached 5 minutes per structure hash.</li>
          </ul>
          <button className="btn secondary" onClick={() => clearAnalysisCache()}>Clear AI cache</button>
        </Card>
        <Card title="Security">
          <ul className="tight">
            <li>No API keys in the frontend bundle — see .env.example.</li>
            <li>Hyperliquid market data is public (no key). AI keys stay in local .env or a backend proxy.</li>
            <li>v1 never places orders, changes leverage, or moves funds.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
