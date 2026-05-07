'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { LinkPills } from '@/app/components/LinkPills';

const TD = 'px-3 py-2.5 align-top';
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ---------------------------------------------------------------------------
// Tier helpers (financeNotes substring match — same logic as deriveTier in query.ts)
// ---------------------------------------------------------------------------
type Tier = 'Platinum' | 'Gold' | 'unknown';

function deriveTierFromRow(r: SerializedClientRow): Tier {
  if (r.tier === 'Platinum') return 'Platinum';
  if (r.tier === 'Gold') return 'Gold';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Final payment date: Kick-Off Call + 4 months (Gold) or 6 months (Platinum)
// ---------------------------------------------------------------------------
function finalPaymentDate(kickOffCall: Date, tier: Tier): Date | null {
  if (tier === 'unknown') return null;
  const months = tier === 'Gold' ? 4 : 6;
  return new Date(Date.UTC(
    kickOffCall.getUTCFullYear(),
    kickOffCall.getUTCMonth() + months,
    kickOffCall.getUTCDate(),
  ));
}

// ---------------------------------------------------------------------------
// Days delta: signed — positive = final payment AFTER pilot end (bad)
// ---------------------------------------------------------------------------
function computeDaysDelta(kickOffIso: string | null, pilotEndIso: string | null, tier: Tier): number | null {
  if (!kickOffIso || !pilotEndIso || tier === 'unknown') return null;
  const fp = finalPaymentDate(new Date(kickOffIso), tier);
  if (!fp) return null;
  const pilotEnd = new Date(pilotEndIso);
  return Math.round((fp.getTime() - pilotEnd.getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DaysDeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  let color: string;
  if (delta <= 0) color = '#34d399';       // green — on or before pilot end
  else if (delta <= 7) color = '#f59e0b';  // amber — slips slightly
  else color = '#f87171';                  // red — slips well past

  const sign = delta > 0 ? '+' : '';
  return <span style={{ color, fontWeight: 600 }}>{sign}{delta}</span>;
}

function TierCell({ tier }: { tier: Tier }) {
  if (tier === 'Platinum') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: 'rgba(148,163,184,0.2)', color: '#cbd5e1' }}>
        Platinum
      </span>
    );
  }
  if (tier === 'Gold') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
        Gold
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: 'rgba(148,163,184,0.08)', color: 'var(--text-muted)' }}>
      Unknown tier
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
type SortKey = 'daysDelta' | 'pilotEndDate' | 'kickOffDate' | 'finalPaymentDate' | 'clientName' | 'tier';

type ComputedRow = SerializedClientRow & {
  _tier: Tier;
  _finalPaymentIso: string | null;
  _daysDelta: number | null;
};

function useSortedRows(rows: ComputedRow[]) {
  const [sortKey, setSortKey] = useState<SortKey>('daysDelta');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'daysDelta' ? 'desc' : 'asc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    // Rows with no delta always go to the bottom regardless of sort direction
    const aNull = a._daysDelta === null;
    const bNull = b._daysDelta === null;
    if (aNull && !bNull) return 1;
    if (!aNull && bNull) return -1;
    if (aNull && bNull) return a.organizationName.localeCompare(b.organizationName);

    let va: number, vb: number;
    switch (sortKey) {
      case 'daysDelta':
        va = a._daysDelta!;
        vb = b._daysDelta!;
        break;
      case 'pilotEndDate':
        va = a.pilotRolloverEndDate ? new Date(a.pilotRolloverEndDate).getTime() : Infinity;
        vb = b.pilotRolloverEndDate ? new Date(b.pilotRolloverEndDate).getTime() : Infinity;
        break;
      case 'kickOffDate':
        va = a.kickoffCall ? new Date(a.kickoffCall).getTime() : Infinity;
        vb = b.kickoffCall ? new Date(b.kickoffCall).getTime() : Infinity;
        break;
      case 'finalPaymentDate':
        va = a._finalPaymentIso ? new Date(a._finalPaymentIso).getTime() : Infinity;
        vb = b._finalPaymentIso ? new Date(b._finalPaymentIso).getTime() : Infinity;
        break;
      case 'clientName':
        return sortDir === 'asc'
          ? a.organizationName.localeCompare(b.organizationName)
          : b.organizationName.localeCompare(a.organizationName);
      case 'tier': {
        const order = { Platinum: 0, Gold: 1, unknown: 2 };
        va = order[a._tier];
        vb = order[b._tier];
        break;
      }
      default:
        return 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  return { sorted, sortKey, sortDir, onSort };
}

// ---------------------------------------------------------------------------
// Header components
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
export default function PilotVsBillingTab({ rows }: { rows: SerializedClientRow[] }) {
  const inPilot: ComputedRow[] = rows
    .filter((r) => r.isInPilot)
    .map((r) => {
      const tier = deriveTierFromRow(r);
      const fp = r.kickoffCall ? finalPaymentDate(new Date(r.kickoffCall), tier) : null;
      const _finalPaymentIso = fp?.toISOString() ?? null;
      const _daysDelta = computeDaysDelta(r.kickoffCall, r.pilotRolloverEndDate, tier);
      return { ...r, _tier: tier, _finalPaymentIso, _daysDelta };
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
            }}>Links</th>
            <SortableHeader label="Tier" sortKey="tier" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Kick-Off Call" sortKey="kickOffDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Pilot end date" sortKey="pilotEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Final payment" sortKey="finalPaymentDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Days delta" sortKey="daysDelta" current={sortKey} dir={sortDir} onSort={onSort} align="center" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                {r.organizationName}
              </td>
              <td className={TD}>
                <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
              </td>
              <td className={TD}><TierCell tier={r._tier} /></td>
              <td className={TD} style={{ color: 'var(--foreground)' }}>{formatDay(r.kickoffCall)}</td>
              <td className={TD} style={{ color: 'var(--foreground)' }}>{formatDay(r.pilotRolloverEndDate)}</td>
              <td className={TD} style={{ color: r._finalPaymentIso ? 'var(--foreground)' : 'var(--text-muted)' }}>
                {formatDay(r._finalPaymentIso)}
              </td>
              <td className={TD} style={{ textAlign: 'center' }}>
                <DaysDeltaCell delta={r._daysDelta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
