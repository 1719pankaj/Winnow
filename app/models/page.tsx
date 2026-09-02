'use client';

import { useState, useEffect, useMemo } from 'react';
import { ModelBenchmarkItem } from '../api/admin/models/route';

type SortKey = 'name' | 'provider' | 'tested_latency' | 'intelligence_index' | 'coding_index' | 'agentic_index' | 'match_status';
type SortOrder = 'asc' | 'desc';

export default function ModelsBenchmarkPage() {
  const [models, setModels] = useState<ModelBenchmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [benchmarkingAll, setBenchmarkingAll] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [showOutdated, setShowOutdated] = useState(true);

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>('intelligence_index');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Load initial model list and OpenRouter metrics
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

  // Run benchmark on a single model
  const handleTestSingleModel = async (modelId: string) => {
    try {
      setTestingModelId(modelId);
      const res = await fetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.results?.[0];
        if (updated) {
          setModels((prev) =>
            prev.map((m) => (m.id === modelId ? { ...m, ...updated } : m))
          );
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTestingModelId(null);
    }
  };

  const isModelOutdated = (m: ModelBenchmarkItem) => {
    return m.id.includes('legacy') || (m.benchmark_hint || '').toLowerCase().includes('legacy');
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

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (selectedProvider !== 'all' && m.provider !== selectedProvider) {
        return false;
      }
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
  }, [models, selectedProvider, searchFilter]);

  const activeModels = useMemo(() => {
    return sortModels(filteredModels.filter((m) => !isModelOutdated(m)));
  }, [filteredModels, sortKey, sortOrder]);

  const outdatedModels = useMemo(() => {
    return sortModels(filteredModels.filter((m) => isModelOutdated(m)));
  }, [filteredModels, sortKey, sortOrder]);

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top Navbar */}
      <header className="results-header-sticky">
        <div className="results-header-container" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <a href="/" className="header-brand-link">
              <span>Winnow</span>
            </a>
            <div style={{ height: '16px', width: '1px', background: 'var(--border)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)' }}>
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                OpenRouter Model Ratings & Live Latency Matrix
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleRunAllBenchmarks}
              disabled={benchmarkingAll || loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
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
                  <svg className="spin-animate" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                  </svg>
                  <span>Benchmarking All...</span>
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
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
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Search</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 32px' }}>
        {/* Controls Row: Provider Filter Pills & Search */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          {/* Provider Filter Segmented Pills */}
          <div className="tier-segmented" style={{ padding: '3px', background: 'var(--muted)' }}>
            {[
              { id: 'all', label: 'ALL PROVIDERS' },
              { id: 'cerebras', label: 'CEREBRAS' },
              { id: 'groq', label: 'GROQ' },
              { id: 'gemini', label: 'GEMINI' },
              { id: 'nim', label: 'NIM' },
              { id: 'openrouter', label: 'OPENROUTER' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tier-tab-btn ${selectedProvider === p.id ? 'active' : ''}`}
                onClick={() => setSelectedProvider(p.id)}
                style={{ fontSize: '11px', padding: '4px 10px', textTransform: 'uppercase' }}
              >
                {p.label}
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
              placeholder="Filter models or providers..."
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

        {/* Active / Frontier Models Table */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-subtle)', marginBottom: '32px' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
              <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
                Active & Frontier Models ({activeModels.length})
              </h2>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
              Official OpenRouter API Benchmark Ratings & Live Measured Speeds
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontWeight: 600 }}>
                  <th onClick={() => handleHeaderSort('name')} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}>
                    MODEL & ID {renderSortIndicator('name')}
                  </th>
                  <th onClick={() => handleHeaderSort('provider')} style={{ padding: '10px 16px', width: '110px', cursor: 'pointer', userSelect: 'none' }}>
                    PROVIDER {renderSortIndicator('provider')}
                  </th>
                  <th onClick={() => handleHeaderSort('tested_latency')} style={{ padding: '10px 16px', width: '150px', cursor: 'pointer', userSelect: 'none' }}>
                    LIVE SPEED / TPS {renderSortIndicator('tested_latency')}
                  </th>
                  <th onClick={() => handleHeaderSort('intelligence_index')} style={{ padding: '10px 16px', width: '160px', cursor: 'pointer', userSelect: 'none' }}>
                    INTELLIGENCE {renderSortIndicator('intelligence_index')}
                  </th>
                  <th onClick={() => handleHeaderSort('coding_index')} style={{ padding: '10px 16px', width: '110px', cursor: 'pointer', userSelect: 'none' }}>
                    CODING {renderSortIndicator('coding_index')}
                  </th>
                  <th onClick={() => handleHeaderSort('agentic_index')} style={{ padding: '10px 16px', width: '110px', cursor: 'pointer', userSelect: 'none' }}>
                    AGENTIC {renderSortIndicator('agentic_index')}
                  </th>
                  <th onClick={() => handleHeaderSort('match_status')} style={{ padding: '10px 16px', width: '220px', cursor: 'pointer', userSelect: 'none' }}>
                    OPENROUTER MATCH {renderSortIndicator('match_status')}
                  </th>
                  <th style={{ padding: '10px 16px', width: '90px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {activeModels.map((m) => {
                  const orMatch = m.openrouter_match;
                  const isTesting = testingModelId === m.id;

                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                      {/* Model & ID */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '13px' }}>
                          {m.benchmark_hint || m.id}
                        </div>
                        <div className="mono" style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                          {m.id} <span style={{ opacity: 0.5 }}>({m.model_string})</span>
                        </div>
                      </td>

                      {/* Provider Badge */}
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '10px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background:
                              m.provider === 'cerebras'
                                ? '#fdf2f8'
                                : m.provider === 'groq'
                                ? '#fff7ed'
                                : m.provider === 'gemini'
                                ? '#eff6ff'
                                : m.provider === 'nim'
                                ? '#f0fdf4'
                                : '#faf5ff',
                            color:
                              m.provider === 'cerebras'
                                ? '#db2777'
                                : m.provider === 'groq'
                                ? '#ea580c'
                                : m.provider === 'gemini'
                                ? '#2563eb'
                                : m.provider === 'nim'
                                ? '#16a34a'
                                : '#9333ea',
                            border: `1px solid ${
                              m.provider === 'cerebras'
                                ? '#fbcfe8'
                                : m.provider === 'groq'
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

                      {/* Live Tested Speed */}
                      <td style={{ padding: '12px 16px' }}>
                        {m.tested_status === 'ok' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                            <span className="mono" style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                              {m.tested_latency_ms} ms
                            </span>
                          </div>
                        ) : m.tested_status === 'fail' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
                            <span style={{ color: '#ef4444', fontSize: '11px' }} title={m.tested_error}>
                              Failed
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>Untested</span>
                        )}
                      </td>

                      {/* OpenRouter Intelligence Index */}
                      <td style={{ padding: '12px 16px' }}>
                        {orMatch.intelligence_index !== undefined ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="mono" style={{ fontSize: '13px', fontWeight: 700, color: '#0284c7' }}>
                              {orMatch.intelligence_index.toFixed(1)}
                            </span>
                            <div style={{ width: '50px', height: '5px', background: 'var(--muted)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, (orMatch.intelligence_index / 70) * 100)}%`, height: '100%', background: '#0284c7' }} />
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                        )}
                      </td>

                      {/* Coding Index */}
                      <td style={{ padding: '12px 16px' }}>
                        {orMatch.coding_index !== undefined ? (
                          <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a' }}>
                            {orMatch.coding_index.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                        )}
                      </td>

                      {/* Agentic Index */}
                      <td style={{ padding: '12px 16px' }}>
                        {orMatch.agentic_index !== undefined ? (
                          <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: '#9333ea' }}>
                            {orMatch.agentic_index.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>—</span>
                        )}
                      </td>

                      {/* OpenRouter Matched Model */}
                      <td style={{ padding: '12px 16px' }}>
                        {orMatch.status === 'success' ? (
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground)' }}>
                              ✓ {orMatch.matched_name || orMatch.matched_id}
                            </div>
                            {orMatch.context_length && (
                              <div className="mono" style={{ fontSize: '10px', color: 'var(--muted-foreground)' }}>
                                {(orMatch.context_length / 1000).toFixed(0)}k context
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#ef4444' }}>✗ Not matched</span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleTestSingleModel(m.id)}
                          disabled={isTesting || benchmarkingAll}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 8px',
                            fontSize: '11px',
                            color: 'var(--foreground)',
                            cursor: 'pointer',
                          }}
                        >
                          {isTesting ? '...' : 'Ping'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Collapsible Outdated / Legacy Section */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowOutdated(!showOutdated)}
            style={{
              width: '100%',
              padding: '14px 20px',
              border: 'none',
              borderBottom: showOutdated ? '1px solid var(--border)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--muted)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a1a1aa' }} />
              <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
                Outdated & Legacy Models ({outdatedModels.length})
              </h2>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
              {showOutdated ? 'Hide ▲' : 'Show ▼'}
            </span>
          </button>

          {showOutdated && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontWeight: 600 }}>
                    <th style={{ padding: '10px 16px' }}>MODEL & ID</th>
                    <th style={{ padding: '10px 16px', width: '110px' }}>PROVIDER</th>
                    <th style={{ padding: '10px 16px', width: '150px' }}>LIVE SPEED</th>
                    <th style={{ padding: '10px 16px', width: '160px' }}>INTELLIGENCE</th>
                    <th style={{ padding: '10px 16px', width: '110px' }}>CODING</th>
                    <th style={{ padding: '10px 16px', width: '110px' }}>AGENTIC</th>
                    <th style={{ padding: '10px 16px', width: '220px' }}>OPENROUTER MATCH</th>
                    <th style={{ padding: '10px 16px', width: '90px', textAlign: 'right' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {outdatedModels.map((m) => {
                    const orMatch = m.openrouter_match;
                    const isTesting = testingModelId === m.id;

                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid var(--border)', opacity: 0.8 }}>
                        <td style={{ padding: '10px 16px' }}>
                          <div style={{ fontWeight: 500, color: 'var(--foreground)' }}>{m.benchmark_hint || m.id}</div>
                          <div className="mono" style={{ fontSize: '10px', color: 'var(--muted-foreground)' }}>{m.id}</div>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>
                            {m.provider}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            {m.tested_latency_ms ? `${m.tested_latency_ms} ms` : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: '#71717a' }}>
                            {orMatch.intelligence_index !== undefined ? orMatch.intelligence_index.toFixed(1) : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: '11px', color: '#71717a' }}>
                            {orMatch.coding_index !== undefined ? orMatch.coding_index.toFixed(1) : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: '11px', color: '#71717a' }}>
                            {orMatch.agentic_index !== undefined ? orMatch.agentic_index.toFixed(1) : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            {orMatch.matched_name || orMatch.matched_id || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleTestSingleModel(m.id)}
                            disabled={isTesting || benchmarkingAll}
                            style={{
                              background: 'none',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '2px 6px',
                              fontSize: '10px',
                              color: 'var(--muted-foreground)',
                              cursor: 'pointer',
                            }}
                          >
                            {isTesting ? '...' : 'Ping'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
