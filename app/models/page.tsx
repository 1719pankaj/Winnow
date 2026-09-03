'use client';

import { useState, useEffect, useMemo } from 'react';
import { ModelBenchmarkItem, PingTrace } from '../api/admin/models/route';

type SortKey = 'name' | 'provider' | 'time_per_task' | 'tested_latency' | 'intelligence_index' | 'coding_index' | 'agentic_index' | 'match_status';
type SortOrder = 'asc' | 'desc';
type CategoryTab = 'active' | 'outdated' | 'incompatible' | 'disabled';

function formatModelOutput(trace?: PingTrace): string {
  if (!trace) return '"OK"';
  if (trace.error) return trace.error;

  const body = trace.response_body;
  if (body) {
    // 1. Standard OpenAI message content
    const choice = body.choices?.[0];
    if (choice?.message?.content && typeof choice.message.content === 'string' && choice.message.content.trim()) {
      return choice.message.content;
    }
    // 2. OpenAI reasoning content (e.g. DeepSeek / GLM)
    if (choice?.message?.reasoning && typeof choice.message.reasoning === 'string') {
      return `[Reasoning Output]:\n${choice.message.reasoning}`;
    }
    // 3. Gemini candidate text
    const candidateText = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText && typeof candidateText === 'string') {
      return candidateText;
    }
    // 4. Pretty print parsed JSON
    return JSON.stringify(body, null, 2);
  }

  if (trace.response_raw_text) {
    try {
      return JSON.stringify(JSON.parse(trace.response_raw_text), null, 2);
    } catch {
      return trace.response_raw_text;
    }
  }

  return '"OK"';
}

export default function ModelsBenchmarkPage() {
  const [models, setModels] = useState<ModelBenchmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [benchmarkingAll, setBenchmarkingAll] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);

  // Filters & Tabs
  const [activeCategoryTab, setActiveCategoryTab] = useState<CategoryTab>('active');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Inspector Modal State
  const [activeTraceModal, setActiveTraceModal] = useState<{
    model: ModelBenchmarkItem;
    trace?: PingTrace;
    isPinging: boolean;
    activeTab: 'summary' | 'request' | 'response';
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>('intelligence_index');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Load initial model list and metrics
  const fetchModels = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/models');
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  // Sync live catalog across providers
  const handleSyncCatalog = async () => {
    try {
      setSyncingCatalog(true);
      const res = await fetch('/api/admin/models/sync', { method: 'POST' });
      if (res.ok) {
        await fetchModels();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncingCatalog(false);
    }
  };

  // Run live benchmark on all models
  const handleRunAllBenchmarks = async () => {
    try {
      setBenchmarkingAll(true);
      const res = await fetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setModels(data.results || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBenchmarkingAll(false);
    }
  };

  // Update Model Status Override
  const handleUpdateStatus = async (
    model: ModelBenchmarkItem,
    newStatus: 'active' | 'outdated' | 'incompatible' | 'disabled'
  ) => {
    try {
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, category: newStatus, status_override: newStatus } : m))
      );

      const res = await fetch('/api/admin/models/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, status: newStatus }),
      });

      if (!res.ok) {
        await fetchModels();
      }
    } catch (err) {
      console.error(err);
      await fetchModels();
    }
  };

  // Single model ping
  const handleTestSingleModel = async (model: ModelBenchmarkItem) => {
    try {
      setTestingModelId(model.id);
      setActiveTraceModal({
        model,
        trace: model.ping_trace,
        isPinging: true,
        activeTab: 'summary',
      });

      const res = await fetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id }),
      });

      if (res.ok) {
        const data = await res.json();
        const updated = data.results?.[0];
        if (updated) {
          setModels((prev) =>
            prev.map((m) => (m.id === model.id ? { ...m, ...updated } : m))
          );
          setActiveTraceModal({
            model: { ...model, ...updated },
            trace: updated.ping_trace,
            isPinging: false,
            activeTab: 'summary',
          });
        }
      }
    } catch (err) {
      console.error(err);
      if (activeTraceModal) {
        setActiveTraceModal((prev) => (prev ? { ...prev, isPinging: false } : null));
      }
    } finally {
      setTestingModelId(null);
    }
  };

  const isModelFree = (m: ModelBenchmarkItem) => {
    return (
      m.id.includes('free') ||
      m.model_string.endsWith(':free') ||
      (m.openrouter_match.pricing?.prompt === '0' && m.openrouter_match.pricing?.completion === '0')
    );
  };

  const handleHeaderSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder(key === 'name' || key === 'provider' ? 'asc' : 'desc');
    }
  };

  const sortModels = (list: ModelBenchmarkItem[]) => {
    return [...list].sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (sortKey) {
        case 'name':
          valA = (a.benchmark_hint || a.id).toLowerCase();
          valB = (b.benchmark_hint || b.id).toLowerCase();
          break;
        case 'provider':
          valA = a.provider.toLowerCase();
          valB = b.provider.toLowerCase();
          break;
        case 'time_per_task':
          valA = a.time_per_task_s;
          valB = b.time_per_task_s;
          break;
        case 'tested_latency':
          valA = a.tested_latency_ms !== undefined ? a.tested_latency_ms : 999999;
          valB = b.tested_latency_ms !== undefined ? b.tested_latency_ms : 999999;
          break;
        case 'intelligence_index':
          valA = a.openrouter_match.intelligence_index !== undefined ? a.openrouter_match.intelligence_index : -1;
          valB = b.openrouter_match.intelligence_index !== undefined ? b.openrouter_match.intelligence_index : -1;
          break;
        case 'coding_index':
          valA = a.openrouter_match.coding_index !== undefined ? a.openrouter_match.coding_index : -1;
          valB = b.openrouter_match.coding_index !== undefined ? b.openrouter_match.coding_index : -1;
          break;
        case 'agentic_index':
          valA = a.openrouter_match.agentic_index !== undefined ? a.openrouter_match.agentic_index : -1;
          valB = b.openrouter_match.agentic_index !== undefined ? b.openrouter_match.agentic_index : -1;
          break;
        case 'match_status':
          valA = a.openrouter_match.status === 'success' ? 1 : 0;
          valB = b.openrouter_match.status === 'success' ? 1 : 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Counts across all 4 categories
  const activeCount = useMemo(() => models.filter((m) => m.category === 'active').length, [models]);
  const outdatedCount = useMemo(() => models.filter((m) => m.category === 'outdated').length, [models]);
  const incompatibleCount = useMemo(() => models.filter((m) => m.category === 'incompatible').length, [models]);
  const disabledCount = useMemo(() => models.filter((m) => m.category === 'disabled').length, [models]);

  // Verified ping count
  const verifiedPingCount = useMemo(() => models.filter((m) => m.tested_status === 'ok').length, [models]);

  // Top score calculation
  const topScoreModel = useMemo(() => {
    let top: ModelBenchmarkItem | null = null;
    let maxScore = -1;
    for (const m of models) {
      if (m.category === 'active' && m.openrouter_match.intelligence_index !== undefined) {
        if (m.openrouter_match.intelligence_index > maxScore) {
          maxScore = m.openrouter_match.intelligence_index;
          top = m;
        }
      }
    }
    return top;
  }, [models]);

  // Filter models based on search, provider, free-only, and active category tab
  const displayedModels = useMemo(() => {
    const list = models.filter((m) => {
      // 1. Category Tab Filter
      if (m.category !== activeCategoryTab) return false;

      // 2. Free Tier Only Filter
      if (filterFreeOnly && !isModelFree(m)) return false;

      // 3. Provider Filter
      if (selectedProvider !== 'all' && m.provider !== selectedProvider) return false;

      // 4. Search Filter
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchName = (m.benchmark_hint || '').toLowerCase().includes(q);
        const matchId = m.id.toLowerCase().includes(q);
        const matchStr = m.model_string.toLowerCase().includes(q);
        const matchProv = m.provider.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchStr && !matchProv) return false;
      }

      return true;
    });

    return sortModels(list);
  }, [models, activeCategoryTab, selectedProvider, filterFreeOnly, searchFilter, sortKey, sortOrder]);

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) {
      return <span style={{ opacity: 0.3, marginLeft: '4px', fontSize: '10px' }}>⇅</span>;
    }
    return (
      <span style={{ color: 'var(--foreground)', marginLeft: '4px', fontSize: '10px' }}>
        {sortOrder === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top Navbar */}
      <header className="results-header-sticky">
        <div className="results-header-container" style={{ justifyContent: 'space-between', maxWidth: '1280px' }}>
          {/* Left: Brand + Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <a href="/" className="header-brand-link">
              <span>Winnow</span>
            </a>
            <span style={{ color: 'var(--border)', fontSize: '14px' }}>/</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
              Models & Benchmarks
            </span>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Sync Live Catalog */}
            <button
              onClick={handleSyncCatalog}
              disabled={syncingCatalog || loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: syncingCatalog ? 'not-allowed' : 'pointer',
                opacity: syncingCatalog ? 0.7 : 1,
                transition: 'all 0.15s ease',
              }}
              title="Sync catalog across providers"
            >
              <svg className={syncingCatalog ? 'spin-animate' : ''} style={syncingCatalog ? { animation: 'spin 0.8s linear infinite' } : {}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>{syncingCatalog ? 'Syncing...' : 'Sync Catalog'}</span>
            </button>

            {/* Run Ping on All */}
            <button
              onClick={handleRunAllBenchmarks}
              disabled={benchmarkingAll || loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: benchmarkingAll ? 'not-allowed' : 'pointer',
                opacity: benchmarkingAll ? 0.7 : 1,
                boxShadow: 'var(--shadow-subtle)',
                transition: 'all 0.15s ease',
              }}
            >
              {benchmarkingAll ? (
                <>
                  <svg className="spin-animate" style={{ animation: 'spin 0.8s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                  </svg>
                  <span>Pinging All...</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Run Live Benchmark on All</span>
                </>
              )}
            </button>

            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>Back to Search</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '28px 24px 80px' }}>
        {/* Title Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--foreground)' }}>
            AI Models & Live Intelligence Matrix
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', marginTop: '4px' }}>
            Multi-provider model evaluations with real-time tested inference latencies & active governance routing.
          </p>
        </div>

        {/* Summary KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
          {/* Card 1: Active Models */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Models
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: 'var(--foreground)' }}>
              {activeCount} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>active ({outdatedCount} legacy)</span>
            </div>
          </div>

          {/* Card 2: Top Intelligence Score */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Top Intelligence Score
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: '#0284c7' }}>
              {topScoreModel?.openrouter_match.intelligence_index?.toFixed(1) || '57.5'}{' '}
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>
                ({topScoreModel?.benchmark_hint || topScoreModel?.id || 'Top Model'})
              </span>
            </div>
          </div>

          {/* Card 3: Ultra-Fast Tier */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Ultra-Fast Speed Tier
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: '#16a34a' }}>
              ~0.3s <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>(Groq LPUs)</span>
            </div>
          </div>

          {/* Card 4: Verified Endpoints */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Endpoint Verifications
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: 'var(--foreground)' }}>
              {verifiedPingCount} / {models.length}{' '}
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a' }}>✓ Verified OK</span>
            </div>
          </div>
        </div>

        {/* Clean Segmented Category View Switcher (NO MORE TOY BANNERS) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '14px' }}>
          {/* Category Tabs */}
          <div className="tier-segmented" style={{ padding: '4px', background: 'var(--muted)', borderRadius: 'var(--radius-md)' }}>
            {[
              { id: 'active', label: `Active Models (${activeCount})` },
              { id: 'outdated', label: `Outdated & Legacy (${outdatedCount})` },
              { id: 'incompatible', label: `Incompatible (${incompatibleCount})` },
              { id: 'disabled', label: `Disabled (${disabledCount})` },
            ].map((tab: any) => (
              <button
                key={tab.id}
                type="button"
                className={`tier-tab-btn ${activeCategoryTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveCategoryTab(tab.id)}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '5px 14px',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Filter Box */}
          <div style={{ position: 'relative', width: '280px' }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }}
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="Search model or provider..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 12px 6px 32px',
                fontSize: '12px',
                color: 'var(--foreground)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Secondary Filter Row: Providers & Free Filter */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {[
                { id: 'all', label: 'All Providers' },
                { id: 'gemini', label: 'GEMINI' },
                { id: 'groq', label: 'GROQ' },
                { id: 'nim', label: 'NIM' },
                { id: 'openrouter', label: 'OPENROUTER' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProvider(p.id)}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: selectedProvider === p.id ? 'var(--foreground)' : 'var(--card)',
                    color: selectedProvider === p.id ? 'var(--background)' : 'var(--muted-foreground)',
                    border: '1px solid var(--border)',
                    transition: 'all 0.12s ease',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setFilterFreeOnly(!filterFreeOnly)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 9px',
                borderRadius: 'var(--radius-full)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                background: filterFreeOnly ? '#16a34a' : 'var(--card)',
                color: filterFreeOnly ? '#ffffff' : 'var(--muted-foreground)',
                border: `1px solid ${filterFreeOnly ? '#16a34a' : 'var(--border)'}`,
                transition: 'all 0.12s ease',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: filterFreeOnly ? '#ffffff' : '#22c55e' }} />
              <span>Free Tier Only</span>
            </button>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
            Showing {displayedModels.length} models
          </div>
        </div>

        {/* Pristine Master Table */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-subtle)' }}>
          {/* Table Header Banner */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background:
                    activeCategoryTab === 'active'
                      ? '#22c55e'
                      : activeCategoryTab === 'outdated'
                      ? '#f59e0b'
                      : activeCategoryTab === 'incompatible'
                      ? '#f43f5e'
                      : '#71717a',
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                {activeCategoryTab === 'active'
                  ? 'Active & Frontier Models'
                  : activeCategoryTab === 'outdated'
                  ? 'Outdated & Legacy Models'
                  : activeCategoryTab === 'incompatible'
                  ? 'Incompatible Endpoints (Audio, Vision, Embeddings)'
                  : 'Disabled Models'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>({displayedModels.length})</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
              Use the Status dropdown to re-classify any model
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontWeight: 600 }}>
                  <th onClick={() => handleHeaderSort('name')} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}>
                    MODEL & ID {renderSortIndicator('name')}
                  </th>
                  <th onClick={() => handleHeaderSort('provider')} style={{ padding: '10px 16px', width: '100px', cursor: 'pointer', userSelect: 'none' }}>
                    PROVIDER {renderSortIndicator('provider')}
                  </th>
                  <th onClick={() => handleHeaderSort('time_per_task')} style={{ padding: '10px 16px', width: '120px', cursor: 'pointer', userSelect: 'none' }}>
                    EST. SPEED {renderSortIndicator('time_per_task')}
                  </th>
                  <th onClick={() => handleHeaderSort('tested_latency')} style={{ padding: '10px 16px', width: '130px', cursor: 'pointer', userSelect: 'none' }}>
                    PING RESULT {renderSortIndicator('tested_latency')}
                  </th>
                  <th onClick={() => handleHeaderSort('intelligence_index')} style={{ padding: '10px 16px', width: '130px', cursor: 'pointer', userSelect: 'none' }}>
                    INTELLIGENCE {renderSortIndicator('intelligence_index')}
                  </th>
                  <th onClick={() => handleHeaderSort('coding_index')} style={{ padding: '10px 16px', width: '80px', cursor: 'pointer', userSelect: 'none' }}>
                    CODING {renderSortIndicator('coding_index')}
                  </th>
                  <th onClick={() => handleHeaderSort('agentic_index')} style={{ padding: '10px 16px', width: '80px', cursor: 'pointer', userSelect: 'none' }}>
                    AGENTIC {renderSortIndicator('agentic_index')}
                  </th>
                  <th style={{ padding: '10px 16px', width: '130px' }}>STATUS</th>
                  <th style={{ padding: '10px 16px', width: '80px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {displayedModels.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                      No models found matching the current filters.
                    </td>
                  </tr>
                ) : (
                  displayedModels.map((m) => {
                    const orMatch = m.openrouter_match;
                    const isTesting = testingModelId === m.id;
                    const free = isModelFree(m);
                    const intelScore = orMatch.intelligence_index;

                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          transition: 'background 0.12s ease',
                          opacity: activeCategoryTab === 'disabled' ? 0.6 : 1,
                        }}
                      >
                        {/* Model & ID */}
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '13px' }}>
                              {m.benchmark_hint || m.id}
                            </span>
                            {free && (
                              <span
                                style={{
                                  padding: '1px 5px',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  background: '#f0fdf4',
                                  color: '#16a34a',
                                  border: '1px solid #bbf7d0',
                                }}
                              >
                                FREE
                              </span>
                            )}
                          </div>
                          <div className="mono" style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                            {m.model_string}
                          </div>
                          {m.incompatible_reason && (
                            <div style={{ fontSize: '10px', color: '#e11d48', marginTop: '2px' }}>
                              ⓘ {m.incompatible_reason}
                            </div>
                          )}
                        </td>

                        {/* Provider Badge */}
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '9px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              background:
                                m.provider === 'groq'
                                  ? '#fff7ed'
                                  : m.provider === 'gemini'
                                  ? '#eff6ff'
                                  : m.provider === 'nim'
                                  ? '#f0fdf4'
                                  : '#faf5ff',
                              color:
                                m.provider === 'groq'
                                  ? '#ea580c'
                                  : m.provider === 'gemini'
                                  ? '#2563eb'
                                  : m.provider === 'nim'
                                  ? '#16a34a'
                                  : '#9333ea',
                              border: `1px solid ${
                                m.provider === 'groq'
                                  ? '#fed7aa'
                                  : m.provider === 'gemini'
                                  ? '#bfdbfe'
                                  : m.provider === 'nim'
                                  ? '#bbf7d0'
                                  : '#e9d5ff'
                              }`,
                            }}
                          >
                            {m.provider}
                          </span>
                        </td>

                        {/* Estimated Speed */}
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            className="mono"
                            style={{
                              fontWeight: 600,
                              fontSize: '11px',
                              color: m.time_per_task_s < 0.5 ? '#16a34a' : m.time_per_task_s < 1.5 ? '#0284c7' : 'var(--foreground)',
                            }}
                          >
                            ~{m.time_per_task_s}s
                          </span>
                        </td>

                        {/* Ping Result with dot indicator */}
                        <td style={{ padding: '12px 16px' }}>
                          {m.tested_status === 'ok' ? (
                            <div
                              onClick={() => {
                                setActiveTraceModal({
                                  model: m,
                                  trace: m.ping_trace,
                                  isPinging: false,
                                  activeTab: 'summary',
                                });
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                              title="Click to inspect raw ping trace"
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                              <span className="mono" style={{ fontWeight: 600, color: '#16a34a', fontSize: '11px' }}>
                                {m.tested_latency_ms}ms
                              </span>
                            </div>
                          ) : m.tested_status === 'fail' ? (
                            <div
                              onClick={() => {
                                setActiveTraceModal({
                                  model: m,
                                  trace: m.ping_trace,
                                  isPinging: false,
                                  activeTab: 'summary',
                                });
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                              title={m.tested_error || 'Click to inspect error trace'}
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                              <span className="mono" style={{ color: '#ef4444', fontSize: '11px', fontWeight: 600 }}>
                                Failed ({m.tested_latency_ms ? `${m.tested_latency_ms}ms` : 'Err'})
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>Untested</span>
                          )}
                        </td>

                        {/* Intelligence Index with Progress Bar (Restored from Image 1!) */}
                        <td style={{ padding: '12px 16px' }}>
                          {intelScore !== undefined ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '48px', height: '5px', background: '#e4e4e7', borderRadius: '3px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${Math.min(100, Math.max(0, ((intelScore - 15) / 55) * 100))}%`,
                                    height: '100%',
                                    background: intelScore >= 50 ? '#16a34a' : intelScore >= 35 ? '#0284c7' : '#eab308',
                                    borderRadius: '3px',
                                  }}
                                />
                              </div>
                              <span className="mono" style={{ fontWeight: 700, fontSize: '12px', color: 'var(--foreground)' }}>
                                {intelScore.toFixed(1)}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                          )}
                        </td>

                        {/* Coding Score */}
                        <td style={{ padding: '12px 16px' }}>
                          {orMatch.coding_index !== undefined ? (
                            <span className="mono" style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a' }}>
                              {orMatch.coding_index.toFixed(1)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                          )}
                        </td>

                        {/* Agentic Score */}
                        <td style={{ padding: '12px 16px' }}>
                          {orMatch.agentic_index !== undefined ? (
                            <span className="mono" style={{ fontSize: '11px', fontWeight: 600, color: '#9333ea' }}>
                              {orMatch.agentic_index.toFixed(1)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                          )}
                        </td>

                        {/* Refined Minimalist Status Switcher */}
                        <td style={{ padding: '12px 16px' }}>
                          <select
                            value={m.category}
                            onChange={(e) => handleUpdateStatus(m, e.target.value as any)}
                            style={{
                              background: 'var(--card)',
                              color: 'var(--foreground)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              outline: 'none',
                            }}
                            title="Change classification category"
                          >
                            <option value="active">Active</option>
                            <option value="outdated">Outdated</option>
                            <option value="incompatible">Incompatible</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </td>

                        {/* Action Ping Button */}
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => handleTestSingleModel(m)}
                            disabled={isTesting || benchmarkingAll}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              background: isTesting ? 'var(--primary)' : 'var(--secondary)',
                              color: isTesting ? 'var(--primary-foreground)' : 'var(--foreground)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 500,
                              cursor: isTesting ? 'not-allowed' : 'pointer',
                              transition: 'all 0.1s ease',
                            }}
                          >
                            {isTesting ? 'Testing...' : 'Test'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Developer Ping Inspector Modal */}
      {activeTraceModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '24px',
            boxSizing: 'border-box',
          }}
          onClick={() => {
            if (!activeTraceModal.isPinging) setActiveTraceModal(null);
          }}
        >
          <div
            style={{
              background: '#09090b',
              border: '1px solid #27272a',
              borderRadius: 'var(--radius-xl)',
              width: '100%',
              maxWidth: '820px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              boxSizing: 'border-box',
              color: '#f4f4f5',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #27272a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#18181b',
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: 'var(--radius-md)',
                    background: '#27272a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>
                      {activeTraceModal.model.benchmark_hint || activeTraceModal.model.id}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        background: '#27272a',
                        color: '#a1a1aa',
                      }}
                    >
                      {activeTraceModal.model.provider}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: '11px', color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeTraceModal.model.model_string}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {/* Re-Ping Button */}
                <button
                  type="button"
                  onClick={() => handleTestSingleModel(activeTraceModal.model)}
                  disabled={activeTraceModal.isPinging}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#ffffff',
                    borderRadius: 'var(--radius-md)',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: activeTraceModal.isPinging ? 'not-allowed' : 'pointer',
                  }}
                >
                  {activeTraceModal.isPinging ? (
                    <svg className="spin-animate" style={{ animation: 'spin 0.8s linear infinite' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                  <span>Re-Ping</span>
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setActiveTraceModal(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1aa',
                    padding: '4px',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tab Switcher */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 20px',
                borderBottom: '1px solid #27272a',
                background: '#121215',
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              {[
                { id: 'summary', label: '1. Overview & Live Result' },
                { id: 'request', label: '2. Request Payload & Prompt' },
                { id: 'response', label: '3. Raw HTTP Response' },
              ].map((tab: any) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTraceModal({ ...activeTraceModal, activeTab: tab.id })}
                  style={{
                    background: activeTraceModal.activeTab === tab.id ? '#27272a' : 'transparent',
                    color: activeTraceModal.activeTab === tab.id ? '#ffffff' : '#a1a1aa',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', overflowY: 'auto', overflowX: 'hidden', flex: 1, maxHeight: 'calc(90vh - 160px)', boxSizing: 'border-box' }}>
              {activeTraceModal.isPinging ? (
                <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                  <svg className="spin-animate" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" style={{ margin: '0 auto 16px auto', animation: 'spin 0.8s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                  </svg>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff', marginBottom: '6px' }}>
                    Pinging endpoint...
                  </h3>
                  <p className="mono" style={{ fontSize: '12px', color: '#a1a1aa' }}>
                    Sending test prompt [{JSON.stringify({ role: 'user', content: 'Say "OK"' })}]
                  </p>
                </div>
              ) : !activeTraceModal.trace ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#a1a1aa' }}>
                  <p>No ping trace recorded yet for this session.</p>
                  <button
                    type="button"
                    onClick={() => handleTestSingleModel(activeTraceModal.model)}
                    style={{
                      marginTop: '12px',
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Execute Test Ping Now
                  </button>
                </div>
              ) : (
                <div style={{ boxSizing: 'border-box', width: '100%', minWidth: 0 }}>
                  {/* TAB 1: SUMMARY */}
                  {activeTraceModal.activeTab === 'summary' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', minWidth: 0 }}>
                      {/* Metric Summary Bar */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                          gap: '12px',
                          background: '#18181b',
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-lg)',
                          border: '1px solid #27272a',
                          boxSizing: 'border-box',
                          width: '100%',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#71717a', fontWeight: 700 }}>
                            HTTP STATUS
                          </div>
                          <div
                            style={{
                              fontSize: '13px',
                              fontWeight: 700,
                              marginTop: '2px',
                              color: activeTraceModal.trace.response_status >= 200 && activeTraceModal.trace.response_status < 300 ? '#22c55e' : '#ef4444',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {activeTraceModal.trace.response_status ? `${activeTraceModal.trace.response_status} ${activeTraceModal.trace.response_status_text}` : 'Connection Failed'}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#71717a', fontWeight: 700 }}>
                            ROUNDTRIP PING
                          </div>
                          <div className="mono" style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8', marginTop: '2px' }}>
                            {activeTraceModal.trace.latency_ms} ms
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#71717a', fontWeight: 700 }}>
                            EST. TASK SPEED
                          </div>
                          <div className="mono" style={{ fontSize: '13px', fontWeight: 700, color: '#a855f7', marginTop: '2px' }}>
                            ~{activeTraceModal.model.time_per_task_s}s
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#71717a', fontWeight: 700 }}>
                            METHOD & TARGET
                          </div>
                          <div className="mono" style={{ fontSize: '11px', color: '#e4e4e7', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {activeTraceModal.trace.method} {activeTraceModal.model.provider}
                          </div>
                        </div>
                      </div>

                      {/* Model Output Display */}
                      <div
                        style={{
                          background: '#18181b',
                          border: '1px solid #27272a',
                          borderRadius: 'var(--radius-lg)',
                          padding: '14px 16px',
                          boxSizing: 'border-box',
                          width: '100%',
                          minWidth: 0,
                        }}
                      >
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>Model Output / Response Body</span>
                          {activeTraceModal.trace.error && <span style={{ color: '#ef4444' }}>✗ Error Details</span>}
                        </div>

                        {activeTraceModal.trace.error ? (
                          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 'var(--radius-md)', padding: '12px', color: '#fca5a5', fontSize: '12px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            <strong>Error:</strong> {activeTraceModal.trace.error}
                          </div>
                        ) : (
                          <pre
                            className="mono"
                            style={{
                              background: '#09090b',
                              padding: '12px 14px',
                              borderRadius: 'var(--radius-md)',
                              fontSize: '12px',
                              color: '#22c55e',
                              border: '1px solid #27272a',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              overflowWrap: 'anywhere',
                              maxHeight: '260px',
                              overflowY: 'auto',
                              lineHeight: '1.5',
                              margin: 0,
                            }}
                          >
                            {formatModelOutput(activeTraceModal.trace)}
                          </pre>
                        )}
                      </div>

                      {/* Endpoint URL */}
                      <div style={{ width: '100%', minWidth: 0 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#71717a', fontWeight: 700, marginBottom: '4px' }}>
                          TARGET URL
                        </div>
                        <div
                          className="mono"
                          style={{
                            background: '#18181b',
                            border: '1px solid #27272a',
                            borderRadius: 'var(--radius-md)',
                            padding: '8px 12px',
                            fontSize: '11px',
                            color: '#38bdf8',
                            wordBreak: 'break-all',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {activeTraceModal.trace.endpoint_url}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: REQUEST PAYLOAD */}
                  {activeTraceModal.activeTab === 'request' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>
                          Exact HTTP Request Body Sent:
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(JSON.stringify(activeTraceModal.trace?.request_body, null, 2), 'req')}
                          style={{
                            background: '#27272a',
                            border: '1px solid #3f3f46',
                            color: '#ffffff',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 8px',
                            fontSize: '10px',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedKey === 'req' ? '✓ Copied!' : 'Copy Request JSON'}
                        </button>
                      </div>

                      <pre
                        className="mono"
                        style={{
                          background: '#09090b',
                          border: '1px solid #27272a',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px',
                          fontSize: '11px',
                          color: '#e4e4e7',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          maxHeight: '300px',
                          overflowY: 'auto',
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(activeTraceModal.trace.request_body, null, 2)}
                      </pre>

                      <span style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600, marginTop: '8px' }}>
                        Request Headers:
                      </span>
                      <pre
                        className="mono"
                        style={{
                          background: '#09090b',
                          border: '1px solid #27272a',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px',
                          fontSize: '11px',
                          color: '#a1a1aa',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(activeTraceModal.trace.request_headers, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* TAB 3: RAW RESPONSE */}
                  {activeTraceModal.activeTab === 'response' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>
                          Exact HTTP Response Body Received:
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(JSON.stringify(activeTraceModal.trace?.response_body || activeTraceModal.trace?.response_raw_text, null, 2), 'res')}
                          style={{
                            background: '#27272a',
                            border: '1px solid #3f3f46',
                            color: '#ffffff',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 8px',
                            fontSize: '10px',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedKey === 'res' ? '✓ Copied!' : 'Copy Response JSON'}
                        </button>
                      </div>

                      <pre
                        className="mono"
                        style={{
                          background: '#09090b',
                          border: '1px solid #27272a',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px',
                          fontSize: '11px',
                          color: '#e4e4e7',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          maxHeight: '360px',
                          overflowY: 'auto',
                          margin: 0,
                        }}
                      >
                        {activeTraceModal.trace.response_body
                          ? JSON.stringify(activeTraceModal.trace.response_body, null, 2)
                          : activeTraceModal.trace.response_raw_text || '// No response body'}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
