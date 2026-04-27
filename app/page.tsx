import {
  getPilotEndingRows,
  getActiveByPriceRows,
  getLivePilotRows,
  getLastSyncedAt,
  getStats,
  serializeRow,
} from '@/lib/query';
import PilotsEndingThisMonthLoader from '@/app/components/tabs/PilotsEndingThisMonthLoader';
import DashboardShell from '@/app/components/DashboardShell';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const initialTab = searchParams.tab ?? 'pilot-ending';

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currentMonthName = MONTH_NAMES[new Date().getMonth()];

  // Always fetch all DB-backed tabs in parallel — fast (Neon, ~100ms each).
  // PipeDrive KPI counts are NOT fetched here; StatsSection fetches them
  // client-side after the page renders so they don't block any tab.
  // PipeDrive join for Tab 2 is handled by PilotsEndingThisMonthLoader (RSC + Suspense).
  const [pilotRows, priceResult, liveRows, lastSyncedAt, stats] = await Promise.all([
    getPilotEndingRows(),
    getActiveByPriceRows(),
    getLivePilotRows(),
    getLastSyncedAt(),
    getStats(),
  ]);

  const serializedPilot        = pilotRows.map(serializeRow);
  const serializedPrice        = priceResult.rows.map(serializeRow);
  const serializedPriceExcluded = priceResult.excluded.map(serializeRow);
  const serializedLive         = liveRows.map(serializeRow);

  return (
    <DashboardShell
      initialTab={initialTab}
      stats={stats}
      lastSyncedAt={lastSyncedAt?.toISOString() ?? null}
      pilotRows={serializedPilot}
      priceResult={{ rows: serializedPrice, excluded: serializedPriceExcluded }}
      liveRows={serializedLive}
      currentMonthName={currentMonthName}
      pilotsThisMonthContent={
        <Suspense
          fallback={
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Loading from PipeDrive…
            </div>
          }
        >
          <PilotsEndingThisMonthLoader />
        </Suspense>
      }
    />
  );
}
