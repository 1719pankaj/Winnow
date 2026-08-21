import { HttpSearchAdapter } from '../adapters/search';
import { RawResult, Candidate } from '../types';
import { canonicalizeUrl, extractDomain, normalizeTitle } from '../urls';

export interface RetrieveOptions {
  providers: HttpSearchAdapter[];
  queries: string[];
  countPerRequest?: number;
  rrfK?: number;
  maxPerDomain?: number;
  onProviderReturned?: (provider: string, queryIdx: number, count: number, elapsedMs: number) => void;
  onProviderError?: (provider: string, err: any) => void;
}

export async function stageRetrieve(options: RetrieveOptions): Promise<Candidate[]> {
  const {
    providers,
    queries,
    countPerRequest = 20,
    rrfK = 60,
    maxPerDomain = 3,
    onProviderReturned,
    onProviderError,
  } = options;

  // 1. Concurrently fan out across providers x queries
  const fetchTasks: Promise<{ provider: string; queryIdx: number; results: RawResult[] }>[] = [];

  for (const provider of providers) {
    if (!provider.isEnabled) continue;

    queries.forEach((q, qIdx) => {
      fetchTasks.push(
        (async () => {
          const t0 = Date.now();
          try {
            const rawHits = await provider.search(q, countPerRequest);
            const elapsed = Date.now() - t0;
            if (onProviderReturned) {
              onProviderReturned(provider.name, qIdx, rawHits.length, elapsed);
            }
            return { provider: provider.name, queryIdx: qIdx, results: rawHits };
          } catch (err: any) {
            if (onProviderError) {
              onProviderError(provider.name, err);
            }
            return { provider: provider.name, queryIdx: qIdx, results: [] };
          }
        })()
      );
    });
  }

  const allResponses = await Promise.all(fetchTasks);

  // 2. Group raw results by canonical URL
  const providerWeightMap = new Map(providers.map((p) => [p.name, p.weight]));
  const canonicalMap = new Map<
    string,
    {
      rawHit: RawResult;
      sources: { provider: string; rank: number }[];
      fusedScore: number;
    }
  >();

  for (const resp of allResponses) {
    const pWeight = providerWeightMap.get(resp.provider) || 1.0;

    for (const hit of resp.results) {
      if (!hit.url) continue;
      const canonical = canonicalizeUrl(hit.url);

      const rrfContribution = pWeight / (rrfK + hit.rank);

      if (!canonicalMap.has(canonical)) {
        canonicalMap.set(canonical, {
          rawHit: hit,
          sources: [{ provider: resp.provider, rank: hit.rank }],
          fusedScore: rrfContribution,
        });
      } else {
        const existing = canonicalMap.get(canonical)!;
        existing.sources.push({ provider: resp.provider, rank: hit.rank });
        existing.fusedScore += rrfContribution;
      }
    }
  }

  // 3. Near-duplicate detection: group by (domain, normalized_title)
  const titleMap = new Map<string, Array<{ canonical: string; fusedScore: number }>>();

  for (const [canonical, entry] of canonicalMap.entries()) {
    const domain = extractDomain(entry.rawHit.url);
    const normTitle = normalizeTitle(entry.rawHit.title);
    const key = `${domain}::${normTitle}`;

    if (!titleMap.has(key)) {
      titleMap.set(key, []);
    }
    titleMap.get(key)!.push({ canonical, fusedScore: entry.fusedScore });
  }

  // Keep highest fused score within near-duplicate group
  const survivingCanonicals = new Set<string>();
  const droppedNearDupes = new Set<string>();

  for (const group of titleMap.values()) {
    group.sort((a, b) => b.fusedScore - a.fusedScore);
    survivingCanonicals.add(group[0].canonical);
    for (let i = 1; i < group.length; i++) {
      droppedNearDupes.add(group[i].canonical);
    }
  }

  // 4. Transform to Candidate models & Sort by Fused Score
  const candidates: Candidate[] = [];
  let candidateIdx = 1;

  for (const [canonical, entry] of canonicalMap.entries()) {
    const isNearDupe = droppedNearDupes.has(canonical);
    const candidateId = `c${String(candidateIdx++).padStart(2, '0')}`;

    candidates.push({
      id: candidateId,
      url: canonical,
      raw_url: entry.rawHit.url,
      domain: extractDomain(entry.rawHit.url),
      title: entry.rawHit.title || 'Untitled',
      snippet: entry.rawHit.snippet || '',
      published_at: entry.rawHit.published_at || null,
      sources: entry.sources,
      fused_score: entry.fusedScore,
      prefilter_score: null,
      blocklist_penalty: 0,
      content: null,
      final_score: null,
      rationale: null,
      verdict: null,
      dropped_at_stage: isNearDupe ? 'dedupe' : null,
      drop_reason: isNearDupe ? 'near_duplicate' : null,
    });
  }

  // 5. Sort active candidates by fused_score desc
  const active = candidates.filter((c) => !c.dropped_at_stage);
  const dropped = candidates.filter((c) => c.dropped_at_stage);

  active.sort((a, b) => b.fused_score - a.fused_score);

  // 6. Domain diversity cap (max N per domain)
  const domainCounts = new Map<string, number>();
  const cappedActive: Candidate[] = [];

  for (const c of active) {
    const count = domainCounts.get(c.domain) || 0;
    if (count < maxPerDomain) {
      domainCounts.set(c.domain, count + 1);
      cappedActive.push(c);
    } else {
      c.dropped_at_stage = 'diversity_cap';
      c.drop_reason = `domain_diversity_exceeded_${maxPerDomain}`;
      dropped.push(c);
    }
  }

  return [...cappedActive, ...dropped];
}
