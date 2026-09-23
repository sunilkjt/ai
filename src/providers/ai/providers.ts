// AI provider abstraction: OpenAI-compatible adapter + deterministic local fallback.
// Keys are NEVER bundled: the adapter reads runtime config passed from a server/proxy
// or local .env at dev time. Frontend never commits secrets.
import type { AIAnalysis, AICritique, AICritiqueContext, AIContext, AIProvider, AssetCategory, Direction, FinalDecision, MarketRegime } from '../../types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const CATEGORIES: AssetCategory[] = ['STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO', 'OTHER', 'UNKNOWN'];

export function validateAIAnalysis(raw: unknown): AIAnalysis | null {
  if (typeof raw !== 'object' || raw == null) return null;
  const r = raw as Record<string, unknown>;
  const regimes: MarketRegime[] = ['TRENDING_BULLISH','TRENDING_BEARISH','RANGE','BREAKOUT','BREAKDOWN','BULLISH_PULLBACK','BEARISH_PULLBACK','HIGH_VOLATILITY','LOW_VOLATILITY','UNCLEAR'];
  const decisions: FinalDecision[] = ['LONG','SHORT','WAIT','NO_TRADE'];
  const dirs: Direction[] = ['LONG','SHORT','WAIT'];
  if (typeof r.symbol !== 'string') return null;
  if (!decisions.includes(r.decision as FinalDecision)) return null;
  if (!dirs.includes(r.direction as Direction)) return null;
  if (!regimes.includes(r.marketRegime as MarketRegime)) return null;
  const confidence = Number(r.confidence);
  if (!Number.isFinite(confidence)) return null;
  if (!Array.isArray(r.supportingFactors) || !Array.isArray(r.opposingFactors)) return null;
  if (typeof r.explanation !== 'string' || typeof r.invalidation !== 'string') return null;
  const category = typeof r.category === 'string' && (CATEGORIES as string[]).includes(r.category) ? (r.category as AssetCategory) : undefined;
  return {
    symbol: r.symbol,
    category,
    decision: r.decision as FinalDecision,
    direction: r.direction as Direction,
    marketRegime: r.marketRegime as MarketRegime,
    confidence: clamp(Math.round(confidence), 0, 100),
    supportingFactors: (r.supportingFactors as unknown[]).map(String).slice(0, 8),
    opposingFactors: (r.opposingFactors as unknown[]).map(String).slice(0, 8),
    invalidation: String(r.invalidation),
    explanation: String(r.explanation),
    provider: typeof r.provider === 'string' ? r.provider : 'unknown',
    cached: false,
    timestamp: Date.now(),
  };
}

// Best-effort repair: extract first {...} JSON block from a chatty response.
export function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export interface OpenAICompatConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible';
  constructor(private cfg: OpenAICompatConfig, private prompts: { analyst: string; critic: string }) {}

  private async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }

  async analyze(context: AIContext): Promise<AIAnalysis> {
    const { buildAnalystUserMessage } = await import('../../agents/aiContext');
    const text = await this.complete(this.prompts.analyst, buildAnalystUserMessage(context));
    const parsed = validateAIAnalysis(tryParse(text));
    if (!parsed) throw new Error('Invalid AI analysis JSON');
    return { ...parsed, provider: this.name, category: parsed.category ?? context.category };
  }

  async critique(context: AICritiqueContext): Promise<AICritique> {
    const { buildCriticUserMessage } = await import('../../agents/aiContext');
    const text = await this.complete(this.prompts.critic, buildCriticUserMessage(context));
    const json = tryParse(text) as { verdict?: Direction; risks?: unknown; critique?: unknown } | null;
    const verdict: Direction = json && (json.verdict === 'LONG' || json.verdict === 'SHORT' || json.verdict === 'WAIT') ? json.verdict : 'WAIT';
    return {
      symbol: context.symbol,
      verdict,
      risks: Array.isArray(json?.risks) ? (json.risks as unknown[]).map(String).slice(0, 8) : [],
      critique: typeof json?.critique === 'string' ? (json.critique as string) : text.slice(0, 1000),
      downgraded: verdict === 'WAIT' && context.signal.direction !== 'WAIT',
      timestamp: Date.now(),
    };
  }

  async chat(system: string, user: string): Promise<string> {
    return this.complete(system, user);
  }
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return extractJson(text);
  }
}

// Deterministic local fallback analyst — used when no key is configured or the API fails.
// Clearly labeled provider:'local-fallback'. Never fabricates prices: only echoes engine facts.
export class LocalFallbackProvider implements AIProvider {
  readonly name = 'local-fallback';
  async analyze(context: AIContext): Promise<AIAnalysis> {
    const c = context.confluence;
    const direction = context.signal.direction;
    const decision = direction === 'WAIT' ? 'WAIT' : c.total >= 75 ? direction : 'WAIT';
    const supporting = [...context.signal.supportingReasons, ...(context.assetInsights ?? [])].slice(0, 5);
    const opposing = context.signal.opposingReasons.slice(0, 5);
    const execBias = context.timeframes[context.timeframes.length - 1]?.bias ?? 'NEUTRAL';
    const hlNote = context.hyperliquid ? ` ${context.hyperliquid.interpretation}` : '';
    return {
      symbol: context.symbol,
      category: context.category,
      decision,
      direction,
      marketRegime: context.regime,
      confidence: Math.round(Math.min(88, 40 + c.total * 0.5)),
      supportingFactors: supporting.length ? supporting : ['Deterministic confluence below threshold — no edge'],
      opposingFactors: opposing.length ? opposing : ['No major opposing factors detected'],
      invalidation: context.signal.invalidation ?? 'Structure break against the setup',
      explanation:
        decision === 'WAIT'
          ? `[${context.category}] Engine confluence is ${c.total}/100 with ${execBias} execution bias.${hlNote} Local fallback keeps this at WAIT until stronger confirmation (no live LLM configured).`
          : `[${context.category}] Engine confluence is ${c.total}/100 (${c.band}) with ${execBias} execution bias.${hlNote} Local fallback agrees with the deterministic ${direction}. Configure an AI key for deeper reasoning.`,
      provider: this.name,
      cached: false,
      timestamp: Date.now(),
    };
  }

  async critique(context: AICritiqueContext): Promise<AICritique> {
    const risks = [...context.signal.opposingReasons];
    if (context.hyperliquid?.crowdingRisk) risks.unshift('Hyperliquid OI rising with elevated funding — crowding risk');
    if (context.derivatives.fundingRate != null && Math.abs(context.derivatives.fundingRate) > 0.0005) {
      risks.unshift(`Funding ${context.derivatives.fundingRate > 0 ? 'elevated positive' : 'negative'} — do not chase`);
    }
    const trimmed = risks.slice(0, 5);
    const shouldWait = context.signal.direction !== 'WAIT' && (context.confluence.total < 75 || trimmed.length >= 2);
    return {
      symbol: context.symbol,
      verdict: shouldWait ? 'WAIT' : context.signal.direction,
      risks: trimmed.length ? trimmed : ['No critical flaws found by fallback checks'],
      critique: shouldWait
        ? 'Fallback critic: confluence is not strong enough or multiple opposing factors exist. Wait for confirmation rather than forcing the trade.'
        : 'Fallback critic: no blocking flaws found in the deterministic setup. Standard risk management still applies.',
      downgraded: shouldWait && context.signal.direction !== 'WAIT',
      timestamp: Date.now(),
    };
  }
}
