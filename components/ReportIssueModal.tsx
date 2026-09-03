'use client';

import { useState } from 'react';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: string | null;
  searchId: string | null;
  pathname: string;
}

export function ReportIssueModal({
  isOpen,
  onClose,
  screenshot,
  searchId,
  pathname,
}: ReportIssueModalProps) {
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdIssue, setCreatedIssue] = useState<{ number: number; url: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setFallbackUrl(null);

    const clientMeta = {
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      viewport: typeof window !== 'undefined' ? `${window.innerWidth} x ${window.innerHeight}` : '',
      screen: typeof window !== 'undefined' ? `${window.screen.width} x ${window.screen.height}` : '',
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/feedback/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          screenshot,
          search_id: searchId,
          pathname,
          client_meta: clientMeta,
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
                Files a GitHub issue with your current screen & full search pipeline logs
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
                  placeholder="What went wrong or what did you expect to happen? (e.g. 'Rerank model placed irrelevant site #1', 'UI button misaligned on mobile', etc.)"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Screenshot Preview */}
              {screenshot && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>
                      Screen Capture Preview
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsZoomed(!isZoomed)}
                      style={{ background: 'none', border: 'none', fontSize: '11px', color: '#0284c7', cursor: 'pointer', fontWeight: 500 }}
                    >
                      {isZoomed ? 'Minimize' : 'Enlarge view'}
                    </button>
                  </div>
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      background: '#09090b',
                      maxHeight: isZoomed ? '420px' : '160px',
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
                </div>
              )}

              {/* Diagnostic Inclusions */}
              <div style={{ background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '8px' }}>
                  Diagnostic Data Automatically Attached
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
                  <span className="report-badge">✓ Captured Screen</span>
                  {searchId && <span className="report-badge">✓ Pipeline Steps 0–5 Traces</span>}
                  {searchId && <span className="report-badge">✓ Rerank XML Prompt & Output</span>}
                  {searchId && <span className="report-badge">✓ Deliberation Logs</span>}
                  <span className="report-badge">✓ Browser & Screen Info</span>
                </div>

                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowDataPreview(!showDataPreview)}
                    style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--muted-foreground)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {showDataPreview ? '▾ Hide Attached Parameters' : '▸ Inspect Attached Parameters'}
                  </button>

                  {showDataPreview && (
                    <pre style={{
                      background: '#09090b',
                      color: '#d4d4d8',
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      marginTop: '8px',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {JSON.stringify(
                        {
                          search_id: searchId || '(Not on a search results page)',
                          pathname,
                          has_screenshot: Boolean(screenshot),
                          timestamp: new Date().toISOString(),
                        },
                        null,
                        2
                      )}
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
