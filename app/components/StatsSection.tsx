'use client';

import { useEffect, useState } from 'react';
import { type Stats } from '@/lib/query';
import { formatUSD } from '@/lib/format';

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'blue' | 'amber' | 'red';
}) {
  const valueColor =
    accent === 'green'
      ? '#4ade80'
      : accent === 'blue'
      ? '#60a5fa'
      : accent === 'amber'
      ? '#fbbf24'
      : accent === 'red'
      ? '#f87171'
      : 'var(--foreground)';
  const subColor = accent === 'red' ? '#f87171' : 'var(--text-muted)';
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <div
        className="text-[11px] uppercase tracking-wide leading-tight"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-semibold mt-1 tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: subColor }}>
          {sub}
        </div>
      )}
    </div>
  );
}

type PdCounts = { thisMonth: number; nextMonth: number; monthAfterNext: number };
type PdStatus = 'loading' | 'success' | 'error';

/**
 * Renders the KPI header section.
 *
 * The three pilot-month cards are PipeDrive-authoritative. While the
 * /api/pilot-kpi-counts request is in flight the cards show "…"; on
 * failure they show "⚠" with a "PD fetch failed" subtitle. We deliberately
 * do NOT fall back to Neon — Neon's getStats() filters by accountStatus
 * (Live + Executed Out), while PD's filters only exclude Pre-Launch, so
 * the two sources legitimately differ. Silent fallback was hiding fetch
 * failures and rendering stale lower numbers as if they were authoritative.
 */
export default function StatsSection({ stats }: { stats: Stats }) {
  const [pdCounts, setPdCounts] = useState<PdCounts | null>(null);
  const [pdStatus, setPdStatus] = useState<PdStatus>('loading');

  useEffect(() => {
    fetch('/api/pilot-kpi-counts')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: PdCounts) => { setPdCounts(data); setPdStatus('success'); })
      .catch(() => { setPdStatus('error'); });
  }, []);

  const cardValue = (n: number | undefined): string =>
    pdStatus === 'loading' ? '…'
    : pdStatus === 'error' ? '⚠'
    : (n ?? 0).toString();
  const cardSub = (): string | undefined =>
    pdStatus === 'error' ? 'PD fetch failed' : undefined;
  const cardAccent = (n: number | undefined, amberOnNonZero = false): 'amber' | 'red' | undefined => {
    if (pdStatus === 'error') return 'red';
    if (pdStatus !== 'success') return undefined;
    return amberOnNonZero && (n ?? 0) > 0 ? 'amber' : undefined;
  };

  return (
    <div className="max-w-7xl mx-auto px-6 pt-4 pb-3 space-y-3">
      {/* Row 1: Pilot counts — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Current clients"
          value={stats.totalClients.toString()}
          sub="live + exec'd out"
        />
        <KpiCard
          label={`Pilots ending in ${stats.thisMonthName}`}
          value={cardValue(pdCounts?.thisMonth)}
          sub={cardSub()}
          accent={cardAccent(pdCounts?.thisMonth, true)}
        />
        <KpiCard
          label={`Pilots ending in ${stats.nextMonthName}`}
          value={cardValue(pdCounts?.nextMonth)}
          sub={cardSub()}
          accent={cardAccent(pdCounts?.nextMonth)}
        />
        <KpiCard
          label={`Pilots ending in ${stats.monthAfterNextName}`}
          value={cardValue(pdCounts?.monthAfterNext)}
          sub={cardSub()}
          accent={cardAccent(pdCounts?.monthAfterNext)}
        />
      </div>

      {/* Row 2: Revenue — 3 cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Post-pilot MRR"
          value={formatUSD(stats.postPilotMrr)}
          sub="live clients past pilot · next invoice total"
          accent="blue"
        />
        <KpiCard
          label={`Post-pilot collected — ${stats.thisMonthName}`}
          value={formatUSD(stats.postPilotCollectedThisMonth)}
          sub="month-to-date · live only · unverified"
          accent="green"
        />
        <KpiCard
          label={`Forecast — ${stats.nextMonthName}`}
          value={formatUSD(stats.postPilotForecastNextMonth)}
          sub="post-pilot subs · next month"
        />
      </div>
    </div>
  );
}
