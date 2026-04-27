'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, formatUSDPrecise, daysAgo } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { StatusBadge, PendingBadge } from './StatusBadge';

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
const TD = 'px-3 py-2.5 align-top';

type PilotFilter = 'all' | 'in-pilot' | 'post-pilot';

function getBucket(amount: number | null): number {
  if (amount === null || amount <= 0) return 0;
  return Math.floor(amount / 250) * 250;
}

function bucketLabel(low: number): string {
  return `${formatUSD(low)} – ${formatUSD(low + 250)}/mo`;
}

function hasMismatch(last: number | null, next: number | null): boolean {
  if (last === null || next === null) return false;
  const tolerance = Math.max(Math.max(last, next) * 0.05, 50);
  return Math.abs(last - next) > tolerance;
}

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      className="inline-flex rounded-full p-0.5 gap-0.5"
      style={{ background: 'var(--bg-elevated)' }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1 rounded-full text-xs font-medium transition-all"
          style={
            value === opt.value
              ? { background: '#334155', color: '#f1f5f9' }
              : { color: 'var(--text-secondary)' }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function ActiveByPriceTab({ rows }: { rows: SerializedClientRow[] }) {
  const [pilotFilter, setPilotFilter] = useState<PilotFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const filtered = rows.filter((r) => {
    if (pilotFilter === 'in-pilot') return r.isInPilot;
    if (pilotFilter === 'post-pilot') return r.isPastPilot;
    return true;
  });

  const bucketMap = new Map<number, SerializedClientRow[]>();
  for (const r of filtered) {
    const b = getBucket(r.nextPaymentAmount);
    if (!bucketMap.has(b)) bucketMap.set(b, []);
    bucketMap.get(b)!.push(r);
  }

  const buckets = Array.from(bucketMap.entries()).sort((a, b) => b[0] - a[0]);

  const toggle = (b: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const inPilotCount = rows.filter((r) => r.isInPilot).length;
  const postPilotCount = rows.filter((r) => r.isPastPilot).length;

  const pilotOptions = [
    { value: 'all', label: `All (${rows.length})` },
    { value: 'in-pilot', label: `In pilot (${inPilotCount})` },
    { value: 'post-pilot', label: `Post-pilot (${postPilotCount})` },
  ];

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No recurring monthly clients.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SegmentedControl
          value={pilotFilter}
          onChange={(v) => setPilotFilter(v as PilotFilter)}
          options={pilotOptions}
        />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Recurring monthly clients only · paid-upfront excluded
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No clients in this view.
        </div>
      )}

      {buckets.map(([low, bRows]) => {
        const isCollapsed = collapsed.has(low);
        return (
          <div key={low} className="mb-3">
            <button
              onClick={() => toggle(low)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-left text-xs font-semibold uppercase tracking-wide"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <span
                className="transition-transform"
                style={{
                  fontSize: 9,
                  transform: isCollapsed ? 'none' : 'rotate(90deg)',
                  display: 'inline-block',
                  color: 'var(--text-muted)',
                }}
              >
                ▶
              </span>
              <span>{bucketLabel(low)}</span>
              <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>
                ({bRows.length} client{bRows.length !== 1 ? 's' : ''})
              </span>
            </button>

            {!isCollapsed && (
              <div
                className="overflow-x-auto rounded-b"
                style={{ border: '1px solid var(--border)', borderTop: 'none' }}
              >
                <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>Client</th>
                      <th style={TH_STYLE}>Links</th>
                      <th style={TH_STYLE}>Status</th>
                      <th style={TH_STYLE}>Last payment</th>
                      <th style={TH_STYLE}>Next payment</th>
                      <th style={{ ...TH_STYLE, textAlign: 'right' }}>Monthly amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bRows.map((r) => {
                      const mismatch = hasMismatch(r.lastPaymentAmount, r.nextPaymentAmount);
                      return (
                        <tr
                          key={r.id}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            borderLeft: mismatch ? '3px solid #f59e0b' : '3px solid transparent',
                          }}
                        >
                          <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                            {r.organizationName}
                          </td>
                          <td className={TD}>
                            <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
                          </td>
                          <td className={TD}>
                            <StatusBadge status={r.accountStatus} />
                          </td>
                          <td className={TD}>
                            {r.lastPaymentDate ? (
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
                          <td className={TD}>
                            {r.nextPaymentDate ? (
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
                          <td
                            className={TD}
                            style={{ textAlign: 'right', fontWeight: 500, color: 'var(--foreground)' }}
                          >
                            {r.nextPaymentAmount !== null ? formatUSD(r.nextPaymentAmount) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
