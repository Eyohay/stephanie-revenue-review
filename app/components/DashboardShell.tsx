'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Stats, type SerializedClientRow, type ClientNotesMap } from '@/lib/query';
import StatsSection from './StatsSection';
import PilotEndingTab from './PilotEndingTab';
import ActiveByPriceTab from './ActiveByPriceTab';
import LivePilotTab from './LivePilotTab';
import PilotVsBillingTab from './tabs/PilotVsBillingTab';
import { formatDateTime, daysAgo } from '@/lib/format';
import { type LabelsByOrgId } from '@/lib/pipedrive/all-labels';

type Tab = 'pilot-ending' | 'pilots-this-month' | 'active-by-price' | 'live-pilot-status' | 'pilot-vs-billing';

// SerializedActiveByPriceResult — same shape but already serialized
type SerializedActiveByPriceResult = {
  rows: SerializedClientRow[];
  excluded: SerializedClientRow[];
};

type Props = {
  initialTab: string;
  stats: Stats;
  lastSyncedAt: string | null;
  pilotRows: SerializedClientRow[];
  priceResult: SerializedActiveByPriceResult;
  liveRows: SerializedClientRow[];
  labelsByOrgId: LabelsByOrgId;
  clientNotes: ClientNotesMap;
  currentMonthName: string;
  pilotsThisMonthContent: React.ReactNode;
};

/**
 * Client shell for the dashboard.
 *
 * All tab data is pre-rendered on the server and passed as props / React nodes.
 * Tab switching flips CSS visibility only — no server round-trip.
 * URL updates via router.replace() to keep links bookmarkable.
 *
 * Tab 2 (pilots-this-month) is passed as a ReactNode so that the underlying
 * RSC + Suspense can stream in while tabs 1/3/4 are already interactive.
 * It renders in a hidden div from first load; by the time the user clicks it,
 * the PipeDrive fetch is usually already resolved.
 */
export default function DashboardShell({
  initialTab,
  stats,
  lastSyncedAt,
  pilotRows,
  priceResult,
  liveRows,
  labelsByOrgId,
  clientNotes,
  currentMonthName,
  pilotsThisMonthContent,
}: Props) {
  const validTabs: Tab[] = ['pilot-ending', 'pilots-this-month', 'active-by-price', 'live-pilot-status', 'pilot-vs-billing'];
  const [tab, setTab] = useState<Tab>(
    validTabs.includes(initialTab as Tab) ? (initialTab as Tab) : 'pilot-ending'
  );
  const router = useRouter();

  function switchTab(key: Tab) {
    setTab(key);
    router.replace(`/?tab=${key}`, { scroll: false });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'pilot-ending',      label: `Pilots ending in next 10 days (${stats.pilotsEndingNext10Days})` },
    { key: 'pilots-this-month', label: `Pilots ending in ${currentMonthName} · PipeDrive` },
    { key: 'active-by-price',   label: 'Active clients by price' },
    { key: 'live-pilot-status', label: 'Live clients (pilot status)' },
    { key: 'pilot-vs-billing',  label: 'Pilot vs Billing' },
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
              Live &amp; exec&apos;d out clients — revenue &amp; pilot health
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

      {/* Stats + Tab bar */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <StatsSection stats={stats} />

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-6 flex -mb-px">
          {tabs.map(({ key, label }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => switchTab(key)}
                className="px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors"
                style={{
                  borderBottomColor: active ? '#3b82f6' : 'transparent',
                  color: active ? '#3b82f6' : 'var(--text-secondary)',
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content — all tabs rendered; inactive tabs hidden via HTML hidden attr */}
      <main className="max-w-7xl mx-auto px-6 py-5">
        <div
          className="rounded-lg overflow-hidden border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="p-4">
            <div hidden={tab !== 'pilot-ending'}>
              <PilotEndingTab rows={pilotRows} labelsByOrgId={labelsByOrgId} />
            </div>
            <div hidden={tab !== 'pilots-this-month'}>
              {pilotsThisMonthContent}
            </div>
            <div hidden={tab !== 'active-by-price'}>
              <ActiveByPriceTab
                rows={priceResult.rows}
                excluded={priceResult.excluded}
                labelsByOrgId={labelsByOrgId}
                clientNotes={clientNotes}
              />
            </div>
            <div hidden={tab !== 'live-pilot-status'}>
              <LivePilotTab rows={liveRows} labelsByOrgId={labelsByOrgId} />
            </div>
            <div hidden={tab !== 'pilot-vs-billing'}>
              <PilotVsBillingTab rows={liveRows} labelsByOrgId={labelsByOrgId} />
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Read-only view of the shared billing-audit database. Data refreshes hourly.
        </p>
      </main>
    </div>
  );
}
