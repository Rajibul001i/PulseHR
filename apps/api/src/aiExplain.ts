/**
 * F9 — AI risk-explanation assistant.
 *
 * Explain-only, by explicit product decision: the attrition module already carries hard
 * safety constraints (HR_ADMIN-only, advisory-only framing, manager exclusion for
 * retaliation prevention — see server.ts's attrition routes and docs/13-sqa-defect-report.md
 * §6). An "AI agent" that could take action (send messages, change records, recommend HR
 * decisions) would conflict with every one of those. This assistant does exactly one thing:
 * answer questions about a specific score using the same contribution data the scorecard
 * page already renders. It never sees other employees' data, never acts, and is grounded
 * only in what scoreEmployee() itself computed — it cannot invent a signal.
 */

import Anthropic from '@anthropic-ai/sdk';
import { FEATURES, type FeatureKey } from '@pulsehr/core';
import type { Row } from './db.js';

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      'AI explanations are not configured on this server. Set the ANTHROPIC_API_KEY ' +
        'environment variable to enable this feature.',
    );
    this.name = 'AiNotConfiguredError';
  }
}

const RATIONALE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f.rationale]));

export interface ExplainContext {
  score: Row;
  contributions: Row[];
  employee: Row;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the risk-explanation assistant inside PulseHR, a Bangladesh-focused HR platform. \
An HR administrator is looking at one employee's attrition risk score and asking you to help them understand it.

Ground rules, all non-negotiable:
1. You are advisory only, for retention outreach. Using this score in a termination, promotion, appraisal, or pay \
decision is a prohibited use of this system. If asked to help with any of those, decline and say so plainly, then \
offer to help think through a supportive retention conversation instead.
2. Answer ONLY from the score, band, and contributing-factor data given to you below. Do not use outside knowledge \
about this employee, this company, or people in general. If a question asks about something not covered by that \
data (e.g. "what's really going on with them personally"), say the data does not speak to that.
3. Never speculate about protected characteristics — gender, religion, age, disability, pregnancy, marital status, \
etc. You have not been given any of that, and it should play no role in your answer even if the admin raises it.
4. Performance-review scores are deliberately excluded from this model. If asked why, explain: reviews are the \
artifact most exposed to bias, and feeding them into a risk score would launder that bias into an output that \
looks objective.
5. This scorecard is an expert-weighted model, not a trained one (there is no historical resignation data yet to \
fit a model against) — say so if asked how it was built.
6. You cannot take any action — you cannot send messages, change records, schedule anything, or make decisions. \
You only explain.
7. Keep answers concise and in plain English — a few sentences unless the admin asks for more detail. Reference \
specific factors by name when relevant.`;

function tenureLabel(hireDateIso: string): string {
  const hire = new Date(hireDateIso);
  const now = new Date();
  const months = Math.max(
    0,
    (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth()),
  );
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} month${rem === 1 ? '' : 's'}`;
  if (rem === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'}, ${rem} month${rem === 1 ? '' : 's'}`;
}

function groundingBlock(ctx: ExplainContext): string {
  const lines = ctx.contributions.map((c) => {
    const key = String(c.feature_key) as FeatureKey;
    const rationale = RATIONALE_BY_KEY.get(key) ?? '';
    return (
      `- ${String(c.label)}: ${Number(c.points).toFixed(1)} of ${Number(c.weight)} max points ` +
      `(normalised ${Number(c.normalised).toFixed(2)}). ${rationale}`
    );
  });

  return `Employee: ${String(ctx.employee.full_name)}, ${String(ctx.employee.designation)}${
    ctx.employee.department_name ? `, ${String(ctx.employee.department_name)} department` : ''
  }. Tenure: ${tenureLabel(String(ctx.employee.hire_date))}.

Composite risk score: ${String(ctx.score.score)} / 100 (band: ${String(ctx.score.band)}).
Scored on ${String(ctx.score.scored_on)} · scoring engine ${String(ctx.score.engine_version)}.

Contributing factors, highest first:
${lines.join('\n')}`;
}

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client === undefined) {
    client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }
  return client;
}

/**
 * Stateless by design (ADR-003 territory: no server-side chat session store exists in this
 * app). The caller resends the whole turn history each time, exactly like the Messages API
 * itself — the grounding data is re-supplied via the system prompt on every call since it's
 * cheap to recompute and guarantees the model never answers from a stale score.
 */
export async function explainAttritionScore(ctx: ExplainContext, turns: ChatTurn[]): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) throw new AiNotConfiguredError();

  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'medium' },
    system: `${SYSTEM_PROMPT}\n\n---\n\n${groundingBlock(ctx)}`,
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
  });

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('AI assistant returned no text response.');
  }
  return text.text;
}
