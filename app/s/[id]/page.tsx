'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RankedResult, Candidate, StageAuditData } from '@/lib/types';

type ActiveViewTab = '0_plan' | '1_retrieve' | '2_prefilter' | '3_fetch' | '4_rerank' | '5_result';

// Lightweight types for streamed data
interface StreamedCandidate {
  id: string; url: string; domain: string; title: string; snippet: string;
  sources: { provider: string; rank: number }[]; fused_score: number; published_at: string | null;
}

interface PrefilterEval {
  id: string; url: string; domain: string; title: string; snippet: string;
  prefilter_score: number; fused_score: number; action: string;
  drop_reason: string | null; dropped_at_stage: string | null;
}

interface FetchedPage {
  id: string; url: string; domain: string; title: string;
  fetch_status: string; extraction_method: string; char_count: number;
  truncated: boolean; text_preview: string;
}

interface RerankEval {
  id: string; domain: string; title: string; url: string;
  final_score: number; verdict: string; rationale: string;
}

interface RerankInference {
  model_id: string; parse_ladder_rung?: string;
  system_prompt?: string; user_prompt?: string; raw_response?: string;
  evaluations: RerankEval[];
}

function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: '2px', flexShrink: 0 }}
      loading="lazy"
    />
  );
}

function XmlPromptViewer({ rawText }: { rawText: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderFormattedLines = () => {
    return rawText.split('\n').map((line, idx) => {
      const trimmed = line.trim();

      // 1. Candidate opening tag: <candidate id="..." original_rank="..." domain="...">
      if (trimmed.startsWith('<candidate')) {
        const parts = line.split(/(<candidate|\/?>|[a-zA-Z_]+="[^"]*")/g).filter(Boolean);
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              {parts.map((p, pi) => {
                if (p === '<candidate' || p === '>' || p === '/>') {
                  return <span key={pi} style={{ color: '#38bdf8', fontWeight: 600 }}>{p}</span>;
                }
                if (p.includes('=')) {
                  const eqIdx = p.indexOf('=');
                  const attr = p.slice(0, eqIdx);
                  const val = p.slice(eqIdx + 1);
                  return (
                    <span key={pi}>
                      <span style={{ color: '#fbbf24' }}>{attr}</span>
                      <span style={{ color: '#94a3b8' }}>=</span>
                      <span style={{ color: '#34d399' }}>{val}</span>
                    </span>
                  );
                }
                return <span key={pi}>{p}</span>;
              })}
            </span>
          </div>
        );
      }

      // 2. Candidate closing tag: </candidate>
      if (trimmed === '</candidate>') {
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{'</candidate>'}</span>
            </span>
          </div>
        );
      }

      // 3. Known key prefixes like QUERY:, INTENT:, TITLE:, SNIPPET:, CONTENT:, CONTENT_UNAVAILABLE:
      const fieldMatch = line.match(/^(\s*)(QUERY|INTENT|TITLE|SNIPPET|CONTENT|CONTENT_UNAVAILABLE|URL|RANK):(.*)$/);
      if (fieldMatch) {
        const [, indent, label, rest] = fieldMatch;
        const labelColors: Record<string, string> = {
          QUERY: '#f43f5e',
          INTENT: '#ec4899',
          TITLE: '#60a5fa',
          SNIPPET: '#94a3b8',
          CONTENT: '#a78bfa',
          CONTENT_UNAVAILABLE: '#eab308',
          URL: '#38bdf8',
          RANK: '#fbbf24',
        };
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              {indent}
              <span style={{ color: labelColors[label] || '#38bdf8', fontWeight: 700, marginRight: '6px' }}>{label}:</span>
              <span style={{ color: label === 'QUERY' ? '#ffffff' : label === 'INTENT' ? '#f1f5f9' : '#e4e4e7' }}>{rest}</span>
            </span>
          </div>
        );
      }

      // 4. Instructions / Header commentary
      if (trimmed.startsWith('CANDIDATES') || trimmed.startsWith('SYSTEM:')) {
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              <span style={{ color: '#a1a1aa', fontStyle: 'italic', fontWeight: 500 }}>{line}</span>
            </span>
          </div>
        );
      }

      // 5. Generic lines
      return (
        <div key={idx} className="xml-line">
          <span className="xml-line-num">{idx + 1}</span>
          <span className="xml-line-content" style={{ color: '#cbd5e1' }}>{line || ' '}</span>
        </div>
      );
    });
  };

  const lineCount = rawText.split('\n').length;

  return (
    <div className="xml-viewer-container">
      <div className="xml-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="xml-badge-tag">&lt;/&gt; XML PROMPT</span>
          <span style={{ fontSize: '11px', color: '#a1a1aa', fontFamily: 'var(--font-mono, monospace)' }}>
            Candidate XML Context Fed to Model
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'monospace' }}>
            {lineCount} lines · {(rawText.length / 1024).toFixed(1)} KB
          </span>
          <button type="button" onClick={handleCopy} className="xml-copy-btn">
            {copied ? '✓ Copied' : 'Copy XML'}
          </button>
        </div>
      </div>
      <div className="xml-viewer-body">
        {renderFormattedLines()}
      </div>
    </div>
  );
}

function RawResponseViewer({ rawText, modelId }: { rawText: string; modelId?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = rawText.split('\n').length;

  return (
    <div className="xml-viewer-container">
      <div className="xml-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="xml-badge-tag" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
            RAW RESPONSE
          </span>
          <span style={{ fontSize: '11px', color: '#a1a1aa', fontFamily: 'var(--font-mono, monospace)' }}>
            {modelId ? `Inference from ${modelId}` : 'Raw LLM Model Output'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'monospace' }}>
            {lineCount} lines · {(rawText.length / 1024).toFixed(1)} KB
          </span>
          <button type="button" onClick={handleCopy} className="xml-copy-btn">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="xml-viewer-body" style={{ maxHeight: '420px' }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#e4e4e7' }}>
          {rawText}
        </pre>
      </div>
    </div>
  );
}

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const searchId = params.id as string;

  // Search Metadata
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [tier, setTier] = useState<'fast' | 'right'>('fast');
  const [modelId, setModelId] = useState<string>('');
  const [interpretation, setInterpretation] = useState<string | null>(null);

  // New Search Inputs (Top Searchbar)
  const [newQuery, setNewQuery] = useState('');
  const [newIntent, setNewIntent] = useState('');
  const [newTier, setNewTier] = useState<'fast' | 'right'>('fast');
  const [showIntentInput, setShowIntentInput] = useState(false);

  // Status & Stages
  const [searchStatus, setSearchStatus] = useState<'connecting' | 'running' | 'provisional' | 'final' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // Active Tab
  const [activeTab, setActiveTab] = useState<ActiveViewTab>('5_result');

  // Results & Chaff
  const [results, setResults] = useState<RankedResult[]>([]);
  const [chaff, setChaff] = useState<Candidate[]>([]);
  const [showChaff, setShowChaff] = useState(false);

  // Audit Data & Deliberation
  const [audit, setAudit] = useState<StageAuditData>({ deliberation_log: [] });

  // Rich Streamed Data
  const [streamedCandidates, setStreamedCandidates] = useState<StreamedCandidate[]>([]);
  const [prefilterEvals, setPrefilterEvals] = useState<PrefilterEval[]>([]);
  const [fetchedPages, setFetchedPages] = useState<FetchedPage[]>([]);
  const [rerankInference, setRerankInference] = useState<RerankInference | null>(null);
  const [expandedFetchIds, setExpandedFetchIds] = useState<Set<string>>(new Set());

  // Stage Progress
  const [stageCounts, setStageCounts] = useState<Record<string, { count?: number; status: 'pending' | 'active' | 'done' | 'skipped' }>>({
    plan: { status: 'pending' },
    retrieve: { status: 'pending' },
    prefilter: { status: 'pending' },
    fetch: { status: 'pending' },
    rerank: { status: 'pending' },
    result: { status: 'pending' },
  });

  const lastEventIdRef = useRef<number>(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [audit.deliberation_log?.length]);

  const handleNewSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newQuery.trim()) return;
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: newQuery.trim(), intent: newIntent.trim() || undefined, tier: newTier }),
      });
      const data = await res.json();
      if (data.search_id) router.push(`/s/${data.search_id}`);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (!searchId) return;
    let isSubscribed = true;

    const hydrateFromTrace = (trace: any) => {
      if (!trace) return;
      setQuery(trace.query); setNewQuery(trace.query);
      setIntent(trace.intent); setNewIntent(trace.intent || '');
      setTier(trace.tier); setNewTier(trace.tier);
      setModelId(trace.model_id); setElapsedMs(trace.elapsed_ms);
      if (trace.audit) setAudit(trace.audit);

      if (trace.candidates && trace.candidates.length > 0) {
        setStreamedCandidates((prev) => (prev.length > 0 ? prev : trace.candidates.map((c: any) => ({
          id: c.id,
          url: c.url,
          domain: c.domain,
          title: c.title,
          snippet: c.snippet,
          sources: c.sources || [],
          fused_score: c.fused_score || 0,
          published_at: c.published_at || null,
        }))));

        setPrefilterEvals((prev) => {
          if (prev.length > 0) return prev;
          if (trace.audit?.prefilter?.evaluations) {
            return trace.audit.prefilter.evaluations.map((ev: any) => ({
              id: ev.id,
              url: ev.url || '',
              domain: ev.domain,
              title: ev.title,
              snippet: ev.snippet || '',
              prefilter_score: ev.prefilter_score || 0,
              fused_score: ev.fused_score || 0,
              action: ev.action?.includes('Drop') ? 'Drop' : 'Keep',
              drop_reason: ev.drop_reason || (ev.action?.includes('Drop') ? ev.action : null),
              dropped_at_stage: ev.dropped_at_stage || null,
            }));
          }
          return trace.candidates.map((c: any) => ({
            id: c.id,
            url: c.url,
            domain: c.domain,
            title: c.title,
            snippet: c.snippet,
            prefilter_score: c.prefilter_score || 0,
            fused_score: c.fused_score || 0,
            action: c.dropped_at_stage ? 'Drop' : 'Keep',
            drop_reason: c.drop_reason || null,
            dropped_at_stage: c.dropped_at_stage || null,
          }));
        });

        setFetchedPages((prev) => {
          if (prev.length > 0) return prev;
          const withContent = trace.candidates.filter((c: any) => c.content);
          return withContent.map((c: any) => ({
            id: c.id,
            url: c.url,
            domain: c.domain,
            title: c.title,
            fetch_status: c.content.fetch_status,
            extraction_method: c.content.extraction_method,
            char_count: c.content.char_count,
            truncated: c.content.truncated,
            text_preview: c.content.text?.slice(0, 2000) || '',
          }));
        });
      }

      if (trace.audit?.rerank) {
        setRerankInference((prev) => {
          if (prev) return prev;
          return {
            model_id: trace.model_id,
            parse_ladder_rung: trace.audit.rerank.parse_ladder_rung,
            system_prompt: trace.audit.rerank.system_prompt,
            user_prompt: trace.audit.rerank.user_prompt,
            raw_response: trace.audit.rerank.raw_response,
            evaluations: trace.audit.rerank.evaluations?.map((ev: any) => ({
              id: ev.id,
              domain: ev.domain,
              title: ev.title || '',
              url: ev.url || '',
              final_score: ev.score ?? ev.final_score ?? 0,
              verdict: ev.verdict || 'keep',
              rationale: ev.rationale || '',
            })) || [],
          };
        });
      }

      if (trace.status === 'completed') {
        setResults(trace.results || []);
        const dropped = (trace.candidates || []).filter((c: Candidate) => c.dropped_at_stage);
        setChaff(dropped);
        setSearchStatus('final');
        setStageCounts({
          plan: { status: trace.intent ? 'done' : 'skipped', count: trace.audit?.plan?.queries?.length },
          retrieve: { status: 'done', count: trace.candidates?.length },
          prefilter: { status: 'done', count: trace.audit?.prefilter?.kept_count },
          fetch: { status: trace.tier === 'right' ? 'done' : 'skipped', count: trace.audit?.fetch?.ok },
          rerank: { status: 'done', count: trace.results?.length },
          result: { status: 'done', count: trace.results?.length },
        });
      }
    };

    fetch(`/api/trace/${searchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((trace) => {
        if (!isSubscribed || !trace) return;
        hydrateFromTrace(trace);
      }).catch(() => {});

    const eventSource = new EventSource(`/api/search/${searchId}/events?lastEventId=${lastEventIdRef.current}`);

    const handleEvent = (type: string, dataStr: string, idStr?: string) => {
      if (!isSubscribed) return;
      if (idStr) lastEventIdRef.current = parseInt(idStr, 10) || lastEventIdRef.current;
      let data: any = {};
      try { data = JSON.parse(dataStr); } catch { return; }

      switch (type) {
        case 'search_started':
          setQuery(data.query || ''); setNewQuery(data.query || '');
          setIntent(data.intent || null); setNewIntent(data.intent || '');
          setTier(data.tier || 'fast'); setNewTier(data.tier || 'fast');
          setModelId(data.model_id || ''); setSearchStatus('running');
          break;
        case 'deliberation':
          setAudit((prev) => ({ ...prev, deliberation_log: [...(prev.deliberation_log || []), data] }));
          break;
        case 'stage_started':
          setStageCounts((prev) => ({ ...prev, [data.stage]: { ...prev[data.stage], status: 'active' } }));
          break;
        case 'stage_skipped':
          setStageCounts((prev) => ({ ...prev, [data.stage]: { ...prev[data.stage], status: 'skipped' } }));
          break;
        case 'plan_done':
          setInterpretation(data.interpretation);
          setAudit((prev) => ({ ...prev, plan: { queries: data.queries, interpretation: data.interpretation, avoid_domains: [] } }));
          setStageCounts((prev) => ({ ...prev, plan: { status: 'done', count: data.queries?.length } }));
          break;
        case 'retrieve_done':
          setStageCounts((prev) => ({ ...prev, retrieve: { status: 'done', count: data.unique_count || data.raw_count } }));
          break;
        case 'retrieve_candidates':
          if (data.candidates) setStreamedCandidates(data.candidates);
          break;
        case 'prefilter_done':
          setStageCounts((prev) => ({ ...prev, prefilter: { status: 'done', count: data.kept } }));
          break;
        case 'prefilter_evaluations':
          if (data.evaluations) setPrefilterEvals(data.evaluations);
          break;
        case 'interim_results':
          if (data.results && Array.isArray(data.results)) {
            setResults(data.results);
            setSearchStatus((prev) => (prev === 'final' ? 'final' : 'provisional'));
          }
          break;
        case 'fetch_done':
          setStageCounts((prev) => ({ ...prev, fetch: { status: 'done', count: data.ok } }));
          break;
        case 'fetch_content':
          if (data.pages) setFetchedPages(data.pages);
          break;
        case 'rerank_done':
          setStageCounts((prev) => ({ ...prev, rerank: { status: 'done', count: data.kept } }));
          break;
        case 'rerank_inference':
          setRerankInference(data);
          break;
        case 'results':
          if (data.results) {
            setResults(data.results);
            setSearchStatus('final');
            setStageCounts((prev) => ({ ...prev, result: { status: 'done', count: data.results.length } }));
          }
          break;
        case 'done':
          setElapsedMs(data.elapsed_ms || 0);
          setSearchStatus('final');
          fetch(`/api/trace/${searchId}`)
            .then((r) => r.json())
            .then((t) => {
              if (t) hydrateFromTrace(t);
            }).catch(() => {});
          eventSource.close();
          break;
        case 'error':
          setErrorMessage(data.message || 'An error occurred');
          setSearchStatus('error');
          eventSource.close();
          break;
      }
    };

    const eventTypes = [
      'search_started', 'deliberation', 'stage_started', 'stage_skipped',
      'plan_done', 'provider_returned', 'provider_error', 'retrieve_done', 'retrieve_candidates',
      'prefilter_started', 'prefilter_done', 'prefilter_evaluations', 'interim_results',
      'fetch_started', 'fetch_progress', 'fetch_done', 'fetch_content',
      'rerank_started', 'rerank_done', 'rerank_inference', 'degraded', 'results', 'done', 'error',
    ];
    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, (e: MessageEvent) => handleEvent(type, e.data, e.lastEventId));
    });

    return () => { isSubscribed = false; eventSource.close(); };
  }, [searchId]);

  const isLive = searchStatus === 'running' || searchStatus === 'provisional';

  return (
    <div>
      {/* Sticky Header */}
      <header className="results-header-sticky">
        <div className="results-header-container">
          <div className="results-header-top-row">
            <div className="results-header-brand-bar">
              <a href="/" className="header-brand-link"><span>Winnow</span></a>

              <div className="results-header-mobile-actions mobile-only">
                <div className="tier-segmented" style={{ padding: '2px' }}>
                  <button type="button" className={`tier-tab-btn ${newTier === 'fast' ? 'active' : ''}`} onClick={() => setNewTier('fast')} style={{ padding: '3px 7px', fontSize: '11px' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                    <span>Fast</span>
                  </button>
                  <button type="button" className={`tier-tab-btn ${newTier === 'right' ? 'active' : ''}`} onClick={() => setNewTier('right')} style={{ padding: '3px 7px', fontSize: '11px' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                    <span>Right</span>
                  </button>
                </div>

                <a href="/models" className="header-models-link" title="View all models" style={{ padding: '4px 8px' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                  <span>Models</span>
                </a>
              </div>
            </div>

            <form onSubmit={handleNewSearch} className="results-search-bar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" className="results-query-input" placeholder="Search query..." value={newQuery} onChange={(e) => setNewQuery(e.target.value)} />

              <button type="button" className={`intent-toggle-btn ${newIntent ? 'has-intent' : ''}`} onClick={() => setShowIntentInput(!showIntentInput)}>
                {newIntent ? 'Intent: Active' : '+ Intent'}
              </button>

              <div className="tier-segmented desktop-only" style={{ padding: '2px' }}>
                <button type="button" className={`tier-tab-btn ${newTier === 'fast' ? 'active' : ''}`} onClick={() => setNewTier('fast')} style={{ padding: '3px 8px', fontSize: '11px' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Fast</span>
                </button>
                <button type="button" className={`tier-tab-btn ${newTier === 'right' ? 'active' : ''}`} onClick={() => setNewTier('right')} style={{ padding: '3px 8px', fontSize: '11px' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                  <span>Right</span>
                </button>
              </div>
              <button type="submit" className="results-submit-btn">Search</button>
            </form>

            <a href="/models" className="header-models-link desktop-only" title="View all models">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
              <span>Models</span>
            </a>
          </div>

          {(showIntentInput || (newIntent && newIntent.length > 0)) && (
            <div className="results-intent-aligned-row">
              <input type="text" className="results-intent-input-box" placeholder="Intent / constraints context..." value={newIntent} onChange={(e) => setNewIntent(e.target.value)} />
            </div>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="results-layout">
        {/* Left Rail */}
        <aside>
          <div className="pipeline-rail">
            <div className="pipeline-rail-title">
              Pipeline Progress
              {isLive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0284c7', display: 'inline-block', marginLeft: '8px', animation: 'pulse 1.5s infinite' }} />}
            </div>

            {[
              { key: '0_plan' as ActiveViewTab, label: '0. Plan', stage: 'plan' },
              { key: '1_retrieve' as ActiveViewTab, label: '1. Retrieve', stage: 'retrieve' },
              { key: '2_prefilter' as ActiveViewTab, label: '2. Prefilter', stage: 'prefilter' },
              { key: '3_fetch' as ActiveViewTab, label: '3. Fetch & Read', stage: 'fetch' },
              { key: '4_rerank' as ActiveViewTab, label: '4. Rerank', stage: 'rerank' },
            ].map(({ key, label, stage }) => {
              const state = stageCounts[stage];
              const isSelected = activeTab === key;
              const isActive = state?.status === 'active';
              const isDone = state?.status === 'done';

              return (
                <button key={key} type="button" className={`rail-stage-item ${isSelected ? 'selected' : ''} ${isActive ? 'active-live' : ''}`} onClick={() => setActiveTab(key)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ) : isActive ? (
                      <svg className="spin-animate" style={{ animation: 'spin 0.8s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                    ) : (
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#d4d4d8' }} />
                    )}
                    <span>{label}</span>
                  </div>
                  {state?.count !== undefined && <span className="stage-badge-count">{state.count}</span>}
                </button>
              );
            })}

            <div className="rail-divider" />

            <button type="button" className={`rail-stage-item ${activeTab === '5_result' ? 'selected' : ''}`} onClick={() => setActiveTab('5_result')} style={{ fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <span>5. Ranked Results</span>
              </div>
              <span className="stage-badge-count" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>{results.length}</span>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main>
          {/* Deliberation Log */}
          {(isLive || (audit.deliberation_log && audit.deliberation_log.length > 0)) && (
            <div className="delib-card">
              <div className="delib-card-head">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="delib-pulse-dot" style={{ background: searchStatus === 'final' ? '#22c55e' : '#38bdf8' }} />
                  <span>Pipeline Deliberation Log</span>
                </div>
                <span>{searchStatus === 'final' ? 'Completed' : 'Streaming...'}</span>
              </div>
              <div className="delib-scroll-box">
                {audit.deliberation_log?.map((item, idx) => (
                  <div key={idx}>
                    <span className="delib-item-stage">[{item.stage.toUpperCase()}]</span>
                    <span>{item.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* ===================== TAB 0: PLAN ===================== */}
          {activeTab === '0_plan' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 0: Query Planner</div>
                <span className="meta-chip">Intent Decomposition</span>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Formulated Queries:</strong>
                <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px', color: '#3f3f46' }}>
                  {audit.plan?.queries?.map((q, idx) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>{idx === 0 ? `(Original) "${q}"` : `(Expanded) "${q}"`}</li>
                  )) || <li>Verbatim query used</li>}
                </ul>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Interpretation:</strong>
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#0284c7' }}>{audit.plan?.interpretation || 'Standard verbatim search.'}</div>
              </div>
              {audit.plan?.system_prompt && (
                <div><strong style={{ fontSize: '13px' }}>System Prompt:</strong><pre className="code-pre-box">{audit.plan.system_prompt}</pre></div>
              )}
              {audit.plan?.raw_response && (
                <div style={{ marginTop: '16px' }}><strong style={{ fontSize: '13px' }}>Raw LLM Output:</strong><pre className="code-pre-box">{audit.plan.raw_response}</pre></div>
              )}
            </div>
          )}

          {/* ===================== TAB 1: RETRIEVE ===================== */}
          {activeTab === '1_retrieve' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 1: Retrieved Sites</div>
                <span className="meta-chip">{streamedCandidates.length} candidates from {audit.retrieve?.provider_hits?.length || '?'} providers</span>
              </div>

              {/* Provider breakdown */}
              {audit.retrieve?.provider_hits && audit.retrieve.provider_hits.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {audit.retrieve.provider_hits.map((p, idx) => (
                    <div key={idx} style={{ background: '#f4f4f5', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '11px' }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{p.provider}</span>
                      <span style={{ color: 'var(--muted-foreground)', marginLeft: '6px' }}>{p.count} hits · {p.elapsed_ms}ms</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Full candidate table */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted-foreground)' }}>SITE</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted-foreground)', width: '120px' }}>PROVIDERS</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--muted-foreground)', width: '80px' }}>RRF SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streamedCandidates.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                            <Favicon domain={c.domain} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '13px' }}>{c.domain}</span>
                              </div>
                              <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#0369a1', fontWeight: 500, textDecoration: 'none' }}>{c.title}</a>
                              <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '2px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{c.snippet}</p>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {c.sources.map((s, si) => (
                              <span key={si} style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: '9px', fontWeight: 700, background: '#f0f0f0', border: '1px solid #e0e0e0', textTransform: 'uppercase' }}>{s.provider}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                          <span className="mono" style={{ fontWeight: 700, fontSize: '12px', color: '#0284c7' }}>{c.fused_score.toFixed(4)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {streamedCandidates.length === 0 && (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                    {isLive ? 'Waiting for providers to return results...' : 'No candidates retrieved.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================== TAB 2: PREFILTER ===================== */}
          {activeTab === '2_prefilter' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 2: Prefilter Gate</div>
                <span className="meta-chip">Semantic + Blocklist Filtering</span>
              </div>

              {/* Summary bar */}
              {prefilterEvals.length > 0 && (
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                    ✓ Kept: {prefilterEvals.filter((e) => e.action === 'Keep').length}
                  </div>
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: '#991b1b' }}>
                    ✗ Dropped: {prefilterEvals.filter((e) => e.action !== 'Keep').length}
                  </div>
                </div>
              )}

              {/* Kept candidates */}
              {prefilterEvals.filter((e) => e.action === 'Keep').length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✓ Passed ({prefilterEvals.filter((e) => e.action === 'Keep').length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {prefilterEvals.filter((e) => e.action === 'Keep').map((ev) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#fafffe', border: '1px solid #dcfce7', borderRadius: 'var(--radius-md)', fontSize: '12px', minWidth: 0 }}>
                        <Favicon domain={ev.domain} />
                        <span style={{ fontWeight: 600, maxWidth: '120px', minWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.domain}</span>
                        <span style={{ flex: 1, minWidth: 0, color: '#3f3f46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                        <span className="mono" style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>cos: {ev.prefilter_score.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dropped candidates */}
              {prefilterEvals.filter((e) => e.action !== 'Keep').length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✗ Blocked ({prefilterEvals.filter((e) => e.action !== 'Keep').length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {prefilterEvals.filter((e) => e.action !== 'Keep').map((ev) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#fffbfb', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', fontSize: '12px', minWidth: 0 }}>
                        <Favicon domain={ev.domain} />
                        <span style={{ fontWeight: 600, maxWidth: '120px', minWidth: '70px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.domain}</span>
                        <span style={{ flex: 1, minWidth: 0, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{ev.title}</span>
                        <span style={{ padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: '#fee2e2', color: '#991b1b', flexShrink: 0 }}>{ev.drop_reason || 'filtered'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {prefilterEvals.length === 0 && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  {isLive ? 'Prefilter evaluations pending...' : 'No prefilter data available.'}
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 3: FETCH & READ ===================== */}
          {activeTab === '3_fetch' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 3: Fetched Page Content</div>
                <span className="meta-chip">{fetchedPages.length > 0 ? `${fetchedPages.length} pages extracted` : tier === 'fast' ? 'Snippet Mode' : 'DOM Parsing'}</span>
              </div>

              {tier === 'fast' && fetchedPages.length === 0 && (
                <div>
                  <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 'var(--radius-lg)', padding: '14px 18px', fontSize: '13px', color: '#854d0e', marginBottom: '16px' }}>
                    <strong>Fast Tier:</strong> Full-page scraping is bypassed for low latency (&lt;3s). The candidate snippets below were ingested and passed into the listwise LLM reranker. (Switch to <strong>Right</strong> tier for full DOM readability extraction).
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Ingested Candidate Snippets ({streamedCandidates.length})
                  </div>

                  {streamedCandidates.map((c) => {
                    const isExpanded = expandedFetchIds.has(c.id);
                    return (
                      <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: '10px', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedFetchIds((prev) => {
                              const next = new Set(prev);
                              next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                              return next;
                            });
                          }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'var(--secondary)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{isExpanded ? '▾' : '▸'}</span>
                          <Favicon domain={c.domain} />
                          <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>{c.domain}</span>
                          <span style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                            SNIPPET
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>{c.snippet.length} chars</span>
                        </button>
                        {isExpanded && (
                          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', padding: '8px 0 6px', fontWeight: 600 }}>
                              {c.title}
                            </div>
                            <pre style={{
                              background: '#09090b', color: '#d4d4d8', padding: '14px', borderRadius: 'var(--radius-md)',
                              fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              margin: 0,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            }}>
                              {c.snippet}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {fetchedPages.map((page) => {
                const isExpanded = expandedFetchIds.has(page.id);
                const isOk = page.fetch_status === 'ok' || page.fetch_status === 'cached';

                return (
                  <div key={page.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: '10px', overflow: 'hidden' }}>
                    {/* Card Header */}
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedFetchIds((prev) => {
                          const next = new Set(prev);
                          next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                          return next;
                        });
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'var(--secondary)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{isExpanded ? '▾' : '▸'}</span>
                      <Favicon domain={page.domain} />
                      <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>{page.domain}</span>
                      <span style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: isOk ? '#f0fdf4' : '#fef2f2', color: isOk ? '#166534' : '#991b1b', border: `1px solid ${isOk ? '#bbf7d0' : '#fecaca'}` }}>
                        {page.fetch_status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>{page.char_count.toLocaleString()} chars</span>
                      <span style={{ fontSize: '10px', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>{page.extraction_method}</span>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', padding: '8px 0 6px', fontWeight: 600 }}>
                          {page.title}
                        </div>
                        <pre style={{
                          background: '#09090b', color: '#d4d4d8', padding: '14px', borderRadius: 'var(--radius-md)',
                          fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: '500px', overflowY: 'auto', margin: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        }}>
                          {page.text_preview || '(No content extracted)'}
                          {page.truncated && <span style={{ color: '#a855f7' }}>{'\n\n'}... [truncated at 2000 chars — full text: {page.char_count.toLocaleString()} chars]</span>}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}

              {tier === 'right' && fetchedPages.length === 0 && isLive && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  Fetching and extracting page content...
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 4: RERANK ===================== */}
          {activeTab === '4_rerank' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 4: LLM Reranking & Deliberation</div>
                <span className="meta-chip">Model: {rerankInference?.model_id || modelId || '...'}</span>
                {rerankInference?.parse_ladder_rung && <span className="meta-chip">{rerankInference.parse_ladder_rung}</span>}
              </div>

              {/* Per-candidate evaluation table */}
              {rerankInference?.evaluations && rerankInference.evaluations.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Candidate Evaluations</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    {rerankInference.evaluations.map((ev, idx) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', borderBottom: idx < rerankInference.evaluations.length - 1 ? '1px solid var(--border)' : 'none', fontSize: '12px' }}>
                        <Favicon domain={ev.domain} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{ fontWeight: 600 }}>{ev.domain}</span>
                            <span style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: '9px', fontWeight: 700, background: ev.verdict === 'keep' ? '#f0fdf4' : '#fef2f2', color: ev.verdict === 'keep' ? '#166534' : '#991b1b', border: `1px solid ${ev.verdict === 'keep' ? '#bbf7d0' : '#fecaca'}` }}>
                              {ev.verdict.toUpperCase()}
                            </span>
                            <span className="mono" style={{ fontSize: '11px', fontWeight: 700, color: '#0284c7' }}>Score: {ev.final_score}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#52525b' }}>{ev.title}</div>
                          {ev.rationale && (
                            <div style={{ marginTop: '4px', fontSize: '11px', color: '#0369a1', fontStyle: 'italic', borderLeft: '2px solid #bae6fd', paddingLeft: '8px' }}>
                              {ev.rationale}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LLM Prompt */}
              {(rerankInference?.user_prompt || audit.rerank?.user_prompt) && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                    Candidate XML Context Fed to Model:
                  </div>
                  <XmlPromptViewer rawText={rerankInference?.user_prompt || audit.rerank?.user_prompt || ''} />
                </div>
              )}

              {/* Raw LLM Response */}
              {(rerankInference?.raw_response || audit.rerank?.raw_response) && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                    Raw LLM Model Output:
                  </div>
                  <RawResponseViewer
                    rawText={rerankInference?.raw_response || audit.rerank?.raw_response || ''}
                    modelId={rerankInference?.model_id || modelId}
                  />
                </div>
              )}

              {!rerankInference && !audit.rerank && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  {isLive ? 'LLM reranking in progress...' : 'No rerank data available.'}
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 5: RANKED RESULTS ===================== */}
          {activeTab === '5_result' && (
            <div>
              <div className="results-header-info">
                <h1 className="results-query-title">{query}</h1>
                {intent && <div className="results-intent-text">Intent: {intent}</div>}
                {interpretation && <div style={{ fontSize: '13px', color: '#0284c7', marginTop: '2px' }}>› Interpretation: {interpretation}</div>}
                <div className="results-meta-bar">
                  <span className="meta-chip">{results.length} results</span>
                  {elapsedMs > 0 && <span className="meta-chip">{(elapsedMs / 1000).toFixed(1)}s</span>}
                  <span className="meta-chip">Model: {modelId || '...'}</span>
                  <span className="meta-chip">Tier: {tier.toUpperCase()}</span>
                </div>
              </div>

              {searchStatus === 'provisional' && (
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 'var(--radius-lg)', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Provisional results — listwise LLM reranking in progress...</span>
                </div>
              )}

              <div>
                {results.map((r, index) => {
                  const isPromoted = r.provenance.rank_delta > 0;
                  const deltaText = isPromoted ? `+${r.provenance.rank_delta}` : r.provenance.rank_delta === 0 ? '·' : `${r.provenance.rank_delta}`;
                  const providerNames = r.provenance.providers.map((p: any) => typeof p === 'string' ? p : p.provider).join(', ');

                  return (
                    <article key={r.url} className="result-card-shadcn">
                      <div className={`rank-badge-clean ${isPromoted ? 'promoted' : ''}`} title={`Rank delta: ${deltaText}`}>
                        <span>#{index + 1}</span>
                        {r.provenance.rank_delta !== 0 && <span style={{ fontSize: '10px', opacity: 0.8 }}>{deltaText}</span>}
                      </div>

                      <div className="result-card-content">
                        <div className="result-domain-row">
                          <Favicon domain={r.domain} />
                          <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{r.domain}</span>
                          <span>·</span>
                          <span>{providerNames}</span>
                          {r.provenance.was_read && (
                            <span style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)', padding: '1px 5px', fontSize: '10px', fontWeight: 600 }}>PAGE READ</span>
                          )}
                        </div>

                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="result-title-link">
                          <span>{r.title}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>

                        <p className="result-snippet-text">{r.snippet}</p>

                        {r.rationale && (
                          <div className="result-rationale-box">
                            <strong>AI Rationale:</strong> {r.rationale}
                          </div>
                        )}
                      </div>

                      <div className="result-score-tag" title="Relevance Score">{r.score}</div>
                    </article>
                  );
                })}
              </div>

              {chaff.length > 0 && (
                <div className="chaff-collapse-card">
                  <button type="button" className="chaff-collapse-btn" onClick={() => setShowChaff(!showChaff)}>
                    <span>{showChaff ? '▾' : '▸'} {chaff.length} Dropped Candidates (Chaff)</span>
                    <span style={{ fontSize: '11px' }}>Filtered during Prefilter / Retrieval</span>
                  </button>
                  {showChaff && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {chaff.map((c) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <Favicon domain={c.domain} />
                          <span style={{ fontWeight: 600 }}>{c.domain}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#71717a' }}>{c.title}</span>
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 600 }}>{c.drop_reason || 'dropped'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
