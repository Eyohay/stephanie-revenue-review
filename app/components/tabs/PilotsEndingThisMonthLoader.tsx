/**
 * Server component that fetches PipeDrive data and passes it to the client
 * component. Wrapped in Suspense in page.tsx so the rest of the page renders
 * immediately while this waits for PipeDrive's API.
 */

import { joinPilotEndingMonth } from '@/lib/joinPipedriveWithNeon';
import { currentMonthNameET } from '@/lib/format';
import PilotsEndingThisMonthTab from './PilotsEndingThisMonthTab';

export default async function PilotsEndingThisMonthLoader() {
  let result;
  try {
    result = await joinPilotEndingMonth();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[PilotsEndingThisMonthLoader] PipeDrive fetch failed:', message);
    return (
      <div
        className="rounded-lg p-6 text-center"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        <div className="text-sm font-medium" style={{ color: '#f87171' }}>
          Failed to load from PipeDrive
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {message}
        </div>
        <a
          href="?tab=pilots-this-month"
          className="mt-3 inline-block text-xs underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          Retry
        </a>
      </div>
    );
  }

  return (
    <PilotsEndingThisMonthTab
      rows={result.rows}
      summary={result.summary}
      monthName={currentMonthNameET()}
    />
  );
}
