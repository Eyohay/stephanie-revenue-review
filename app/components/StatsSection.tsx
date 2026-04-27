import { type Stats } from '@/lib/query';
import { formatUSD } from '@/lib/format';

function KpiCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'blue' | 'amber';
}) {
  const valueColor =
    tone === 'green'
      ? 'text-green-700'
      : tone === 'blue'
      ? 'text-blue-700'
      : tone === 'amber'
      ? 'text-amber-700'
      : 'text-gray-900';
  return (
    <div className="bg-white border rounded-lg p-4" style={{ borderColor: 'var(--color-border-tertiary)' }}>
      <div className="text-xs text-gray-500 uppercase tracking-wide leading-tight">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function StatsSection({ stats }: { stats: Stats }) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-4 pb-2 space-y-3">
      {/* Row 1: Client counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Current clients"
          value={stats.totalClients.toString()}
          sub="live + pre-launch"
        />
        <KpiCard
          label={`Pilots ending in ${stats.thisMonthName}`}
          value={stats.pilotsEndingThisMonth.toString()}
          tone={stats.pilotsEndingThisMonth > 0 ? 'amber' : 'default'}
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

      {/* Row 2: Revenue */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={`Revenue — ${stats.lastMonthName} (collected)`}
          value={formatUSD(stats.revenueLastMonth)}
          sub="ok-successful payments"
        />
        <KpiCard
          label="Revenue — MTD this month"
          value={formatUSD(stats.revenueMtd)}
          sub="collected so far"
          tone="green"
        />
        <KpiCard
          label="Forecast — this month"
          value={formatUSD(stats.revenueForecast)}
          sub="MTD + expected remaining"
        />
        <KpiCard
          label="Post-pilot MRR"
          value={formatUSD(stats.revenuePostPilotRecurring)}
          sub="live clients past pilot"
          tone="blue"
        />
      </div>
    </div>
  );
}
