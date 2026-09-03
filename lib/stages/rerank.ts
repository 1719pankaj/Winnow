import fs from 'fs';
import path from 'path';
import { Candidate } from '../types';
import { FullWinnowConfig } from '../config/models';
import { InferenceAdapter } from '../adapters/inference';

export interface RerankOptions {
  query: string;
  intent: string | null;
  candidates: Candidate[];
  config: FullWinnowConfig;
  tierName: 'rush' | 'fast' | 'right';
  inferenceAdapter: InferenceAdapter;
  searchId: string;
  freshness?: 'none' | 'week' | 'month' | 'year';
}

export interface RerankItem {
  id: string;
  score: number;
  verdict: 'keep' | 'drop';
  rationale: string;
}

export interface RerankOutput {
  candidates: Candidate[];
  keptCount: number;
  droppedCount: number;
  is_degraded?: boolean;
  system_prompt?: string;
  user_prompt?: string;
  raw_response?: string;
  parse_ladder_rung?: string;
}

function seededShuffle<T>(array: T[], seedStr: string): T[] {
  const clean = array.filter(Boolean);
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const rng = () => {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  };

  const copy = [...clean];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sanitizePageContent(text: string): string {
  return text
    .replace(/<<<BEGIN UNTRUSTED PAGE CONTENT/g, '')
    .replace(/END UNTRUSTED PAGE CONTENT>>>/g, '')
    .replace(/<\/candidate>/g, '');
}

function buildUserMessage(query: string, intent: string | null, candidates: Candidate[]): string {
  const blocks = candidates
    .filter((c) => c && c.id)
    .map((c) => {
      let contentBlock = '';
      if (c.content && c.content.text && c.content.fetch_status === 'ok') {
        const sanitized = sanitizePageContent(c.content.text);
        contentBlock = `CONTENT:
<<<BEGIN UNTRUSTED PAGE CONTENT
${sanitized}
END UNTRUSTED PAGE CONTENT>>>`;
      } else if (c.content && c.content.fetch_status !== 'ok') {
        contentBlock = `CONTENT_UNAVAILABLE: ${c.content.fetch_status}`;
      } else {
        contentBlock = 'CONTENT_UNAVAILABLE: snippets_only';
      }

      const origRank = c.sources && c.sources[0]?.rank ? c.sources[0].rank : 1;

      return `<candidate id="${c.id}" original_rank="${origRank}" domain="${c.domain}">
TITLE: ${c.title}
SNIPPET: ${c.snippet}
${contentBlock}
</candidate>`;
    });

  return `QUERY: ${query}
INTENT: ${intent || 'not specified'}

CANDIDATES (presentation order is randomised; original_rank is the search engine's position):

${blocks.join('\n\n')}`;
}

// 6-Rung Parse Robustness Ladder (Section 6.5.4)
function parseRerankLadder(rawText: string, candidates: Candidate[]): { items: RerankItem[]; isDegraded: boolean; rungUsed: string } {
  const jsonStr = rawText.trim();

  // Rung 1: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr);
    const rankings = parsed.rankings || (Array.isArray(parsed) ? parsed : null);
    if (rankings && Array.isArray(rankings)) {
      return { items: normalizeRankings(rankings, candidates), isDegraded: false, rungUsed: 'Rung 1: Direct JSON' };
    }
  } catch {}

  // Rung 2: Strip markdown fences
  try {
    const stripped = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(stripped);
    const rankings = parsed.rankings || (Array.isArray(parsed) ? parsed : null);
    if (rankings && Array.isArray(rankings)) {
      return { items: normalizeRankings(rankings, candidates), isDegraded: false, rungUsed: 'Rung 2: Stripped Markdown' };
    }
  } catch {}

  // Rung 3: Outermost JSON object extraction
  try {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const rankings = parsed.rankings || (Array.isArray(parsed) ? parsed : null);
      if (rankings && Array.isArray(rankings)) {
        return { items: normalizeRankings(rankings, candidates), isDegraded: false, rungUsed: 'Rung 3: Outermost JSON' };
      }
    }
  } catch {}

  // Rung 4: Regex scraping
  const regex = /"id"\s*:\s*"([^"]+)"[\s\S]*?"score"\s*:\s*(\d+)[\s\S]*?"verdict"\s*:\s*"(keep|drop)"[\s\S]*?"rationale"\s*:\s*"([^"]*)"/g;
  const scraped: RerankItem[] = [];
  let m;
  while ((m = regex.exec(jsonStr)) !== null) {
    scraped.push({
      id: m[1],
      score: parseInt(m[2], 10),
      verdict: m[3] as 'keep' | 'drop',
      rationale: m[4],
    });
  }
  if (scraped.length > 0) {
    return { items: normalizeRankings(scraped, candidates), isDegraded: false, rungUsed: 'Rung 4: Regex Scraping' };
  }

  // Rung 6: Degraded fallback ordering
  console.warn('[Rerank Stage] Parse ladder failed all rungs, using honest prefilter ordering.');
  return {
    items: candidates.map((c, idx) => ({
      id: c.id,
      score: Math.max(10, 100 - (idx + 1) * 4),
      verdict: 'keep',
      rationale: 'Rerank unparseable; retained from prefilter rank.',
    })),
    isDegraded: true,
    rungUsed: 'Rung 6: Fallback Ordering',
  };
}

function normalizeRankings(items: any[], candidates: Candidate[]): RerankItem[] {
  const map = new Map<string, RerankItem>();
  for (const item of items) {
    if (item && item.id) {
      map.set(item.id, {
        id: String(item.id),
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        verdict: item.verdict === 'drop' ? 'drop' : 'keep',
        rationale: String(item.rationale || 'Judged relevant.'),
      });
    }
  }

  return candidates.map((c) => {
    const found = map.get(c.id);
    if (found) return found;
    return {
      id: c.id,
      score: Math.round((c.prefilter_score || 0.5) * 60),
      verdict: 'keep',
      rationale: 'Omitted from output; retained with baseline score.',
    };
  });
}

export async function stageRerank(options: RerankOptions): Promise<RerankOutput> {
  const { query, intent, candidates, config, inferenceAdapter, searchId, freshness } = options;

  const activeCandidates = candidates.filter((c) => !c.dropped_at_stage);
  const droppedCandidates = candidates.filter((c) => c.dropped_at_stage);

  if (activeCandidates.length === 0) {
    return {
      candidates: [...droppedCandidates],
      keptCount: 0,
      droppedCount: droppedCandidates.length,
    };
  }

  // 1. Position Bias Mitigation: Shuffle Presentation Order
  const shuffled = seededShuffle(activeCandidates, searchId);

  // 2. Build Prompts
  const promptPath = path.join(process.cwd(), 'prompts', 'rerank.v3.txt');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf8')
    : `You are the Winnow reranker. Rank candidates by query and intent. Score 0-100. Output strict JSON: {"rankings": [{"id": "c01", "score": 85, "verdict": "keep", "rationale": "..."}]}`;

  const userMessage = buildUserMessage(query, intent, shuffled);

  // 3. Execute LLM Call
  let rawResponse = '';
  let isDegraded = false;

  try {
    rawResponse = await inferenceAdapter.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.1, maxTokens: 2500, responseFormatJson: true }
    );
  } catch (err: any) {
    console.warn(`[Rerank Stage] LLM call failed: ${err.message}. Entering degraded mode.`);
    isDegraded = true;
    rawResponse = `Error: ${err.message}`;
  }

  // 4. Parse Response via Robustness Ladder
  const { items: rerankItems, isDegraded: parseDegraded, rungUsed } = parseRerankLadder(rawResponse, activeCandidates);
  const finalDegraded = isDegraded || parseDegraded;

  const scoreMap = new Map(rerankItems.map((r) => [r.id, r]));

  // 5. Post-Processing (Section 6.5)
  const scoreThreshold = config.winnow.blocklist.score_threshold;
  const maxResults = config.winnow.blocklist.max_results;
  const maxPerDomain = config.winnow.blocklist.max_per_domain;

  const newlyKept: Candidate[] = [];
  const newlyDropped: Candidate[] = [];

  for (const c of activeCandidates) {
    const r = scoreMap.get(c.id) || { score: 30, verdict: 'keep', rationale: 'Unscored' };

    // Freshness bonus: +5 if published recently
    const freshnessBonus = freshness && freshness !== 'none' && c.published_at ? 5 : 0;

    // Final score = clamp(llm_score - blocklist_penalty + freshness_bonus, 0, 100)
    const finalScore = Math.max(0, Math.min(100, r.score - c.blocklist_penalty + freshnessBonus));

    c.final_score = finalScore;
    c.rationale = r.rationale;
    c.verdict = r.verdict;

    if (r.verdict === 'drop' || finalScore < scoreThreshold) {
      c.dropped_at_stage = 'rerank';
      c.drop_reason = r.verdict === 'drop' ? 'llm_verdict_drop' : 'below_score_threshold';
      newlyDropped.push(c);
    } else {
      newlyKept.push(c);
    }
  }

  // 6. Sort Surviving by final_score desc
  newlyKept.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));

  // 7. Domain Diversity Cap (max 3 per domain)
  const domainCounts = new Map<string, number>();
  const cappedKept: Candidate[] = [];

  for (const c of newlyKept) {
    const count = domainCounts.get(c.domain) || 0;
    if (count < maxPerDomain && cappedKept.length < maxResults) {
      domainCounts.set(c.domain, count + 1);
      cappedKept.push(c);
    } else {
      c.dropped_at_stage = 'rerank_diversity';
      c.drop_reason = `domain_cap_exceeded_${maxPerDomain}`;
      newlyDropped.push(c);
    }
  }

  return {
    candidates: [...cappedKept, ...newlyDropped, ...droppedCandidates],
    keptCount: cappedKept.length,
    droppedCount: newlyDropped.length + droppedCandidates.length,
    is_degraded: finalDegraded,
    system_prompt: systemPrompt,
    user_prompt: userMessage,
    raw_response: rawResponse,
    parse_ladder_rung: rungUsed,
  };
}
