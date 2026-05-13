import {
  getPilotEndingRows,
  getActiveByPriceRows,
  getLivePilotRows,
  getLastSyncedAt,
  getStats,
  getClientNotes,
  serializeRow,
} from '@/lib/query';
import PilotsEndingThisMonthLoader from '@/app/components/tabs/PilotsEndingThisMonthLoader';
import DashboardShell from '@/app/components/DashboardShell';
import { Suspense } from 'react';
import { fetchOrgLabelsForIds, mapToLabelsByOrgId } from '@/lib/pipedrive/all-labels';
import { currentMonthShortET } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const initialTab = searchParams.tab ?? 'pilot-ending';

  // Eastern-time anchored — rolls over at midnight ET, not browser/server local.
  const currentMonthName = currentMonthShortET();

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

  // Pipedrive labels for all active-client orgs (Tabs 1, 3, 4, Pilot vs Billing).
  // Tab 2 carries its own labels via the joined Pipedrive fetch.
  // Errors here must not break the page — fall back to empty map.
  const allOrgIds = Array.from(new Set([
    ...pilotRows.map((r) => r.pipedriveOrgId),
    ...priceResult.rows.map((r) => r.pipedriveOrgId),
    ...priceResult.excluded.map((r) => r.pipedriveOrgId),
    ...liveRows.map((r) => r.pipedriveOrgId),
  ]));
  let labelsByOrgId = {};
  try {
    const map = await fetchOrgLabelsForIds(allOrgIds);
    labelsByOrgId = mapToLabelsByOrgId(map);
  } catch (err) {
    console.error('[DashboardPage] Pipedrive label fetch failed:', err);
  }

  // Tracy's notes for the Active-by-Price tab only.
  const notesIds = priceResult.rows.map((r) => r.id);
  const clientNotes = await getClientNotes(notesIds).catch((err) => {
    console.error('[DashboardPage] getClientNotes failed:', err);
    return {};
  });

  return (
    <DashboardShell
      initialTab={initialTab}
      stats={stats}
      lastSyncedAt={lastSyncedAt?.toISOString() ?? null}
      pilotRows={serializedPilot}
      priceResult={{ rows: serializedPrice, excluded: serializedPriceExcluded }}
      liveRows={serializedLive}
      labelsByOrgId={labelsByOrgId}
      clientNotes={clientNotes}
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
