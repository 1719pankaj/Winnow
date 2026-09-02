'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RankedResult, Candidate, StageAuditData } from '@/lib/types';

type ActiveViewTab = '0_plan' | '1_retrieve' | '2_prefilter' | '3_fetch' | '4_rerank' | '5_result';

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

  // Active Audit Inspector Tab (defaults to 5_result)
  const [activeTab, setActiveTab] = useState<ActiveViewTab>('5_result');

  // Results & Chaff
  const [results, setResults] = useState<RankedResult[]>([]);
  const [chaff, setChaff] = useState<Candidate[]>([]);
  const [showChaff, setShowChaff] = useState(false);

  // Audit Data & Real-time Deliberation Stream
  const [audit, setAudit] = useState<StageAuditData>({
    deliberation_log: [],
  });

  // Stage Progress Indicators for Rail
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

  // Auto-scroll deliberation log
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [audit.deliberation_log?.length]);

  // Execute new search from top searchbar
  const handleNewSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newQuery.trim()) return;

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: newQuery.trim(),
          intent: newIntent.trim() || undefined,
          tier: newTier,
        }),
      });
      const data = await res.json();
      if (data.search_id) {
        router.push(`/s/${data.search_id}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!searchId) return;

    let isSubscribed = true;

    // 1. Initial check: Is trace already finished in store?
    fetch(`/api/trace/${searchId}`)
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((trace) => {
        if (!isSubscribed || !trace) return;

        setQuery(trace.query);
        setNewQuery(trace.query);
        setIntent(trace.intent);
        setNewIntent(trace.intent || '');
        setTier(trace.tier);
        setNewTier(trace.tier);
        setModelId(trace.model_id);
        setElapsedMs(trace.elapsed_ms);

        if (trace.audit) {
          setAudit(trace.audit);
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
      })
      .catch(() => {});

    // 2. Connect to Server-Sent Events (SSE) Stream
    const eventSource = new EventSource(`/api/search/${searchId}/events?lastEventId=${lastEventIdRef.current}`);

    const handleEvent = (type: string, dataStr: string, idStr?: string) => {
      if (!isSubscribed) return;
      if (idStr) {
        lastEventIdRef.current = parseInt(idStr, 10) || lastEventIdRef.current;
      }

      let data: any = {};
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }

      switch (type) {
        case 'search_started':
          setQuery(data.query || '');
          setNewQuery(data.query || '');
          setIntent(data.intent || null);
          setNewIntent(data.intent || '');
          setTier(data.tier || 'fast');
          setNewTier(data.tier || 'fast');
          setModelId(data.model_id || '');
          setSearchStatus('running');
          break;

        case 'deliberation':
          setAudit((prev) => ({
            ...prev,
            deliberation_log: [...(prev.deliberation_log || []), data],
          }));
          break;

        case 'stage_started':
          setStageCounts((prev) => ({
            ...prev,
            [data.stage]: { ...prev[data.stage], status: 'active' },
          }));
          break;

        case 'stage_skipped':
          setStageCounts((prev) => ({
            ...prev,
            [data.stage]: { ...prev[data.stage], status: 'skipped' },
          }));
          break;

        case 'plan_done':
          setInterpretation(data.interpretation);
          setStageCounts((prev) => ({
            ...prev,
            plan: { status: 'done', count: data.queries?.length },
          }));
          break;

        case 'retrieve_done':
          setStageCounts((prev) => ({
            ...prev,
            retrieve: { status: 'done', count: data.unique_count || data.raw_count },
          }));
          break;

        case 'prefilter_done':
          setStageCounts((prev) => ({
            ...prev,
            prefilter: { status: 'done', count: data.kept },
          }));
          break;

        case 'interim_results':
          if (data.results && Array.isArray(data.results)) {
            setResults(data.results);
            setSearchStatus((prev) => (prev === 'final' ? 'final' : 'provisional'));
          }
          break;

        case 'fetch_done':
          setStageCounts((prev) => ({
            ...prev,
            fetch: { status: 'done', count: data.ok },
          }));
          break;

        case 'rerank_done':
          setStageCounts((prev) => ({
            ...prev,
            rerank: { status: 'done', count: data.kept },
          }));
          break;

        case 'results':
          if (data.results) {
            setResults(data.results);
            setSearchStatus('final');
            setStageCounts((prev) => ({
              ...prev,
              result: { status: 'done', count: data.results.length },
            }));
          }
          break;

        case 'done':
          setElapsedMs(data.elapsed_ms || 0);
          setSearchStatus('final');
          fetch(`/api/trace/${searchId}`)
            .then((r) => r.json())
            .then((t) => {
              if (t.audit) setAudit(t.audit);
              const dropped = (t.candidates || []).filter((c: Candidate) => c.dropped_at_stage);
              setChaff(dropped);
            })
            .catch(() => {});
          eventSource.close();
          break;

        case 'error':
          setErrorMessage(data.message || 'An error occurred during search');
          setSearchStatus('error');
          eventSource.close();
          break;
      }
    };

    const eventTypes = [
      'search_started', 'deliberation', 'stage_started', 'stage_skipped',
      'plan_done', 'provider_returned', 'provider_error', 'retrieve_done',
      'prefilter_started', 'prefilter_done', 'interim_results',
      'fetch_started', 'fetch_progress', 'fetch_done',
      'rerank_started', 'rerank_done', 'degraded', 'results', 'done', 'error',
    ];

    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, (e: MessageEvent) => {
        handleEvent(type, e.data, e.lastEventId);
      });
    });

    return () => {
      isSubscribed = false;
      eventSource.close();
    };
  }, [searchId]);

  return (
    <div>
      {/* Sticky Clean Header */}
      <header className="results-header-sticky">
        <div className="results-header-container">
          <div className="results-header-top-row">
            <a href="/" className="header-brand-link">
              <span>Winnow</span>
            </a>

            {/* Main Search Bar */}
            <form onSubmit={handleNewSearch} className="results-search-bar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>

              <input
                type="text"
                className="results-query-input"
                placeholder="Search query..."
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
              />

              {/* Intent Toggle Button */}
              <button
                type="button"
                className={`intent-toggle-btn ${newIntent ? 'has-intent' : ''}`}
                onClick={() => setShowIntentInput(!showIntentInput)}
              >
                {newIntent ? 'Intent: Active' : '+ Intent'}
              </button>

              {/* Tier Switcher with Vector Icons */}
              <div className="tier-segmented" style={{ padding: '2px' }}>
                <button
                  type="button"
                  className={`tier-tab-btn ${newTier === 'fast' ? 'active' : ''}`}
                  onClick={() => setNewTier('fast')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Fast</span>
                </button>
                <button
                  type="button"
                  className={`tier-tab-btn ${newTier === 'right' ? 'active' : ''}`}
                  onClick={() => setNewTier('right')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                  </svg>
                  <span>Right</span>
                </button>
              </div>

              <button type="submit" className="results-submit-btn">
                Search
              </button>
            </form>

            <a
              href="/models"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--muted-foreground)',
                flexShrink: 0,
                transition: 'color 0.15s',
              }}
              title="View all models and OpenRouter ratings"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              <span>Models</span>
            </a>
          </div>

          {/* Cleanly Aligned Intent Row */}
          {(showIntentInput || (newIntent && newIntent.length > 0)) && (
            <div className="results-intent-aligned-row">
              <input
                type="text"
                className="results-intent-input-box"
                placeholder="Intent / constraints context (e.g. lightweight code, specific libraries, benchmarks)..."
                value={newIntent}
                onChange={(e) => setNewIntent(e.target.value)}
              />
            </div>
          )}
        </div>
      </header>

      {/* Main Results Grid */}
      <div className="results-layout">
        {/* Left: Pipeline Stepper (Clickable to Audit) */}
        <aside>
          <div className="pipeline-rail">
            <div className="pipeline-rail-title">Pipeline Progress</div>

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
                <button
                  key={key}
                  type="button"
                  className={`rail-stage-item ${isSelected ? 'selected' : ''} ${isActive ? 'active-live' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : isActive ? (
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#0284c7' }} />
                    ) : (
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#d4d4d8' }} />
                    )}
                    <span>{label}</span>
                  </div>

                  {state?.count !== undefined && (
                    <span className="stage-badge-count">{state.count}</span>
                  )}
                </button>
              );
            })}

            <div className="rail-divider" />

            <button
              type="button"
              className={`rail-stage-item ${activeTab === '5_result' ? 'selected' : ''}`}
              onClick={() => setActiveTab('5_result')}
              style={{ fontWeight: 600 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <span>5. Ranked Results</span>
              </div>
              <span className="stage-badge-count" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                {results.length}
              </span>
            </button>
          </div>
        </aside>

        {/* Right Main Content View */}
        <main>
          {/* Real-time Deliberation Terminal */}
          {(searchStatus === 'running' || searchStatus === 'provisional' || (audit.deliberation_log && audit.deliberation_log.length > 0)) && (
            <div className="delib-card">
              <div className="delib-card-head">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={`delib-pulse-dot`} style={{ background: searchStatus === 'final' ? '#22c55e' : '#38bdf8' }} />
                  <span>Pipeline Deliberation Log</span>
                </div>
                <span>{searchStatus === 'final' ? 'Completed' : 'Running...'}</span>
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

          {/* ========================================================================= */}
          {/* TAB 5: RANKED RESULTS (Default View) */}
          {/* ========================================================================= */}
          {activeTab === '5_result' && (
            <div>
              {/* Header Info */}
              <div className="results-header-info">
                <h1 className="results-query-title">{query}</h1>
                {intent && <div className="results-intent-text">Intent: {intent}</div>}
                {interpretation && (
                  <div style={{ fontSize: '13px', color: '#0284c7', marginTop: '2px' }}>
                    › Interpretation: {interpretation}
                  </div>
                )}

                <div className="results-meta-bar">
                  <span className="meta-chip">{results.length} results</span>
                  {elapsedMs > 0 && <span className="meta-chip">{(elapsedMs / 1000).toFixed(1)}s</span>}
                  <span className="meta-chip">Model: {modelId || 'Llama 3.1 8B'}</span>
                  <span className="meta-chip">Tier: {tier.toUpperCase()}</span>
                </div>
              </div>

              {/* Provisional Warning if LLM reranking is still active */}
              {searchStatus === 'provisional' && (
                <div style={{
                  background: '#fefce8',
                  border: '1px solid #fef08a',
                  borderRadius: 'var(--radius-lg)',
                  padding: '10px 14px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#854d0e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Provisional results shown — listwise LLM reranking in progress...</span>
                </div>
              )}

              {/* Results Cards List */}
              <div>
                {results.map((r, index) => {
                  const isPromoted = r.provenance.rank_delta > 0;
                  const deltaText = isPromoted
                    ? `+${r.provenance.rank_delta}`
                    : r.provenance.rank_delta === 0 ? `·` : `${r.provenance.rank_delta}`;

                  return (
                    <article key={r.url} className="result-card-shadcn">
                      {/* Rank Chip */}
                      <div className={`rank-badge-clean ${isPromoted ? 'promoted' : ''}`} title={`Original rank delta: ${deltaText}`}>
                        <span>#{index + 1}</span>
                        {r.provenance.rank_delta !== 0 && (
                          <span style={{ fontSize: '10px', opacity: 0.8 }}>{deltaText}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="result-card-content">
                        <div className="result-domain-row">
                          <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{r.domain}</span>
                          <span>·</span>
                          <span>{r.provenance.providers.join(', ')}</span>
                          {r.provenance.was_read && (
                            <span style={{
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #bbf7d0',
                              borderRadius: 'var(--radius-sm)',
                              padding: '1px 5px',
                              fontSize: '10px',
                              fontWeight: 600,
                            }}>
                              PAGE READ
                            </span>
                          )}
                        </div>

                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="result-title-link">
                          <span>{r.title}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>

                        <p className="result-snippet-text">{r.snippet}</p>

                        {r.rationale && (
                          <div className="result-rationale-box">
                            <strong>AI Rationale:</strong> {r.rationale}
                          </div>
                        )}
                      </div>

                      {/* Score Tag */}
                      <div className="result-score-tag" title="Relevance Score">
                        {r.score}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Collapsible Chaff */}
              {chaff.length > 0 && (
                <div className="chaff-collapse-card">
                  <button
                    type="button"
                    className="chaff-collapse-btn"
                    onClick={() => setShowChaff(!showChaff)}
                  >
                    <span>{showChaff ? '▾' : '▸'} {chaff.length} Dropped Candidates (Chaff)</span>
                    <span style={{ fontSize: '11px' }}>Filtered during Prefilter / Retrieval</span>
                  </button>

                  {showChaff && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {chaff.map((c) => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>[{c.domain}]</span> {c.title}
                          </div>
                          <span style={{
                            background: '#fee2e2',
                            color: '#991b1b',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '10px',
                            fontWeight: 600,
                          }}>
                            {c.drop_reason || 'dropped'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 0: PLAN AUDIT */}
          {/* ========================================================================= */}
          {activeTab === '0_plan' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 0: Query Planner Audit</div>
                <span className="meta-chip">Intent Decomposition</span>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Formulated Queries:</strong>
                <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px', color: '#3f3f46' }}>
                  {audit.plan?.queries?.map((q, idx) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>
                      {idx === 0 ? `(Original) "${q}"` : `(Expanded Subquery) "${q}"`}
                    </li>
                  )) || <li>Verbatim query used</li>}
                </ul>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Planner Interpretation:</strong>
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#0284c7' }}>
                  {audit.plan?.interpretation || 'Standard verbatim search.'}
                </div>
              </div>

              {audit.plan?.system_prompt && (
                <div>
                  <strong style={{ fontSize: '13px' }}>Planner System Prompt:</strong>
                  <pre className="code-pre-box">{audit.plan.system_prompt}</pre>
                </div>
              )}

              {audit.plan?.raw_response && (
                <div style={{ marginTop: '16px' }}>
                  <strong style={{ fontSize: '13px' }}>Raw Planner LLM Output:</strong>
                  <pre className="code-pre-box">{audit.plan.raw_response}</pre>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 1: RETRIEVE AUDIT */}
          {/* ========================================================================= */}
          {activeTab === '1_retrieve' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 1: Multi-Provider Retrieve & Fusion</div>
                <span className="meta-chip">Parallel Fanout & RRF</span>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Provider Breakdown:</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', marginTop: '10px' }}>
                  {audit.retrieve?.provider_hits?.map((p, idx) => (
                    <div key={idx} style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px' }}>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{p.provider.toUpperCase()}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '4px' }}>
                        Query: <em>"{p.query}"</em>
                      </div>
                      <div style={{ fontSize: '11px', color: '#52525b', marginTop: '6px' }}>
                        Hits: {p.count} · Latency: {p.elapsed_ms}ms
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {audit.retrieve?.dedupe_stats && (
                <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px' }}>
                  <strong>Deduplication Stats:</strong> Raw hits: {audit.retrieve.dedupe_stats.raw} · Unique URLs: {audit.retrieve.dedupe_stats.unique} · Near-Duplicates Collapsed: {audit.retrieve.dedupe_stats.near_dupes} (RRF k=60)
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: PREFILTER AUDIT */}
          {/* ========================================================================= */}
          {activeTab === '2_prefilter' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 2: Embedding Prefilter & Cosine Similarity</div>
                <span className="meta-chip">Denser Semantic Gate</span>
              </div>

              <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', marginBottom: '16px' }}>
                Kept: {audit.prefilter?.kept_count} · Dropped: {audit.prefilter?.dropped_count} · Blocklist Drops: {audit.prefilter?.drops_by_blocklist}
              </div>

              <strong style={{ fontSize: '13px' }}>Candidate Evaluations:</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                {audit.prefilter?.evaluations?.map((ev, idx) => (
                  <div key={idx} style={{ background: '#ffffff', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>[{ev.domain}]</span> {ev.title.slice(0, 60)}
                    </div>
                    <div>
                      Cosine: {(ev.prefilter_score || 0).toFixed(3)} · <strong style={{ color: ev.action.includes('Drop') ? '#ef4444' : '#16a34a' }}>{ev.action}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: FETCH AUDIT */}
          {/* ========================================================================= */}
          {activeTab === '3_fetch' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 3: Full-Page Fetch & Readability Extraction</div>
                <span className="meta-chip">DOM Parsing & SSRF Safe</span>
              </div>

              <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', marginBottom: '16px' }}>
                Attempted: {audit.fetch?.attempted || 0} · Succeeded: {audit.fetch?.ok || 0} · Cached: {audit.fetch?.cached || 0} · Failed/Blocked: {audit.fetch?.failed || 0}
              </div>

              <strong style={{ fontSize: '13px' }}>Fetched Web Pages:</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                {audit.fetch?.items?.map((item, idx) => (
                  <div key={idx} style={{ background: '#ffffff', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>[{item.domain}]</span> {item.url.slice(0, 60)}
                    </div>
                    <div>
                      Status: <strong style={{ color: item.status === 'ok' ? '#16a34a' : '#ef4444' }}>{item.status}</strong> · {item.chars} chars extracted
                    </div>
                  </div>
                )) || <div style={{ color: 'var(--muted-foreground)', fontSize: '13px' }}>Fast tier uses snippets directly. Right tier fetches full page content.</div>}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: RERANK AUDIT */}
          {/* ========================================================================= */}
          {activeTab === '4_rerank' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 4: Listwise LLM Reranking & Rationales</div>
                <span className="meta-chip">Model: {modelId || 'Llama 3.1 8B'}</span>
              </div>

              <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', marginBottom: '16px' }}>
                Parse Ladder Used: <strong>{audit.rerank?.parse_ladder_rung || 'Rung 1: Direct JSON'}</strong>
              </div>

              {audit.rerank?.user_prompt && (
                <div>
                  <strong style={{ fontSize: '13px' }}>Candidate XML Context Fed to Model:</strong>
                  <pre className="code-pre-box">{audit.rerank.user_prompt}</pre>
                </div>
              )}

              {audit.rerank?.raw_response && (
                <div style={{ marginTop: '16px' }}>
                  <strong style={{ fontSize: '13px' }}>Raw LLM Model Output:</strong>
                  <pre className="code-pre-box">{audit.rerank.raw_response}</pre>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
