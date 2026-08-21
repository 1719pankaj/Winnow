import { Candidate, RankedResult, Provenance } from '../types';

export function stageAssemble(candidates: Candidate[]): RankedResult[] {
  const kept = candidates.filter((c) => !c.dropped_at_stage && c.final_score !== null);

  // Sort by final_score descending
  kept.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));

  return kept.map((c, idx) => {
    const finalRank = idx + 1;
    const bestOriginalRank = Math.min(...c.sources.map((s) => s.rank), 20);
    const rankDelta = bestOriginalRank - finalRank;

    const provenance: Provenance = {
      providers: c.sources,
      original_best_rank: bestOriginalRank,
      rank_delta: rankDelta,
      prefilter_score: c.prefilter_score,
      was_read: c.content !== null && c.content.fetch_status === 'ok',
      penalties: c.blocklist_penalty > 0 ? [`soft_blocklist_${c.blocklist_penalty}`] : [],
    };

    return {
      rank: finalRank,
      url: c.raw_url,
      domain: c.domain,
      title: c.title,
      snippet: c.snippet,
      score: c.final_score || 0,
      rationale: c.rationale || 'Ranked by relevance to intent.',
      provenance,
    };
  });
}
