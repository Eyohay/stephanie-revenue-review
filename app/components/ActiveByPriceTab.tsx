'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { formatUSD } from '@/lib/format';
import { PipeDriveLink, ChargeOverLink } from './LinkPills';
import { StatusBadge } from './StatusBadge';

const TH = 'px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap';
const TD = 'px-3 py-2 align-top';

function getBucket(amount: number | null): number {
  if (amount === null || amount <= 0) return 0;
  return Math.floor(amount / 250) * 250;
}

function bucketLabel(low: number): string {
  return `${formatUSD(low)} – ${formatUSD(low + 250)}`;
}

export default function ActiveByPriceTab({ rows }: { rows: SerializedClientRow[] }) {
  // Group into buckets
  const bucketMap = new Map<number, SerializedClientRow[]>();
  for (const r of rows) {
    const b = getBucket(r.largestSubAmount);
    if (!bucketMap.has(b)) bucketMap.set(b, []);
    bucketMap.get(b)!.push(r);
  }

  // Sort buckets descending (highest first)
  const buckets = Array.from(bucketMap.entries()).sort((a, b) => b[0] - a[0]);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggle = (b: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  if (rows.length === 0) {
    return <div className="text-center py-12 text-gray-500 text-sm">No active clients.</div>;
  }

  return (
    <div>
      {buckets.map(([low, bRows]) => {
        const isCollapsed = collapsed.has(low);
        return (
          <div key={low} className="mb-4">
            <button
              onClick={() => toggle(low)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-100 rounded text-left hover:bg-gray-200 text-sm font-medium text-gray-700"
            >
              <span className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
              <span>{bucketLabel(low)}</span>
              <span className="ml-1 text-gray-500 font-normal">({bRows.length})</span>
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto border-l border-r border-b rounded-b" style={{ borderColor: 'var(--color-border-tertiary)' }}>
                <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                      <th className={TH}>Client</th>
                      <th className={TH}>Links</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Subscription</th>
                      <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bRows.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }} className="hover:bg-gray-50">
                        <td className={TD} style={{ fontWeight: 500 }}>{r.organizationName}</td>
                        <td className={TD}>
                          <div className="flex gap-1">
                            <PipeDriveLink orgId={r.pipedriveOrgId} />
                            {r.paidUpfront && r.chargeoverCustomerId && (
                              <ChargeOverLink customerId={r.chargeoverCustomerId} />
                            )}
                          </div>
                        </td>
                        <td className={TD}><StatusBadge status={r.accountStatus} /></td>
                        <td className={TD} style={{ color: '#6b7280' }}>
                          {r.largestSubProductName || '—'}
                        </td>
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
