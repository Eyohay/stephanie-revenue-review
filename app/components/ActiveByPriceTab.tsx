'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { formatUSD } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { StatusBadge } from './StatusBadge';

const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide bg-gray-50 whitespace-nowrap';
const TD = 'px-3 py-2.5 align-top';

type PilotFilter = 'all' | 'in-pilot' | 'post-pilot';

function getBucket(amount: number | null): number {
  if (amount === null || amount <= 0) return 0;
  return Math.floor(amount / 250) * 250;
}

function bucketLabel(low: number): string {
  return `${formatUSD(low)} – ${formatUSD(low + 250)}/mo`;
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
    <div className="inline-flex rounded-full bg-gray-100 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            value === opt.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
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

  // Group into $250 buckets
  const bucketMap = new Map<number, SerializedClientRow[]>();
  for (const r of filtered) {
    const b = getBucket(r.largestSubAmount);
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
    return <div className="text-center py-12 text-gray-500 text-sm">No recurring monthly clients.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SegmentedControl
          value={pilotFilter}
          onChange={(v) => setPilotFilter(v as PilotFilter)}
          options={pilotOptions}
        />
        <span className="text-xs text-gray-400">Recurring monthly clients only · paid-upfront excluded</span>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">No clients in this view.</div>
      )}

      {buckets.map(([low, bRows]) => {
        const isCollapsed = collapsed.has(low);
        return (
          <div key={low} className="mb-3">
            <button
              onClick={() => toggle(low)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 border rounded text-left hover:bg-gray-100 text-xs font-semibold text-gray-700 uppercase tracking-wide"
              style={{ borderColor: 'var(--color-border-tertiary)' }}
            >
              <span className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} style={{ fontSize: 9 }}>▶</span>
              <span>{bucketLabel(low)}</span>
              <span className="ml-1 text-gray-400 font-normal normal-case">({bRows.length} client{bRows.length !== 1 ? 's' : ''})</span>
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto border border-t-0 rounded-b" style={{ borderColor: 'var(--color-border-tertiary)' }}>
                <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                      <th className={TH}>Client</th>
                      <th className={TH}>Links</th>
                      <th className={TH}>Status</th>
                      <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ '--tw-divide-color': 'var(--color-border-tertiary)' } as React.CSSProperties}>
                    {bRows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className={TD} style={{ fontWeight: 500 }}>{r.organizationName}</td>
                        <td className={TD}>
                          <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
                        </td>
                        <td className={TD}><StatusBadge status={r.accountStatus} /></td>
                        <td className={TD} style={{ textAlign: 'right', fontWeight: 500 }}>
                          {r.largestSubAmount !== null ? formatUSD(r.largestSubAmount) : '—'}
                        </td>
                      </tr>
                    ))}
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
