import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOLS, createPipelineTools, executePipelineTool, runAgenticAnalyst, runAgenticCritic,
  validateAgentDecision, validateToolCall,
} from '../src/agents/agenticLoop';
import { createToolContext, executeTool } from '../src/agents/tools';
import { decideFinalSignal, detectContradictions, validateSignalNumbers } from '../src/agents/finalDecision';
import type { AIProvider, AgentStepDecision, DerivativesAnalysis } from '../types';

const EMPTY_DERIV: DerivativesAnalysis = {
  fundingRate: null, openInterest: null, longShortRatio: null, basis: null,
  markPrice: null, oraclePrice: null, premium: null, dayVolumeNotional: null,
  unavailable: [], bias: 'NEUTRAL', notes: [],
};

const toolInput = {
  market: null, marketId: 'main:T', symbol: 'T', timeframes: [],
  confluence: { total: 50, band: 'DEVELOPING', direction: 'NEUTRAL', items: [], supportingReasons: [], opposingReasons: [] },
  signal: {
    id: 's', symbol: 'T', direction: 'WAIT', timeframe: '15m', confluenceScore: 50,
    supportingReasons: [], opposingReasons: [], marketRegime: 'RANGE', status: 'NEW',
    history: [], timestamp: 1, expiresAt: 999,
  },
  derivatives: EMPTY_DERIV, memory: [],
} as never;

function mockProvider(queue: AgentStepDecision[], name = 'mock-llm'): AIProvider {
  return {
    name,
    analyze: async () => { throw new Error('use agentic path'); },
    critique: async () => { throw new Error('use agentic path'); },
    decide: async () => {
      const next = queue.shift();
      if (!next) return { type: 'stop', reason: 'queue exhausted' };
      return next;
    },
  };
}

describe('agentic tool protocol', () => {
  const registry = createPipelineTools(toolInput);

  it('1. rejects unknown tool requests', () => {
    const v = validateToolCall(registry, AGENT_TOOLS.AIAnalyst, 'placeOrder', {});
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/unknown tool/);
  });

  it('2. rejects invalid tool arguments (timeframe, limit, marketId, permissions)', () => {
    expect(validateToolCall(registry, AGENT_TOOLS.AIAnalyst, 'getSMC', { timeframe: '9h' }).ok).toBe(false);
    expect(validateToolCall(registry, AGENT_TOOLS.AIAnalyst, 'getMarket', { id: '' }).ok).toBe(false);
    expect(validateToolCall(registry, AGENT_TOOLS.TrapDetectionAgent, 'calculateRisk', {}).ok).toBe(false);
    const clamped = validateToolCall(registry, AGENT_TOOLS.AIAnalyst, 'getMarket', { id: 'main:T', limit: 99999 });
    expect(clamped.ok).toBe(true);
    expect(clamped.args?.limit).toBe(500);
  });

  it('3. tool timeout surfaces as failure, never hangs', async () => {
    const hanging = [{ name: 'hang', description: 'x', run: async () => { await new Promise((r) => setTimeout(r, 2000)); return 1; } }];
    const ctx = createToolContext({ timeoutMs: 10 });
    await expect(executeTool(hanging, ctx, 'hang', {})).rejects.toThrow(/timeout/);
    expect(ctx.calls[0].ok).toBe(false);
  });

  it('4. tool failure stops honestly with error (no fabrication)', async () => {
    const failing = [{ name: 'boom', description: 'x', run: async () => { throw new Error('downstream 500'); } }];
    const ctx = createToolContext({});
    await expect(executeTool(failing, ctx, 'boom', {})).rejects.toThrow(/downstream/);
  });

  it('5. maximum tool calls enforced', async () => {
    const ok = [{ name: 'ok', description: 'x', run: async () => 1 }];
    const ctx = createToolContext({ maxCalls: 2 });
    await executeTool(ok, ctx, 'ok', { a: 1 });
    await executeTool(ok, ctx, 'ok', { a: 2 });
    await expect(executeTool(ok, ctx, 'ok', { a: 3 })).rejects.toThrow(/max tool calls/);
  });

  it('6. maximum iterations enforced', async () => {
    const alwaysTool = mockProvider(Array.from({ length: 20 }, () => ({ type: 'tool_call', tool: 'getMarket', arguments: {} }) as AgentStepDecision));
    const res = await runAgenticAnalyst({
      provider: alwaysTool, toolInput, brief: () => 'brief',
      budget: { maxIterations: 2, maxToolCalls: 10 },
    });
    expect(res.analysis).toBeNull();
    expect(res.stopReason).toMatch(/max iterations/);
  });

  it('7. AI can request multiple tools then conclude', async () => {
    const provider = mockProvider([
      { type: 'tool_call', tool: 'getDerivatives', arguments: {} },
      { type: 'tool_call', tool: 'getConfluence', arguments: {} },
      {
        type: 'final', result: {
          symbol: 'T', decision: 'WAIT', direction: 'WAIT', marketRegime: 'RANGE',
          confidence: 40, supportingFactors: [], opposingFactors: ['weak'],
          invalidation: 'n/a', explanation: 'insufficient edge',
        },
      },
    ]);
    const seen: string[] = [];
    const res = await runAgenticAnalyst({
      provider, toolInput, brief: () => 'brief',
      budget: { maxIterations: 6, maxToolCalls: 5 },
      onTrace: (e) => { seen.push(e.tool); },
    });
    expect(res.analysis?.decision).toBe('WAIT');
    expect(seen).toEqual(['getDerivatives', 'getConfluence']);
  });

  it('8. agent stops immediately when evidence is sufficient', async () => {
    const provider = mockProvider([{ type: 'stop', reason: 'evidence suffices' }]);
    const res = await runAgenticAnalyst({ provider, toolInput, brief: () => 'brief' });
    expect(res.analysis).toBeNull();
    expect(res.stopReason).toMatch(/evidence suffices/);
  });

  it('invalid final payloads are rejected, not accepted', async () => {
    const provider = mockProvider([{ type: 'final', result: { nonsense: true } }]);
    const res = await runAgenticAnalyst({ provider, toolInput, brief: () => 'brief' });
    expect(res.analysis).toBeNull();
    expect(res.stopReason).toMatch(/validation/);
  });

  it('agentic critic returns APPROVE/CONDITIONAL/REJECT verdicts', async () => {
    const provider = mockProvider([{
      type: 'final', result: { verdict: 'WAIT', approval: 'REJECT', risks: ['crowded'], critique: 'too crowded' },
    }]);
    const res = await runAgenticCritic({ provider, toolInput, thesis: () => 'thesis LONG' });
    expect(res.critique?.approval).toBe('REJECT');
  });

  it('agent permissions differ per agent (least privilege)', () => {
    expect(AGENT_TOOLS.TrapDetectionAgent).not.toContain('calculateRisk');
    expect(AGENT_TOOLS.RiskAgent).toEqual(expect.arrayContaining(['calculateRisk']));
    expect(AGENT_TOOLS.FinalDecisionAgent).not.toContain('getCandles');
    expect(AGENT_TOOLS.AIAnalyst.length).toBeGreaterThan(AGENT_TOOLS.RiskAgent.length);
  });
});

describe('contradiction handling', () => {
  it('9. detects genuine agent disagreement', () => {
    const c = detectContradictions({
      longCandidate: true, shortCandidate: true, structureTrend: 'NEUTRAL',
      fundingRate: null, trapRisk: 'LOW', direction: 'LONG',
    });
    expect(c.join(' ')).toMatch(/both claim/);
    expect(detectContradictions({
      longCandidate: true, shortCandidate: false, structureTrend: 'BULLISH',
      fundingRate: -0.002, trapRisk: 'LOW', direction: 'LONG',
    }).join(' ')).toMatch(/derivatives/);
    expect(detectContradictions({
      longCandidate: false, shortCandidate: false, structureTrend: 'NEUTRAL',
      fundingRate: null, trapRisk: 'LOW', direction: 'WAIT',
    })).toEqual([]);
  });

  it('10. contradiction → critic review → WAIT with explanation', () => {
    const base = {
      symbol: 'T', category: 'CRYPTO' as const, regime: 'RANGE' as const, timeframes: [],
      confluence: { total: 70, band: 'MODERATE', direction: 'BULLISH', items: [], supportingReasons: ['s'], opposingReasons: [] },
      signal: {
        id: 's', symbol: 'T', direction: 'LONG', timeframe: '15m', entry: 100, stopLoss: 99,
        takeProfit1: 101.5, riskReward: 1.5, confluenceScore: 70, supportingReasons: ['s'],
        opposingReasons: [], marketRegime: 'RANGE', status: 'NEW', history: [], timestamp: 1, expiresAt: 999,
      },
      derivatives: EMPTY_DERIV, hyperliquid: null,
      longCandidate: true, longDetail: 'ok', shortCandidate: true, shortDetail: 'ok',
      contrarian: [], trapRisk: 'LOW' as const, trapFlags: [],
      ai: null, critique: null,
      risk: { entry: 100, stopLoss: 99, takeProfit1: 101.5, riskDistance: 1, rewardDistance: 1.5, riskReward: 1.5, riskPercent: 1, positionSize: 100, notional: 10000, leverage: 1, warnings: [], valid: true },
      demo: false, stale: false, gateStatus: 'CONDITIONAL' as const, gateReasons: [] as string[],
      contradictions: ['LONG and SHORT specialists both claim candidacy — setups overlap'],
    };
    const out = decideFinalSignal(base as never);
    expect(out.decision).toBe('WAIT');
    expect(out.notes.join(' ')).toMatch(/materially contradictory/);
  });
});

describe('signal number validation', () => {
  it('11. LONG ordering enforced', () => {
    expect(validateSignalNumbers('LONG', 100, 99, 102, 104, 2).ok).toBe(true);
    expect(validateSignalNumbers('LONG', 100, 100.5, 102, null, 2).ok).toBe(false);
  });
  it('12. SHORT ordering enforced', () => {
    expect(validateSignalNumbers('SHORT', 100, 101, 98, 96, 2).ok).toBe(true);
    expect(validateSignalNumbers('SHORT', 100, 99, 98, null, 2).ok).toBe(false);
  });
  it('13. R:R recomputed mathematically', () => {
    const v = validateSignalNumbers('LONG', 100, 98, 104, null, null);
    expect(v.ok).toBe(true);
    expect(v.recomputedRR).toBeCloseTo(2, 9);
  });
  it('14. WAIT is first-class with no numbers required', () => {
    const out = decideFinalSignal({
      symbol: 'T', category: 'CRYPTO' as const, regime: 'RANGE' as const, timeframes: [],
      confluence: { total: 30, band: 'WEAK', direction: 'NEUTRAL', items: [], supportingReasons: [], opposingReasons: ['weak'] },
      signal: {
        id: 's', symbol: 'T', direction: 'WAIT', timeframe: '15m', confluenceScore: 30,
        supportingReasons: [], opposingReasons: ['weak'], marketRegime: 'RANGE', status: 'NEW',
        history: [], timestamp: 1, expiresAt: 999,
      },
      derivatives: EMPTY_DERIV, hyperliquid: null,
      longCandidate: false, longDetail: 'no LONG', shortCandidate: false, shortDetail: 'no SHORT',
      contrarian: [], trapRisk: 'LOW' as const, trapFlags: [],
      ai: null, critique: null, risk: null, demo: false, stale: false,
      gateStatus: 'WATCHING' as const, gateReasons: [] as string[],
    } as never);
    expect(out.decision).toBe('WAIT');
    expect(out.entry).toBeNull();
    expect(out.validation).toBeNull();
  });
});
