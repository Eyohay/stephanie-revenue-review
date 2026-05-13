'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { LinkPills } from '@/app/components/LinkPills';
import { LabelsForOrg } from '@/app/components/LabelPills';
import { TierBadge } from '@/app/components/StatusBadge';
import { type LabelsByOrgId } from '@/lib/pipedrive/all-labels';

const TD = 'px-3 py-2.5 align-top';

// ---------------------------------------------------------------------------
// Circular distance between two day-of-month values (max 15)
// ---------------------------------------------------------------------------
function circularDistance(billDay: number, pilotDay: number): number {
  const diff = Math.abs(billDay - pilotDay);
  return Math.min(diff, 30 - diff);
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'];
  return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// "Days between" cell — shows work inline: Bill 19th · Pilot 14th → 5 days
// ---------------------------------------------------------------------------
function DaysBetweenCell({ billIso, pilotIso }: { billIso: string | null; pilotIso: string | null }) {
  if (!billIso || !pilotIso) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }

  const billDay = new Date(billIso).getDate();
  const pilotDay = new Date(pilotIso).getDate();
  const distance = circularDistance(billDay, pilotDay);

  let color: string;
  if (distance <= 7) color = '#34d399';
  else if (distance <= 11) color = '#f59e0b';
  else color = '#f87171';

  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--text-secondary)' }}>
        Bill {ordinal(billDay)} · Pilot {ordinal(pilotDay)} →{' '}
      </span>
      <span style={{ color, fontWeight: 600 }}>{distance} day{distance === 1 ? '' : 's'}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
type SortKey = 'daysBetween' | 'pilotEndDate' | 'nextBillDate' | 'clientName';

type ComputedRow = SerializedClientRow & { _distance: number | null };

function useSortedRows(rows: ComputedRow[]) {
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
    // Rows with no next bill date always go to bottom regardless of sort direction
    const aNull = a._distance === null;
    const bNull = b._distance === null;
    if (aNull && !bNull) return 1;
    if (!aNull && bNull) return -1;
    if (aNull && bNull) return a.organizationName.localeCompare(b.organizationName);

    let va: number, vb: number;
    switch (sortKey) {
      case 'daysBetween':
        va = a._distance!;
        vb = b._distance!;
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
      default:
        return 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  return { sorted, sortKey, sortDir, onSort };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function SortableHeader({
  label, sortKey, current, dir, onSort, align,
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
      {active && <span style={{ marginLeft: 4, fontSize: 9 }}>{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function PilotVsBillingTab({
  rows,
  labelsByOrgId,
}: {
  rows: SerializedClientRow[];
  labelsByOrgId: LabelsByOrgId;
}) {
  const inPilot: ComputedRow[] = rows
    .filter((r) => r.isInPilot)
    .map((r) => {
      const _distance =
        r.nextPaymentDate && r.pilotRolloverEndDate
          ? circularDistance(
              new Date(r.nextPaymentDate).getDate(),
              new Date(r.pilotRolloverEndDate).getDate(),
            )
          : null;
      return { ...r, _distance };
    });

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
            <th style={{
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              padding: '10px 12px', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
            }}>Labels</th>
            <th style={{
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              padding: '10px 12px', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
            }}>Tier</th>
            <th style={{
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              padding: '10px 12px', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
            }}>Links</th>
            <SortableHeader label="Pilot end date" sortKey="pilotEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Next bill date" sortKey="nextBillDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Days between" sortKey="daysBetween" current={sortKey} dir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                {r.organizationName}
              </td>
              <td className={TD}>
                <LabelsForOrg orgId={r.pipedriveOrgId} labelsByOrgId={labelsByOrgId} />
              </td>
              <td className={TD}>
                <TierBadge tier={r.tier} />
              </td>
              <td className={TD}>
                <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
              </td>
              <td className={TD} style={{ color: 'var(--foreground)' }}>
                {formatDay(r.pilotRolloverEndDate)}
              </td>
              <td className={TD} style={{ color: r.nextPaymentDate ? 'var(--foreground)' : 'var(--text-muted)' }}>
                {formatDay(r.nextPaymentDate)}
              </td>
              <td className={TD}>
                <DaysBetweenCell billIso={r.nextPaymentDate} pilotIso={r.pilotRolloverEndDate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
