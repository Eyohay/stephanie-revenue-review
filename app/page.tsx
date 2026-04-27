import {
  getPilotEndingRows,
  getActiveByPriceRows,
  getLivePilotRows,
  getLastSyncedAt,
  getStats,
  serializeRow,
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

  const [pilotRows, priceRows, liveRows, lastSyncedAt, stats] = await Promise.all([
    tab === 'pilot-ending' ? getPilotEndingRows() : Promise.resolve([]),
    tab === 'active-by-price' ? getActiveByPriceRows() : Promise.resolve([]),
    tab === 'live-pilot-status' ? getLivePilotRows() : Promise.resolve([]),
    getLastSyncedAt(),
    getStats(),
  ]);

  const serializedPilot = pilotRows.map(serializeRow);
  const serializedPrice = priceRows.map(serializeRow);
  const serializedLive = liveRows.map(serializeRow);

  const tabs: { key: Tab; label: string }[] = [
    {
      key: 'pilot-ending',
      label: `Pilots ending in next 10 days (${stats.pilotsEndingNext10Days})`,
    },
    { key: 'active-by-price', label: 'Active clients by price' },
    { key: 'live-pilot-status', label: 'Live clients (pilot status)' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--color-border-tertiary)' }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Stephanie Revenue Review</h1>
            <p className="text-xs text-gray-500">
              Live &amp; pre-launch clients — revenue &amp; pilot health
              {lastSyncedAt && (
                <> · last synced {formatDateTime(lastSyncedAt)} ({daysAgo(lastSyncedAt)})</>
              )}
            </p>
          </div>
          <form action="/api/logout" method="post">
            <button type="submit" className="text-sm text-gray-500 hover:text-gray-900">
              Log out
            </button>
          </form>
        </div>
      </header>

      {/* Stats — always visible above tabs */}
      <div className="bg-white border-b" style={{ borderColor: 'var(--color-border-tertiary)' }}>
        <StatsSection stats={stats} />

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-6 flex gap-0 -mb-px">
          {tabs.map(({ key, label }) => {
            const active = tab === key;
            return (
              <a
                key={key}
                href={`/?tab=${key}`}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-5">
        <div className="bg-white border rounded-lg overflow-hidden" style={{ borderColor: 'var(--color-border-tertiary)' }}>
          <div className="p-4">
            {tab === 'pilot-ending' && <PilotEndingTab rows={serializedPilot} />}
            {tab === 'active-by-price' && <ActiveByPriceTab rows={serializedPrice} />}
            {tab === 'live-pilot-status' && <LivePilotTab rows={serializedLive} />}
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Read-only view of the shared billing-audit database. Data refreshes hourly.
        </p>
      </main>
    </div>
  );
}
