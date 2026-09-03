import { NextRequest, NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { createGitHubIssue, uploadScreenshotToGitHub } from '@/lib/github';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      description,
      screenshot,
      search_id,
      pathname = '/',
      client_meta = {},
    } = body;

    const timestamp = new Date().toISOString();
    const cleanSearchId = search_id?.trim() || null;

    // 1. Fetch trace data if search_id is provided
    let trace: any = null;
    if (cleanSearchId) {
      try {
        trace = await store.getTrace(cleanSearchId);
      } catch (err) {
        console.warn('[Report Issue] Could not fetch trace for searchId:', cleanSearchId, err);
      }
    }

    // 2. Upload screenshot if available
    let screenshotUrl: string | null = null;
    if (screenshot && typeof screenshot === 'string' && screenshot.startsWith('data:image')) {
      const filename = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      try {
        const uploadRes = await uploadScreenshotToGitHub(screenshot, filename);
        screenshotUrl = uploadRes.url;
      } catch (err) {
        console.warn('[Report Issue] Screenshot upload error:', err);
      }
    }

    // 3. Construct Issue Title
    const query = trace?.query || (body.query ? String(body.query).trim() : null);
    const descSummary = description?.trim() ? description.trim().slice(0, 60) : 'Feedback & Pipeline Diagnostics';
    const issueTitle = query
      ? `[User Report] Search: "${query}" — ${descSummary}`
      : `[User Report] Page ${pathname} — ${descSummary}`;

    // 4. Construct Issue Body (Rich GitHub Markdown)
    const sections: string[] = [];

    // Header & User Description
    sections.push(`## User Issue Report`);
    if (description?.trim()) {
      sections.push(`> **User Description:**\n> ${description.trim().replace(/\n/g, '\n> ')}`);
    } else {
      sections.push(`*No written description provided by user.*`);
    }

    // Screenshot
    if (screenshotUrl) {
      sections.push(`\n### Captured Screen\n![Reported Screenshot](${screenshotUrl})`);
    }

    // Search Metadata Table
    if (trace) {
      sections.push(`\n### Search Metadata
| Parameter | Value |
| :--- | :--- |
| **Search ID** | \`${trace.id}\` |
| **Query** | \`${trace.query || 'N/A'}\` |
| **Intent** | \`${trace.intent || 'None'}\` |
| **Tier** | \`${(trace.tier || 'fast').toUpperCase()}\` |
| **Model** | \`${trace.model_id || 'N/A'}\` |
| **Status** | \`${trace.status}\` |
| **Elapsed Time** | \`${((trace.elapsed_ms || 0) / 1000).toFixed(2)}s\` |
| **Timestamp** | \`${trace.created_at || timestamp}\` |
`);

      // Step 0: Plan
      if (trace.audit?.plan) {
        const plan = trace.audit.plan;
        sections.push(`\n<details>
<summary><b>Pipeline Step 0: Plan</b> (Interpretation & Queries)</summary>

- **Interpretation:** ${plan.interpretation || 'None'}
- **Formulated Queries:**
${(plan.queries || []).map((q: string) => `  - \`${q}\``).join('\n') || '  - None'}
</details>`);
      }

      // Step 1: Retrieved Candidates
      if (trace.candidates && trace.candidates.length > 0) {
        const providersSummary = trace.audit?.retrieve?.provider_hits
          ? trace.audit.retrieve.provider_hits.map((p: any) => `${p.provider}: ${p.count} (${p.elapsed_ms}ms)`).join(', ')
          : 'N/A';

        sections.push(`\n<details>
<summary><b>Pipeline Step 1: Retrieved Candidates (${trace.candidates.length} total)</b></summary>

**Provider Breakdown:** ${providersSummary}

| # | Domain | Title | Sources | RRF Score |
| :--- | :--- | :--- | :--- | :--- |
${trace.candidates
  .map(
    (c: any, i: number) =>
      `| ${i + 1} | \`${c.domain}\` | [${(c.title || 'Untitled').replace(/\|/g, '-')}](${c.url}) | ${(c.sources || []).map((s: any) => s.provider).join(', ')} | ${c.fused_score?.toFixed(4) || 'N/A'} |`
  )
  .join('\n')}
</details>`);
      }

      // Step 2: Prefilter Decisions
      if (trace.audit?.prefilter?.evaluations) {
        const evals = trace.audit.prefilter.evaluations;
        const kept = evals.filter((e: any) => e.action?.includes('Keep') || !e.action?.includes('Drop'));
        const dropped = evals.filter((e: any) => e.action?.includes('Drop'));

        sections.push(`\n<details>
<summary><b>Pipeline Step 2: Prefilter Decisions (${kept.length} kept, ${dropped.length} dropped)</b></summary>

**✓ Kept Candidates:**
${kept.map((e: any) => `- \`${e.domain}\`: ${e.title} (cos: ${e.prefilter_score?.toFixed(3) || '0.000'})`).join('\n') || '- None'}

**✗ Dropped Candidates:**
${dropped.map((e: any) => `- ~~\`${e.domain}\`: ${e.title}~~ — *Reason: ${e.drop_reason || e.action}*`).join('\n') || '- None'}
</details>`);
      }

      // Step 3: Fetch & Read Content
      if (trace.audit?.fetch) {
        const fetchAudit = trace.audit.fetch;
        sections.push(`\n<details>
<summary><b>Pipeline Step 3: Fetch & Read (${fetchAudit.ok || 0} OK, ${fetchAudit.failed || 0} failed/blocked)</b></summary>

- **Attempted:** ${fetchAudit.attempted || 0}
- **Successfully Read:** ${fetchAudit.ok || 0}
- **Cached:** ${fetchAudit.cached || 0}
- **Failed / Blocked:** ${fetchAudit.failed || 0}

${(fetchAudit.items || []).map((it: any) => `- \`${it.domain}\`: status=\`${it.status}\`, method=\`${it.method}\`, chars=${it.chars}`).join('\n')}
</details>`);
      }

      // Step 4: Rerank Inference & Deliberation
      if (trace.audit?.rerank) {
        const rerank = trace.audit.rerank;
        sections.push(`\n<details>
<summary><b>Pipeline Step 4: Rerank Inference & Evaluations</b></summary>

- **Model Used:** \`${rerank.model_id || trace.model_id || 'N/A'}\`
- **Parse Ladder Rung:** \`${rerank.parse_ladder_rung || 'N/A'}\`

**Candidate Evaluations:**
${(rerank.evaluations || [])
  .map((ev: any) => `- **\`${ev.domain}\`** — Verdict: \`${ev.verdict || 'keep'}\`, Score: **${ev.score ?? ev.final_score ?? 0}**\n  *Rationale:* ${ev.rationale || 'None'}`)
  .join('\n')}

<details>
<summary><b>View Prompt XML Fed to Model</b></summary>

\`\`\`xml
${(rerank.user_prompt || '').slice(0, 15000)}
\`\`\`
</details>

<details>
<summary><b>View Raw Model Output</b></summary>

\`\`\`json
${(rerank.raw_response || '').slice(0, 8000)}
\`\`\`
</details>
</details>`);
      }

      // Step 5: Ranked Results
      if (trace.results && trace.results.length > 0) {
        sections.push(`\n<details open>
<summary><b>Pipeline Step 5: Final Ranked Results (${trace.results.length})</b></summary>

| Rank | Score | Domain & Title | Rationale |
| :--- | :--- | :--- | :--- |
${trace.results
  .map(
    (r: any) =>
      `| **#${r.rank}** | \`${r.final_score || r.score || 0}\` | **[${(r.title || r.domain).replace(/\|/g, '-')}](${r.url})**<br/>\`${r.domain}\` | ${r.rationale || 'N/A'} |`
  )
  .join('\n')}
</details>`);
      }

      // Deliberation Log
      if (trace.audit?.deliberation_log && trace.audit.deliberation_log.length > 0) {
        sections.push(`\n<details>
<summary><b>Pipeline Deliberation Log (${trace.audit.deliberation_log.length} entries)</b></summary>

${trace.audit.deliberation_log.map((d: any) => `- \`[${d.stage || 'info'}]\` ${d.message} *(+${d.elapsed_ms || 0}ms)*`).join('\n')}
</details>`);
      }
    }

    // Client & Environment Meta
    sections.push(`\n<details>
<summary><b>Client & Browser Diagnostics</b></summary>

- **Pathname:** \`${pathname}\`
- **User Agent:** \`${client_meta.user_agent || 'Unknown'}\`
- **Viewport:** \`${client_meta.viewport || 'Unknown'}\`
- **Screen Resolution:** \`${client_meta.screen || 'Unknown'}\`
- **Device Pixel Ratio:** \`${client_meta.dpr || 1}\`
- **Report Timestamp:** \`${timestamp}\`
</details>`);

    const issueBody = sections.join('\n');

    // 5. Submit Issue to GitHub
    try {
      const issueResult = await createGitHubIssue({
        title: issueTitle,
        body: issueBody,
        labels: ['user-report', 'bug'],
      });

      return NextResponse.json({
        success: true,
        issue_number: issueResult.number,
        issue_url: issueResult.html_url,
      });
    } catch (githubErr: any) {
      console.error('[Report Issue] GitHub issue creation failed:', githubErr);

      // Return informative response if token missing or API denied
      const repoFullName = process.env.GITHUB_REPO || '1719pankaj/Winnow';
      const fallbackUrl = `https://github.com/${repoFullName}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody.slice(0, 3000))}`;

      return NextResponse.json(
        {
          success: false,
          error: githubErr?.message || 'Failed to create GitHub issue automatically',
          fallback_url: fallbackUrl,
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error('[Report Issue API error]:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
