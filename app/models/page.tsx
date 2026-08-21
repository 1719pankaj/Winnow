'use client';

import { useState, useEffect, useMemo } from 'react';
import { ModelBenchmarkItem } from '../api/admin/models/route';

type SortKey = 'name' | 'provider' | 'tested_latency' | 'livebench_score' | 'match_status';
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
  const [sortKey, setSortKey] = useState<SortKey>('livebench_score');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Load initial model list and LiveBench metrics
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
    return m.id.includes('legacy') || (m.livebench_hint || '').toLowerCase().includes('legacy');
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
      let valA: any = 0;
      let valB: any = 0;

      switch (sortKey) {
        case 'name':
          valA = (a.livebench_hint || a.id).toLowerCase();
          valB = (b.livebench_hint || b.id).toLowerCase();
          return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

        case 'provider':
          valA = a.provider.toLowerCase();
          valB = b.provider.toLowerCase();
          return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

        case 'tested_latency':
          valA = a.tested_latency_ms ?? 999999;
          valB = b.tested_latency_ms ?? 999999;
          break;

        case 'livebench_score':
          valA = a.livebench_match.overall_score ?? 0;
          valB = b.livebench_match.overall_score ?? 0;
          break;

        case 'match_status':
          valA = a.livebench_match.status === 'success' ? 1 : 0;
          valB = b.livebench_match.status === 'success' ? 1 : 0;
          break;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Filtered model list
  const activeModels = useMemo(() => {
    const filtered = models.filter((m) => {
      if (isModelOutdated(m)) return false;
      const matchProvider = selectedProvider === 'all' || m.provider === selectedProvider;
      const matchSearch =
        m.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
        m.model_string.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (m.livebench_match.matched_name || '').toLowerCase().includes(searchFilter.toLowerCase());
      return matchProvider && matchSearch;
    });
    return sortModels(filtered);
  }, [models, selectedProvider, searchFilter, sortKey, sortOrder]);

  const outdatedModels = useMemo(() => {
    const filtered = models.filter((m) => {
      if (!isModelOutdated(m)) return false;
      const matchProvider = selectedProvider === 'all' || m.provider === selectedProvider;
      const matchSearch =
        m.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
        m.model_string.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (m.livebench_match.matched_name || '').toLowerCase().includes(searchFilter.toLowerCase());
      return matchProvider && matchSearch;
    });
    return sortModels(filtered);
  }, [models, selectedProvider, searchFilter, sortKey, sortOrder]);

  const providersList = ['all', ...Array.from(new Set(models.map((m) => m.provider)))];

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) {
      return <span style={{ opacity: 0.35, marginLeft: '4px', fontSize: '10px' }}>⇅</span>;
    }
    return (
      <span style={{ marginLeft: '4px', color: 'var(--foreground)', fontSize: '10px', fontWeight: 700 }}>
        {sortOrder === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const renderModelRow = (m: ModelBenchmarkItem) => {
    const isTesting = testingModelId === m.id;
    const match = m.livebench_match;

    return (
      <tr key={m.id} style={{ borderBottom: '1px solid #f4f4f5', transition: 'background 0.1s' }}>
        {/* Model Name & String */}
        <td style={{ padding: '12px 16px' }}>
          <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>
            {m.livebench_hint || m.id}
          </div>
          <div className="mono" style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
            {m.model_string}
          </div>
        </td>

        {/* Provider */}
        <td style={{ padding: '12px 16px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              background:
                m.provider === 'cerebras'
                  ? '#fef3c7'
                  : m.provider === 'groq'
                  ? '#ffedd5'
                  : m.provider === 'gemini'
                  ? '#e0f2fe'
                  : m.provider === 'nim'
                  ? '#dcfce7'
                  : '#f3e8ff',
              color:
                m.provider === 'cerebras'
                  ? '#92400e'
                  : m.provider === 'groq'
                  ? '#9a3412'
                  : m.provider === 'gemini'
                  ? '#0369a1'
                  : m.provider === 'nim'
                  ? '#166534'
                  : '#6b21a8',
            }}
          >
            {m.provider}
          </span>
        </td>

        {/* Live Tested Latency */}
        <td style={{ padding: '12px 16px' }}>
          {m.tested_status === 'ok' && m.tested_latency_ms !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              <span className="mono" style={{ fontWeight: 600, color: '#16a34a' }}>
                {m.tested_latency_ms}ms
              </span>
            </div>
          ) : m.tested_status === 'fail' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              <span className="mono" style={{ fontSize: '11px', color: '#dc2626' }} title={m.tested_error}>
                Failed ({m.tested_latency_ms ? `${m.tested_latency_ms}ms` : 'Err'})
              </span>
            </div>
          ) : m.tested_status === 'disabled' ? (
            <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>Disabled</span>
          ) : (
            <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>Untested</span>
          )}
        </td>

        {/* LiveBench Overall Score */}
        <td style={{ padding: '12px 16px' }}>
          {match.overall_score !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '56px', height: '6px', background: '#e4e4e7', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${match.overall_score}%`,
                    height: '100%',
                    background: match.overall_score >= 75 ? '#0284c7' : match.overall_score >= 65 ? '#16a34a' : '#eab308',
                    borderRadius: '3px',
                  }}
                />
              </div>
              <span className="mono" style={{ fontWeight: 700, fontSize: '13px', color: match.overall_score >= 75 ? '#0369a1' : 'var(--foreground)' }}>
                {match.overall_score}
              </span>
            </div>
          ) : (
            <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>—</span>
          )}
        </td>

        {/* LiveBench Match */}
        <td style={{ padding: '12px 16px' }}>
          {match.status === 'success' ? (
            <div>
              <span
                style={{
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  display: 'inline-block',
                }}
              >
                ✓ Matched
              </span>
              <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                {match.matched_name}
              </div>
            </div>
          ) : (
            <span
              style={{
                background: '#fee2e2',
                color: '#991b1b',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 600,
                display: 'inline-block',
              }}
            >
              ✗ No Match
            </span>
          )}
        </td>

        {/* Action Button */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <button
            type="button"
            onClick={() => handleTestSingleModel(m.id)}
            disabled={isTesting || benchmarkingAll}
            style={{
              background: 'var(--secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 500,
              color: 'var(--foreground)',
              cursor: 'pointer',
              transition: 'all 0.1s',
            }}
          >
            {isTesting ? 'Testing...' : 'Test'}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top Navbar */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '0 24px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Left: Brand + Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <a href="/" className="brand-link">
              <div className="brand-icon">W</div>
              <span>Winnow</span>
            </a>
            <span style={{ color: '#d4d4d8', fontSize: '14px' }}>/</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
              Models & Benchmarks
            </span>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleRunAllBenchmarks}
              disabled={benchmarkingAll}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              <span>{benchmarkingAll ? 'Benchmarking...' : 'Run Live Benchmark on All'}</span>
            </button>

            <a href="/" className="btn-outline">
              <span>Back to Search</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 24px 80px' }}>
        {/* Title Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--foreground)' }}>
            AI Models & LiveBench Matrix
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', marginTop: '4px' }}>
            Open contamination-free benchmark scores from <a href="https://livebench.ai" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--foreground)', fontWeight: 500 }}>LiveBench (livebench.ai)</a> with real-time tested inference speeds.
          </p>
        </div>

        {/* Summary KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Models
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '2px', color: 'var(--foreground)' }}>
              {activeModels.length} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>active ({outdatedModels.length} legacy)</span>
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Top LiveBench Score
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '2px', color: '#0284c7' }}>
              78.8 <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>(Gemini 3.7 Flash)</span>
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              DeepSeek V4 Pro Score
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '2px', color: '#16a34a' }}>
              77.4 <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)' }}>(0813 release)</span>
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-subtle)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              LiveBench Matches
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '2px', color: 'var(--foreground)' }}>
              {models.filter((m) => m.livebench_match.status === 'success').length} / {models.length}{' '}
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#16a34a' }}>Verified</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar with native segmented controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', marginBottom: '18px', flexWrap: 'wrap' }}>
          {/* Provider Filter Segmented Tabs */}
          <div className="segmented-control">
            {providersList.map((p) => (
              <button
                key={p}
                type="button"
                className={`segmented-btn ${selectedProvider === p ? 'active' : ''}`}
                onClick={() => setSelectedProvider(p)}
                style={{ textTransform: 'capitalize' }}
              >
                {p === 'all' ? 'All Providers' : p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', width: '240px' }}>
            <input
              type="text"
              placeholder="Search model or provider..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '6px 12px',
                fontSize: '12px',
                color: 'var(--foreground)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* SECTION 1: Active & Frontier Models */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingLeft: '2px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>Active & Frontier Models</h2>
            <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>({activeModels.length})</span>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none' }}>
                  <th
                    style={{ padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => handleHeaderSort('name')}
                  >
                    <span>Model & ID</span>
                    {renderSortIndicator('name')}
                  </th>
                  <th
                    style={{ padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => handleHeaderSort('provider')}
                  >
                    <span>Provider</span>
                    {renderSortIndicator('provider')}
                  </th>
                  <th
                    style={{ padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => handleHeaderSort('tested_latency')}
                  >
                    <span>Live Speed</span>
                    {renderSortIndicator('tested_latency')}
                  </th>
                  <th
                    style={{ padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => handleHeaderSort('livebench_score')}
                  >
                    <span>LiveBench Overall Score</span>
                    {renderSortIndicator('livebench_score')}
                  </th>
                  <th
                    style={{ padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => handleHeaderSort('match_status')}
                  >
                    <span>LiveBench Match</span>
                    {renderSortIndicator('match_status')}
                  </th>
                  <th style={{ padding: '10px 16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                      Loading model matrix...
                    </td>
                  </tr>
                ) : activeModels.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                      No active models matching filter.
                    </td>
                  </tr>
                ) : (
                  activeModels.map(renderModelRow)
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 2: Outdated & Legacy Models */}
        {outdatedModels.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingLeft: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
                <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>Outdated & Legacy Models</h2>
                <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>({outdatedModels.length})</span>
              </div>

              <button
                type="button"
                onClick={() => setShowOutdated(!showOutdated)}
                style={{ background: 'none', border: 'none', fontSize: '12px', color: 'var(--muted-foreground)', cursor: 'pointer' }}
              >
                {showOutdated ? 'Hide Legacy Section ▴' : 'Show Legacy Section ▾'}
              </button>
            </div>

            {showOutdated && (
              <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f4f4f5', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none' }}>
                      <th
                        style={{ padding: '10px 16px', cursor: 'pointer' }}
                        onClick={() => handleHeaderSort('name')}
                      >
                        <span>Model & ID</span>
                        {renderSortIndicator('name')}
                      </th>
                      <th
                        style={{ padding: '10px 16px', cursor: 'pointer' }}
                        onClick={() => handleHeaderSort('provider')}
                      >
                        <span>Provider</span>
                        {renderSortIndicator('provider')}
                      </th>
                      <th
                        style={{ padding: '10px 16px', cursor: 'pointer' }}
                        onClick={() => handleHeaderSort('tested_latency')}
                      >
                        <span>Live Speed</span>
                        {renderSortIndicator('tested_latency')}
                      </th>
                      <th
                        style={{ padding: '10px 16px', cursor: 'pointer' }}
                        onClick={() => handleHeaderSort('livebench_score')}
                      >
                        <span>LiveBench Overall Score</span>
                        {renderSortIndicator('livebench_score')}
                      </th>
                      <th
                        style={{ padding: '10px 16px', cursor: 'pointer' }}
                        onClick={() => handleHeaderSort('match_status')}
                      >
                        <span>LiveBench Match</span>
                        {renderSortIndicator('match_status')}
                      </th>
                      <th style={{ padding: '10px 16px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outdatedModels.map(renderModelRow)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
