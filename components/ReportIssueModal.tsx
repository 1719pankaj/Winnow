'use client';

import { useState } from 'react';

export interface ClientDiagnostics {
  url: string;
  pathname: string;
  searchId: string | null;
  query?: string;
  intent?: string;
  tier?: string;
  modelId?: string;
  searchStatus?: string;
  errorMessage?: string;
  activeTab?: string;
  resultsCount?: number;
  candidatesCount?: number;
  deliberationLogCount?: number;
  viewport: string;
  screen: string;
  dpr: number;
  colorDepth: number;
  orientation: string;
  network: {
    online: boolean;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  };
  recentErrors: {
    message: string;
    source?: string;
    lineno?: number;
    colno?: number;
    time: string;
  }[];
  timestamp: string;
}

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: string | null;
  screenshotError: string | null;
  onRetakeScreenshot: () => void;
  diagnostics: ClientDiagnostics | null;
  pathname: string;
}

export function ReportIssueModal({
  isOpen,
  onClose,
  screenshot,
  screenshotError,
  onRetakeScreenshot,
  diagnostics,
  pathname,
}: ReportIssueModalProps) {
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdIssue, setCreatedIssue] = useState<{ number: number; url: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isRetryingCapture, setIsRetryingCapture] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setFallbackUrl(null);

    try {
      const res = await fetch('/api/feedback/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          screenshot,
          screenshot_error: screenshotError,
          search_id: diagnostics?.searchId || null,
          query: diagnostics?.query || null,
          pathname,
          client_meta: diagnostics,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCreatedIssue({ number: data.issue_number, url: data.issue_url });
      } else {
        setErrorMessage(data.error || 'Failed to file GitHub issue');
        if (data.fallback_url) setFallbackUrl(data.fallback_url);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error while filing issue');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetake = async () => {
    setIsRetryingCapture(true);
    await onRetakeScreenshot();
    setIsRetryingCapture(false);
  };

  const handleResetAndClose = () => {
    setDescription('');
    setCreatedIssue(null);
    setErrorMessage(null);
    setFallbackUrl(null);
    setIsZoomed(false);
    onClose();
  };

  return (
    <div className="report-modal-backdrop" onClick={handleResetAndClose}>
      <div className="report-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="report-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🐛</span>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                Report an Issue
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>
                Files a detailed issue on GitHub with complete client & pipeline diagnostics
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetAndClose}
            className="report-modal-close-btn"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="report-modal-body">
          {createdIssue ? (
            /* Success State */
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: '42px', marginBottom: '12px' }}>🎉</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#166534', marginBottom: '8px' }}>
                GitHub Issue #{createdIssue.number} Created!
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '24px', lineHeight: 1.5 }}>
                Your feedback, captured screen, and full diagnostic pipeline trace have been submitted directly to the repository.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <a
                  href={createdIssue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="report-submit-btn"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>View Issue on GitHub</span>
                  <span>↗</span>
                </a>
                <button
                  type="button"
                  onClick={handleResetAndClose}
                  className="report-cancel-btn"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Main Form */
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Optional Description */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '6px' }}>
                  Issue Description <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>(Optional)</span>
                </label>
                <textarea
                  className="report-textarea"
                  placeholder="What went wrong or what did you expect to happen? (e.g. 'Stuck connecting', 'Model placed irrelevant site #1', 'UI button misaligned', etc.)"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Screen Capture Status / Preview */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>
                    Screen Capture Preview
                  </span>
                  {screenshot && (
                    <button
                      type="button"
                      onClick={() => setIsZoomed(!isZoomed)}
                      style={{ background: 'none', border: 'none', fontSize: '11px', color: '#0284c7', cursor: 'pointer', fontWeight: 500 }}
                    >
                      {isZoomed ? 'Minimize' : 'Enlarge view'}
                    </button>
                  )}
                </div>

                {screenshot ? (
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      background: '#09090b',
                      maxHeight: isZoomed ? '420px' : '150px',
                      transition: 'max-height 0.2s ease',
                      cursor: 'pointer',
                    }}
                    onClick={() => setIsZoomed(!isZoomed)}
                  >
                    <img
                      src={screenshot}
                      alt="Captured screen"
                      style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }}
                    />
                  </div>
                ) : (
                  <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>ℹ️ Visual screen capture unavailable on this browser/device ({screenshotError || 'canvas restricted'}). Full diagnostic data will still be attached.</span>
                    <button
                      type="button"
                      onClick={handleRetake}
                      disabled={isRetryingCapture}
                      style={{ background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', marginLeft: '8px', whiteSpace: 'nowrap' }}
                    >
                      {isRetryingCapture ? 'Retrying...' : 'Retry Capture'}
                    </button>
                  </div>
                )}
              </div>

              {/* Comprehensive Diagnostic Inclusions */}
              <div style={{ background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '8px' }}>
                  Diagnostics Automatically Attached
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
                  {diagnostics?.query && <span className="report-badge">🔍 Query: &quot;{diagnostics.query.slice(0, 25)}&quot;</span>}
                  {diagnostics?.searchStatus && <span className="report-badge">⚡ Status: {diagnostics.searchStatus}</span>}
                  {diagnostics?.tier && <span className="report-badge">🎯 Tier: {diagnostics.tier.toUpperCase()}</span>}
                  {screenshot && <span className="report-badge">✓ Screen Image</span>}
                  <span className="report-badge">🌐 Net: {diagnostics?.network?.effectiveType || 'online'}</span>
                  <span className="report-badge">📱 {diagnostics?.viewport}</span>
                  {diagnostics?.recentErrors && diagnostics.recentErrors.length > 0 ? (
                    <span className="report-badge" style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fecaca', fontWeight: 600 }}>
                      ⚠️ {diagnostics.recentErrors.length} Client Error{diagnostics.recentErrors.length > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="report-badge">✓ 0 JS Errors</span>
                  )}
                  {diagnostics?.searchId && <span className="report-badge">✓ Trace Steps 0–5</span>}
                </div>

                <div style={{ marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowDataPreview(!showDataPreview)}
                    style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--muted-foreground)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {showDataPreview ? '▾ Hide Raw Diagnostic Payload' : '▸ Inspect Raw Diagnostic Payload'}
                  </button>

                  {showDataPreview && (
                    <pre style={{
                      background: '#09090b',
                      color: '#d4d4d8',
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      marginTop: '8px',
                      maxHeight: '160px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {JSON.stringify(diagnostics, null, 2)}
                    </pre>
                  )}
                </div>
              </div>

              {/* Error Message if any */}
              {errorMessage && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '12px', color: '#991b1b' }}>
                  <strong>Error:</strong> {errorMessage}
                  {fallbackUrl && (
                    <div style={{ marginTop: '6px' }}>
                      <a
                        href={fallbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#0369a1', fontWeight: 600, textDecoration: 'underline' }}
                      >
                        Click here to create issue directly on GitHub ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={handleResetAndClose}
                  className="report-cancel-btn"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="report-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span className="spinner" style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                      Submitting Issue...
                    </span>
                  ) : (
                    'Submit Issue to GitHub'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
