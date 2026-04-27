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
  accent?: 'green' | 'blue' | 'amber';
}) {
  const valueColor =
    accent === 'green'
      ? '#4ade80'
      : accent === 'blue'
      ? '#60a5fa'
      : accent === 'amber'
      ? '#fbbf24'
      : 'var(--foreground)';
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
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function StatsSection({ stats }: { stats: Stats }) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-4 pb-3 space-y-3">
      {/* Row 1: Pilot counts — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Current clients"
          value={stats.totalClients.toString()}
          sub="live"
        />
        <KpiCard
          label={`Pilots ending in ${stats.thisMonthName}`}
          value={stats.pilotsEndingThisMonth.toString()}
          accent={stats.pilotsEndingThisMonth > 0 ? 'amber' : undefined}
        />
        <KpiCard
          label={`Pilots ending in ${stats.nextMonthName}`}
          value={stats.pilotsEndingNextMonth.toString()}
        />
        <KpiCard
          label={`Pilots ending in ${stats.monthAfterNextName}`}
          value={stats.pilotsEndingMonthAfterNext.toString()}
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
          sub="month-to-date · ok-successful"
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
