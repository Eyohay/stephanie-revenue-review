'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { LinkPills } from '@/app/components/LinkPills';
import { TierBadge } from '@/app/components/StatusBadge';

const TD = 'px-3 py-2.5 align-top';
const MS_PER_DAY = 1000 * 60 * 60 * 24;

type SortKey = 'daysBetween' | 'pilotEndDate' | 'nextBillDate' | 'clientName' | 'tier';

function formatMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function computeDaysBetween(
  pilotEndIso: string | null,
  nextBillIso: string | null,
): number | null {
  if (!pilotEndIso || !nextBillIso) return null;
  const pilot = new Date(pilotEndIso);
  const bill = new Date(nextBillIso);
  return Math.abs(Math.round((bill.getTime() - pilot.getTime()) / MS_PER_DAY));
}

function DaysBetweenCell({ days }: { days: number | null }) {
  if (days === null) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  let color: string;
  if (days <= 7) color = '#34d399';
  else if (days <= 14) color = '#f59e0b';
  else color = '#f87171';
  return <span style={{ color, fontWeight: 600 }}>{days}</span>;
}

function SortableHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'right' | 'center';
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        background: 'var(--bg-elevated)',
        color: active ? 'var(--foreground)' : 'var(--text-muted)',
        padding: '10px 12px',
        textAlign: align ?? 'left',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {label}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 9 }}>{dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </th>
  );
}

type PilotBillingRow = SerializedClientRow & { _daysBetween: number | null };

function useSortedRows(rows: PilotBillingRow[]) {
  const [sortKey, setSortKey] = useState<SortKey>('daysBetween');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'daysBetween' ? 'desc' : 'asc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    // Rows with no next bill date always go to the bottom, regardless of sort direction.
    const aNull = a._daysBetween === null;
    const bNull = b._daysBetween === null;
    if (aNull && !bNull) return 1;
    if (!aNull && bNull) return -1;
    if (aNull && bNull) return a.organizationName.localeCompare(b.organizationName);

    let va: number, vb: number;
    switch (sortKey) {
      case 'daysBetween':
        va = a._daysBetween!;
        vb = b._daysBetween!;
        break;
      case 'pilotEndDate':
        va = a.pilotRolloverEndDate ? new Date(a.pilotRolloverEndDate).getTime() : Infinity;
        vb = b.pilotRolloverEndDate ? new Date(b.pilotRolloverEndDate).getTime() : Infinity;
        break;
      case 'nextBillDate':
        va = a.nextPaymentDate ? new Date(a.nextPaymentDate).getTime() : Infinity;
        vb = b.nextPaymentDate ? new Date(b.nextPaymentDate).getTime() : Infinity;
        break;
      case 'clientName':
        return sortDir === 'asc'
          ? a.organizationName.localeCompare(b.organizationName)
          : b.organizationName.localeCompare(a.organizationName);
      case 'tier': {
        const tierOrder = { Platinum: 0, Gold: 1, Custom: 2, null: 3 };
        va = tierOrder[a.tier as keyof typeof tierOrder] ?? 3;
        vb = tierOrder[b.tier as keyof typeof tierOrder] ?? 3;
        break;
      }
      default:
        return 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  return { sorted, sortKey, sortDir, onSort };
}

export default function PilotVsBillingTab({ rows }: { rows: SerializedClientRow[] }) {
  const inPilot = rows
    .filter((r) => r.isInPilot)
    .map((r): PilotBillingRow => ({
      ...r,
      _daysBetween: computeDaysBetween(r.pilotRolloverEndDate, r.nextPaymentDate),
    }));

  const { sorted, sortKey, sortDir, onSort } = useSortedRows(inPilot);

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No clients currently in pilot.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <SortableHeader label="Client" sortKey="clientName" current={sortKey} dir={sortDir} onSort={onSort} />
            <th
              style={{
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
              }}
            >
              Links
            </th>
            <SortableHeader label="Pilot end month" sortKey="pilotEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Pilot end date" sortKey="pilotEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Next bill month" sortKey="nextBillDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Next bill date" sortKey="nextBillDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Days between" sortKey="daysBetween" current={sortKey} dir={sortDir} onSort={onSort} align="center" />
            <SortableHeader label="Tier" sortKey="tier" current={sortKey} dir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                {r.organizationName}
              </td>
              <td className={TD}>
                <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
              </td>
              <td className={TD} style={{ color: 'var(--text-secondary)' }}>
                {formatMonth(r.pilotRolloverEndDate)}
              </td>
              <td className={TD} style={{ color: 'var(--foreground)' }}>
                {formatDay(r.pilotRolloverEndDate)}
              </td>
              <td className={TD} style={{ color: r.nextPaymentDate ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {formatMonth(r.nextPaymentDate)}
              </td>
              <td className={TD} style={{ color: r.nextPaymentDate ? 'var(--foreground)' : 'var(--text-muted)' }}>
                {formatDay(r.nextPaymentDate)}
              </td>
              <td className={TD} style={{ textAlign: 'center' }}>
                <DaysBetweenCell days={r._daysBetween} />
              </td>
              <td className={TD}>
                <TierBadge tier={r.tier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
