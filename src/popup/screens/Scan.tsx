import { useState } from 'react';
import { analyzeMessage } from '@core/scan/paste';
import { sampleVerdict, DEMO_FLAGGED_ADDRESSES } from '@core/scan/engine';
import type { MessageVerdict, RiskLevel } from '@core/scan/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { RiskCallout } from '../components/RiskCallout';
import { ScanBadge } from '../components/ScanBadge';
import { truncateAddress } from '@shared/format';

// Paste-to-check scam analyzer + a demo gallery of the pre-sign warning states
// (spec §4.5). Backed by the MOCK engine; raw message text is never persisted.
export function Scan({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<MessageVerdict | null>(null);
  const [checking, setChecking] = useState(false);

  function check() {
    setChecking(true);
    const verdict = analyzeMessage(text);
    // brief delay so it reads as an on-device check
    setTimeout(() => {
      setResult(verdict);
      setChecking(false);
    }, 280);
  }

  function clearAll() {
    setText('');
    setResult(null);
  }

  const flagged = [...DEMO_FLAGGED_ADDRESSES][0];

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-4">
        <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface active:scale-95">
          <Icon name="arrow_back" size={22} />
        </button>
        <span className="text-title-md text-on-surface">Security</span>
        <div className="ml-auto flex items-center gap-1.5 text-on-surface-variant">
          <Icon name="security" filled size={18} className="text-primary-container" />
        </div>
      </header>

      <div className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Paste-to-check */}
        <section className="space-y-3">
          <div>
            <h3 className="text-title-md text-on-surface">Check a message</h3>
            <p className="text-label-md text-on-surface-variant">
              Paste a suspicious DM, offer, or “support” message and Lantern will flag scam patterns.
            </p>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Paste the message here…"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 text-body-md text-on-surface placeholder:text-outline focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
          />

          <div className="flex gap-2">
            <Button fullWidth onClick={check} loading={checking} disabled={!text.trim()} leadingIcon="security">
              Check message
            </Button>
            {(text || result) && (
              <Button variant="secondary" onClick={clearAll}>
                Clear
              </Button>
            )}
          </div>

          {result && (
            <RiskCallout risk={result.risk} reasons={result.reasons} whatToDo={result.whatToDo} />
          )}

          <p className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <Icon name="lock" size={13} /> Your message is analyzed on-device and never stored.
          </p>
        </section>

        <div className="h-px bg-outline-variant/30" />

        {/* Demo gallery — preview the pre-sign warning states */}
        <section className="space-y-3">
          <div>
            <h3 className="text-title-md text-on-surface">Preview pre-sign warnings</h3>
            <p className="text-label-md text-on-surface-variant">
              How Lantern gates the Sign button by risk level (demo).
            </p>
          </div>

          {(['low', 'medium', 'high'] as RiskLevel[]).map((risk) => {
            const v = sampleVerdict(risk);
            return (
              <div key={risk} className="space-y-2">
                <div className="flex items-center gap-2">
                  <ScanBadge risk={risk} latencyMs={v.latencyMs} />
                </div>
                {risk === 'low' ? (
                  <Card>
                    <p className="text-label-md text-on-surface">{v.explanation}</p>
                  </Card>
                ) : (
                  <RiskCallout risk={v.risk} reasons={v.reasons} explanation={v.explanation} />
                )}
              </div>
            );
          })}

          <Card className="space-y-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">Try it live</p>
            <p className="text-label-md text-on-surface">
              Send any amount to this demo-flagged address to trigger the high-risk block:
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(flagged!)}
              className="flex items-center gap-1.5 font-mono text-label-md text-primary hover:text-primary-container"
            >
              {truncateAddress(flagged!, 6, 6)}
              <Icon name="content_copy" size={14} />
            </button>
          </Card>
        </section>
      </div>
    </div>
  );
}
