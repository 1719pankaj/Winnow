import fs from 'fs';
import path from 'path';
import { InferenceAdapter } from '../adapters/inference';

export interface PlanOutput {
  queries: string[];
  must_avoid_domains: string[];
  freshness: 'none' | 'week' | 'month' | 'year';
  interpretation: string;
  is_degraded?: boolean;
  system_prompt?: string;
  user_prompt?: string;
  raw_response?: string;
}

export async function stagePlan(
  query: string,
  intent: string | null,
  inferenceAdapter: InferenceAdapter | null,
  timeoutMs = 4000
): Promise<PlanOutput> {
  // If no intent is provided, skip planning and send query verbatim (Section 6.0)
  if (!intent || !intent.trim() || !inferenceAdapter) {
    return {
      queries: [query],
      must_avoid_domains: [],
      freshness: 'none',
      interpretation: 'Searching verbatim query.',
    };
  }

  const promptPath = path.join(process.cwd(), 'prompts', 'plan.v1.txt');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf8')
    : `You are the Winnow query planner. Generate up to 3 queries. Element 0 MUST be original query verbatim. Output JSON matching: {"queries": ["..."], "must_avoid_domains": [], "freshness": "none", "interpretation": "..."}`;

  const userContent = `QUERY: ${query}\nINTENT: ${intent}`;

  try {
    const callPromise = inferenceAdapter.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.1, maxTokens: 400, responseFormatJson: true }
    );

    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Plan timeout exceeded')), timeoutMs)
    );

    const rawJson = await Promise.race([callPromise, timeoutPromise]);
    const parsed = JSON.parse(rawJson.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());

    const plannedQueries = Array.isArray(parsed.queries) ? parsed.queries.filter(Boolean) : [];

    // Hard rule: Element 0 MUST be the original query verbatim
    const finalQueries = [query];
    for (const q of plannedQueries) {
      if (typeof q === 'string' && q.trim() && q.trim() !== query && finalQueries.length < 3) {
        finalQueries.push(q.trim());
      }
    }

    return {
      queries: finalQueries,
      must_avoid_domains: Array.isArray(parsed.must_avoid_domains) ? parsed.must_avoid_domains : [],
      freshness: ['week', 'month', 'year'].includes(parsed.freshness) ? parsed.freshness : 'none',
      interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : 'Interpreted intent for search.',
      system_prompt: systemPrompt,
      user_prompt: userContent,
      raw_response: rawJson,
    };
  } catch (err: any) {
    console.warn(`[Plan Stage] Degraded plan fallback: ${err.message}`);
    return {
      queries: [query],
      must_avoid_domains: [],
      freshness: 'none',
      interpretation: 'Intent noted; querying verbatim.',
      is_degraded: true,
      system_prompt: systemPrompt,
      user_prompt: userContent,
      raw_response: err.message,
    };
  }
}
