import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from '../components/ui';
import { getAIProvider } from '../providers/ai/factory';
import { CHAT_SYSTEM_PROMPT } from '../agents/prompts';
import { fmtPrice } from '../utils/format';

interface Msg { role: 'user' | 'ai'; text: string; }

export default function Chat(): JSX.Element {
  const analyses = useStore((s) => s.analyses);
  const selectedSymbol = useStore((s) => s.selectedSymbol);
  const selectSymbol = useStore((s) => s.selectSymbol);
  const [input, setInput] = useState('');
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const a = analyses[selectedSymbol];

  function structuredFacts(): string {
    if (!a) return 'No market data loaded yet.';
    return `Symbol ${a.symbol} price ${fmtPrice(a.price)} regime ${a.regime} signal ${a.signal.direction} confluence ${a.signal.confluenceScore}/100. ` +
      a.timeframes.map((t) => `${t.timeframe}: bias ${t.bias}, EMA ${t.indicators.emaTrend}, RSI ${t.indicators.rsi?.toFixed(1) ?? 'n/a'}, struct ${t.structure.trend}${t.structure.bos ? ' BOS-' + t.structure.bos : ''}${t.structure.choch ? ' CHoCH-' + t.structure.choch : ''}, sweep ${t.smc.liquiditySweep ?? 'none'}`).join(' | ') +
      ` Invalidation: ${a.signal.invalidation ?? 'n/a'}.`;
  }

  async function send(): Promise<void> {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setLog((l) => [...l, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const provider = getAIProvider();
      const facts = structuredFacts();
      let answer: string;
      if (provider.name === 'local-fallback') {
        answer = answerLocally(q, facts);
      } else if ('chatText' in provider && typeof (provider as { chatText: unknown }).chatText === 'function') {
        answer = await (provider as { chatText: (s: string, u: string) => Promise<string> }).chatText(
          CHAT_SYSTEM_PROMPT, `Market facts: ${facts}\n\nUser question: ${q}`,
        );
      } else {
        answer = answerLocally(q, facts);
      }
      setLog((l) => [...l, { role: 'ai', text: answer }]);
    } catch {
      setLog((l) => [...l, { role: 'ai', text: 'AI chat unavailable — deterministic analysis on the Analyst page is still available.' }]);
    } finally {
      setBusy(false);
    }
  }

  function answerLocally(q: string, facts: string): string {
    const s = q.toLowerCase();
    if (s.includes('why') && (s.includes('wait') || a?.signal.direction === 'WAIT')) {
      return `The engine is at WAIT because confluence is ${a?.signal.confluenceScore ?? '?'}/100 (needs ≥55 with cross-block agreement).\nOpposing: ${(a?.signal.opposingReasons ?? []).join('; ') || 'none listed'}.\n\nFacts: ${facts}`;
    }
    if (s.includes('invalidat')) {
      return `Invalidation for this setup: ${a?.signal.invalidation ?? 'no active setup — nothing to invalidate'}.\n\nFacts: ${facts}`;
    }
    if (s.includes('structure')) {
      return `Multi-timeframe structure:\n${(a?.timeframes ?? []).map((t) => `${t.timeframe}: ${t.structure.trend}${t.structure.bos ? ' BOS-' + t.structure.bos : ''}${t.structure.choch ? ' CHoCH-' + t.structure.choch : ''}`).join('\n')}\n\nAI analysis is informational and does not guarantee trading results.`;
    }
    return `Based on current structured data:\n${facts}\n\nAsk "why WAIT?", "what would invalidate this setup?", or "explain the current market structure". AI analysis is informational and does not guarantee trading results.`;
  }

  return (
    <div>
      <div className="topbar">
        <div><h1>AI Chat</h1><p>Answers only from the app's structured market data. Never fabricates live prices.</p></div>
        <select value={selectedSymbol} onChange={(e) => selectSymbol(e.target.value)}>
          {Object.keys(analyses).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Card title={`Context: ${selectedSymbol}`}>
        <div className="muted">{structuredFacts()}</div>
      </Card>
      <div style={{ marginTop: 12 }}>
        <Card title="Conversation">
          <div className="chat-box">
            <div className="chat-log">
              {log.length === 0 && <div className="muted">Try: "Why is {selectedSymbol} showing WAIT?" · "What would invalidate this setup?" · "Explain the current market structure."</div>}
              {log.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'user' : ''}`}>{m.text}</div>)}
              {busy && <div className="msg">Thinking…</div>}
            </div>
            <div className="row">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Ask about the current setup…" style={{ flex: 1 }} />
              <button className="btn" disabled={busy || !input.trim()} onClick={() => void send()}>Send</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
