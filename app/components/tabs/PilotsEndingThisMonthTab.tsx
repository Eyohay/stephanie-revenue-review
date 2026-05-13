'use client';

import { type SerializedJoinedPilotRow, type PilotMonthSummary } from '@/lib/joinPipedriveWithNeon';
import { formatDate, formatUSD, formatUSDPrecise, relativeDays, daysAgo } from '@/lib/format';
import { LinkPills } from '../LinkPills';
import {
  StatusBadge,
  PendingBadge,
  PaidUpfrontBadge,
  LikelyPaidUpfrontBadge,
  LegacyPricingBadge,
  RolledOverBadge,
  StripeBadge,
} from '../StatusBadge';
import { PD_LABEL_COLORS } from '@/lib/pipedrive/client';

const TD = 'px-3 py-2.5 align-top';

const TH_STYLE: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-muted)',
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
};

function hasMismatch(last: number | null, next: number | null): boolean {
  if (last === null || next === null) return false;
  const tolerance = Math.max(Math.max(last, next) * 0.05, 50);
  return Math.abs(last - next) > tolerance;
}

function LabelPills({ labels }: { labels: { id: number; name: string; color: string }[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {labels.map(l => {
        const hex = PD_LABEL_COLORS[l.color] ?? '#94a3b8';
        return (
          <span
            key={l.id}
            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: `${hex}26`, color: hex }}   // 26 = ~15% opacity hex
          >
            {l.name}
          </span>
        );
      })}
    </div>
  );
}

function Tile({
  label,
  value,
  subtitle,
  valueColor,
}: {
  label: string;
  value: string;
  subtitle: string;
  valueColor: string;
}) {
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
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {subtitle}
      </div>
    </div>
  );
}

function ForecastCell({ row }: { row: SerializedJoinedPilotRow }) {
  if (row.excludedFromCount) {
    return <span style={{ color: 'var(--text-muted)' }}>excluded</span>;
  }
  const pct = Math.round(row.forecastMultiplier * 100);
  const color = row.forecastMultiplier === 1 ? '#34d399'
    : row.forecastMultiplier === 0.5 ? '#a78bfa'
    : 'var(--text-muted)';
  if (row.forecastContribution === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color, fontWeight: 500 }}>{formatUSD(row.forecastContribution)}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 4 }}>({pct}%)</span>
    </span>
  );
}

export default function PilotsEndingThisMonthTab({
  rows,
  summary,
  monthName,
}: {
  rows: SerializedJoinedPilotRow[];
  summary: PilotMonthSummary;
  monthName: string;
}) {
  return (
    <div>
      {/* Tiles — pilots count, projected rollover %, forecast */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Tile
          label={`Pilots ending in ${monthName}`}
          value={summary.pilotsThisMonth.toString()}
          subtitle="Pilots ending this month, minus anyone tagged 'Dead <30 days'"
          valueColor="#fbbf24"
        />
        <Tile
          label="Projected rollover %"
          value={`${summary.rolloverPercent}%`}
          subtitle={`Rolled Over + Potential Rollover ÷ pilots ending this month (${summary.rolloverNumerator} ÷ ${summary.pilotsThisMonth})`}
          valueColor="#a78bfa"
        />
        <Tile
          label={`${monthName} forecast`}
          value={formatUSD(summary.forecastTotal)}
          subtitle="100% of active subs + 50% of rollover candidates"
          valueColor="#34d399"
        />
      </div>

      {/* Methodology explainer */}
      <div
        className="mb-4 p-3 rounded"
        style={{
          border: '1px dashed var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}
      >
        <div className="font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
          How the forecast works
        </div>
        <ul className="list-disc pl-5 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
          <li>Clients tagged Potential Rollover for this month → 50% of their monthly retainer</li>
          <li>All other clients with an active subscription → 100% of their monthly retainer</li>
          <li>Clients tagged Dead/offboarded or Dead &lt;30 days → excluded</li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No pilots ending in {monthName}.
        </div>
      ) : (
      <>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Pilots ending in <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{monthName}</span>
          {' · '}{rows.length} client{rows.length !== 1 ? 's' : ''} in PipeDrive
          {' · '}{summary.pilotsThisMonth} counted
          {' · '}source: PipeDrive filter (canonical)
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Payment data from ChargeOver where available
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Client</th>
              <th style={TH_STYLE}>Links</th>
              <th style={TH_STYLE}>Pilot ends</th>
              <th style={TH_STYLE}>Labels</th>
              <th style={TH_STYLE}>Manager</th>
              <th style={TH_STYLE}>Last payment</th>
              <th style={TH_STYLE}>Next payment</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>Monthly amount</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>Forecast</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isUpfront = r.paidUpfront || r.likelyPaidUpfront || (r.monthlyAmount === null && r.hasNeonMatch);
              const mismatch = !isUpfront && hasMismatch(r.lastPaymentAmount, r.nextPaymentAmount);
              const rowOpacity = r.excludedFromCount ? 0.5 : 1;
              const nameStyle: React.CSSProperties = r.excludedFromCount
                ? { textDecoration: 'line-through', textDecorationColor: 'var(--text-muted)' }
                : {};

              return (
                <tr
                  key={r.pipedriveOrgId}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    borderLeft: mismatch ? '3px solid #f59e0b' : '3px solid transparent',
                    opacity: rowOpacity,
                  }}
                >
                  {/* Client name + status badge */}
                  <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span style={nameStyle}>{r.organizationName}</span>
                      {r.isStripe && <StripeBadge />}
                      {r.accountStatus !== 'Live' && <StatusBadge status={r.accountStatus} />}
                      {r.rolledOver && <RolledOverBadge />}
                    </div>
                  </td>

                  {/* Links */}
                  <td className={TD}>
                    <LinkPills
                      orgId={r.pipedriveOrgId}
                      customerId={r.chargeoverCustomerId}
                    />
                  </td>

                  {/* Pilot end date */}
                  <td className={TD}>
                    {r.pilotRolloverEndDate ? (
                      <div>
                        <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                          {formatDate(r.pilotRolloverEndDate)}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {relativeDays(r.pilotRolloverEndDate)}
                        </div>
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>

                  {/* PipeDrive labels */}
                  <td className={TD}>
                    {r.labels.length > 0
                      ? <LabelPills labels={r.labels} />
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>
                    }
                  </td>

                  {/* Account manager */}
                  <td className={TD} style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {r.accountManager ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>

                  {/* Last payment */}
                  <td className={TD}>
                    {!r.hasNeonMatch ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>no ChargeOver data</span>
                    ) : r.lastPaymentDate ? (
                      <div>
                        <div className="flex items-center gap-1">
                          <span style={{ color: 'var(--foreground)' }}>
                            {formatDate(r.lastPaymentDate)}
                          </span>
                          {r.lastPaymentPending && <PendingBadge />}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {formatUSDPrecise(r.lastPaymentAmount)} · {daysAgo(r.lastPaymentDate)}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>

                  {/* Next payment */}
                  <td className={TD}>
                    {!r.hasNeonMatch ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                    ) : r.nextPaymentDate ? (
                      <div>
                        <div className="flex items-center gap-1">
                          <span style={{ color: 'var(--foreground)' }}>
                            {formatDate(r.nextPaymentDate)}
                          </span>
                          {mismatch && (
                            <span
                              title={`Last payment (${formatUSDPrecise(r.lastPaymentAmount)}) doesn't match next scheduled (${formatUSDPrecise(r.nextPaymentAmount)})`}
                              style={{ color: '#f59e0b', cursor: 'help', fontSize: 12, lineHeight: 1 }}
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {formatUSDPrecise(r.nextPaymentAmount)} · {daysAgo(r.nextPaymentDate)}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>

                  {/* Monthly amount */}
                  <td className={TD} style={{ textAlign: 'right', fontWeight: 500, color: 'var(--foreground)' }}>
                    {!r.hasNeonMatch ? (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>
                    ) : r.paidUpfront ? (
                      <PaidUpfrontBadge />
                    ) : r.likelyPaidUpfront ? (
                      <LikelyPaidUpfrontBadge />
                    ) : r.monthlyAmount === null ? (
                      <PaidUpfrontBadge />
                    ) : (
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <span>{formatUSD(r.monthlyAmount)}</span>
                        {r.monthlyAmount < 2000 && <LegacyPricingBadge />}
                      </div>
                    )}
                  </td>

                  {/* Forecast */}
                  <td className={TD} style={{ textAlign: 'right' }}>
                    <ForecastCell row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
