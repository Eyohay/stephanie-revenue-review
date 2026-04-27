import {
  getPilotEndingRows,
  getActiveByPriceRows,
  getLivePilotRows,
  getLastSyncedAt,
  getStats,
  serializeRow,
  type ActiveByPriceResult,
} from '@/lib/query';
import PilotEndingTab from '@/app/components/PilotEndingTab';
import ActiveByPriceTab from '@/app/components/ActiveByPriceTab';
import LivePilotTab from '@/app/components/LivePilotTab';
import StatsSection from '@/app/components/StatsSection';
import { formatDateTime, daysAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Tab = 'pilot-ending' | 'active-by-price' | 'live-pilot-status';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = (searchParams.tab as Tab) || 'pilot-ending';

  const emptyPrice = { rows: [], excluded: [] };
  const [pilotRows, priceResult, liveRows, lastSyncedAt, stats] = await Promise.all([
    tab === 'pilot-ending' ? getPilotEndingRows() : Promise.resolve([]),
    tab === 'active-by-price' ? getActiveByPriceRows() : Promise.resolve(emptyPrice),
    tab === 'live-pilot-status' ? getLivePilotRows() : Promise.resolve([]),
    getLastSyncedAt(),
    getStats(),
  ]);

  const serializedPilot = pilotRows.map(serializeRow);
  const serializedPrice = priceResult.rows.map(serializeRow);
  const serializedPriceExcluded = priceResult.excluded.map(serializeRow);
  const serializedLive = liveRows.map(serializeRow);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'pilot-ending', label: `Pilots ending in next 10 days (${stats.pilotsEndingNext10Days})` },
    { key: 'active-by-price', label: 'Active clients by price' },
    { key: 'live-pilot-status', label: 'Live clients (pilot status)' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <header style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              Stephanie Revenue Review
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Live clients — revenue &amp; pilot health
              {lastSyncedAt && (
                <> · last synced {formatDateTime(lastSyncedAt)} ({daysAgo(lastSyncedAt)})</>
              )}
            </p>
          </div>
          <form action="/api/logout" method="post">
            <button
              type="submit"
              className="text-sm hover:text-slate-200"
              style={{ color: 'var(--text-secondary)' }}
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      {/* Stats + Tab bar — same card as header */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <StatsSection stats={stats} />

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-6 flex -mb-px">
          {tabs.map(({ key, label }) => {
            const active = tab === key;
            return (
              <a
                key={key}
                href={`/?tab=${key}`}
                className="px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors"
                style={{
                  borderBottomColor: active ? '#3b82f6' : 'transparent',
                  color: active ? '#3b82f6' : 'var(--text-secondary)',
                }}
              >
                {label}
              </a>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <main className="max-w-7xl mx-auto px-6 py-5">
        <div
          className="rounded-lg overflow-hidden border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="p-4">
            {tab === 'pilot-ending' && <PilotEndingTab rows={serializedPilot} />}
            {tab === 'active-by-price' && <ActiveByPriceTab rows={serializedPrice} excluded={serializedPriceExcluded} />}
            {tab === 'live-pilot-status' && <LivePilotTab rows={serializedLive} />}
          </div>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Read-only view of the shared billing-audit database. Data refreshes hourly.
        </p>
      </main>
    </div>
  );
}
