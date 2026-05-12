'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, formatUSDPrecise, relativeDays, daysAgo, monthsApart } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { TierBadge, PendingBadge, PaidUpfrontBadge, LikelyPaidUpfrontBadge, LegacyPricingBadge, RolledOverBadge, StripeBadge } from './StatusBadge';

const TD = 'px-3 py-2.5 align-top';

type View = 'in-pilot' | 'post-pilot';
type SortKey = 'pilotRolloverEndDate' | 'monthlyAmount' | 'nextPaymentDate' | 'monthsOut';

function hasMismatch(last: number | null, next: number | null): boolean {
  if (last === null || next === null) return false;
  const tolerance = Math.max(Math.max(last, next) * 0.05, 50);
  return Math.abs(last - next) > tolerance;
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

function StaticHeader({ label, align }: { label: string; align?: 'right' | 'center' }) {
  return (
    <th
      style={{
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
        padding: '10px 12px',
        textAlign: align ?? 'left',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {label}
    </th>
  );
}

function SegmentedControl({
  view,
  inCount,
  postCount,
  onChange,
}: {
  view: View;
  inCount: number;
  postCount: number;
  onChange: (v: View) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full p-0.5 gap-0.5"
      style={{ background: 'var(--bg-elevated)' }}
    >
      <button
        onClick={() => onChange('in-pilot')}
        className="px-4 py-1.5 rounded-full text-xs font-medium transition-all"
        style={
          view === 'in-pilot'
            ? { background: '#334155', color: '#f1f5f9' }
            : { color: 'var(--text-secondary)' }
        }
      >
        In pilot ({inCount})
      </button>
      <button
        onClick={() => onChange('post-pilot')}
        className="px-4 py-1.5 rounded-full text-xs font-medium transition-all"
        style={
          view === 'post-pilot'
            ? { background: '#334155', color: '#f1f5f9' }
            : { color: 'var(--text-secondary)' }
        }
      >
        Post-pilot ({postCount})
      </button>
    </div>
  );
}

function useSortedRows(rows: SerializedClientRow[], defaultKey: SortKey) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  const now = new Date();
  const sorted = [...rows].sort((a, b) => {
    let va: number, vb: number;
    switch (sortKey) {
      case 'pilotRolloverEndDate':
        va = a.pilotRolloverEndDate ? new Date(a.pilotRolloverEndDate).getTime() : Infinity;
        vb = b.pilotRolloverEndDate ? new Date(b.pilotRolloverEndDate).getTime() : Infinity;
        break;
      case 'monthlyAmount':
        va = a.monthlyAmount ?? 0;
        vb = b.monthlyAmount ?? 0;
        break;
      case 'nextPaymentDate':
        va = a.nextPaymentDate ? new Date(a.nextPaymentDate).getTime() : Infinity;
        vb = b.nextPaymentDate ? new Date(b.nextPaymentDate).getTime() : Infinity;
        break;
      case 'monthsOut':
        va = a.pilotRolloverEndDate ? monthsApart(a.pilotRolloverEndDate, now) : Infinity;
        vb = b.pilotRolloverEndDate ? monthsApart(b.pilotRolloverEndDate, now) : Infinity;
        break;
      default:
        return 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  return { sorted, sortKey, sortDir, onSort };
}

function NextPaymentCell({
  r,
  mismatch,
}: {
  r: SerializedClientRow;
  mismatch: boolean;
}) {
  if (!r.nextPaymentDate) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div>
      <div className="flex items-center gap-1">
        <span style={{ color: 'var(--foreground)' }}>{formatDate(r.nextPaymentDate)}</span>
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
  );
}

function LastPaymentCell({ r }: { r: SerializedClientRow }) {
  if (!r.lastPaymentDate) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div>
      <div className="flex items-center gap-1">
        <span style={{ color: 'var(--foreground)' }}>{formatDate(r.lastPaymentDate)}</span>
        {r.lastPaymentPending && <PendingBadge />}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        {formatUSDPrecise(r.lastPaymentAmount)} · {daysAgo(r.lastPaymentDate)}
      </div>
    </div>
  );
}

function InPilotTable({ rows }: { rows: SerializedClientRow[] }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedRows(rows, 'pilotRolloverEndDate');

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No clients in pilot.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <StaticHeader label="Client" />
            <StaticHeader label="Links" />
            <SortableHeader label="Pilot ends" sortKey="pilotRolloverEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <StaticHeader label="Tier" />
            <StaticHeader label="Subs" align="center" />
            <StaticHeader label="Last payment" />
            <SortableHeader label="Next payment" sortKey="nextPaymentDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Monthly amount" sortKey="monthlyAmount" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isUpfront = r.paidUpfront || r.likelyPaidUpfront || r.monthlyAmount === null;
            const mismatch = !isUpfront && hasMismatch(r.lastPaymentAmount, r.nextPaymentAmount);
            return (
              <tr
                key={r.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  borderLeft: mismatch ? '3px solid #f59e0b' : '3px solid transparent',
                }}
              >
                <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span>{r.organizationName}</span>
                    {r.isStripe && <StripeBadge />}
                    {r.rolledOver && <RolledOverBadge />}
                    {r.paidUpfront && <PaidUpfrontBadge />}
                    {!r.paidUpfront && r.likelyPaidUpfront && <LikelyPaidUpfrontBadge />}
                  </div>
                </td>
                <td className={TD}><LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} /></td>
                <td className={TD}>
                  {r.pilotRolloverEndDate ? (
                    <div>
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{formatDate(r.pilotRolloverEndDate)}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{relativeDays(r.pilotRolloverEndDate)}</div>
                    </div>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td className={TD}><TierBadge tier={r.tier} /></td>
                <td className={TD} style={{ textAlign: 'center', color: 'var(--foreground)' }}>{r.activeSubscriptionCount}</td>
                <td className={TD}><LastPaymentCell r={r} /></td>
                <td className={TD}><NextPaymentCell r={r} mismatch={mismatch} /></td>
                <td className={TD} style={{ textAlign: 'right', fontWeight: 500, color: 'var(--foreground)' }}>
                  {r.paidUpfront
                    ? <PaidUpfrontBadge />
                    : r.likelyPaidUpfront
                    ? <LikelyPaidUpfrontBadge />
                    : r.monthlyAmount === null
                    ? <PaidUpfrontBadge />
                    : (
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <span>{formatUSD(r.monthlyAmount)}</span>
                        {r.monthlyAmount < 2000 && <LegacyPricingBadge />}
                      </div>
                    )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PostPilotTable({ rows }: { rows: SerializedClientRow[] }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedRows(rows, 'monthsOut');
  const now = new Date();

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No post-pilot clients.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <StaticHeader label="Client" />
            <StaticHeader label="Links" />
            <SortableHeader label="Pilot ended" sortKey="pilotRolloverEndDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Months since pilot ended" sortKey="monthsOut" current={sortKey} dir={sortDir} onSort={onSort} />
            <StaticHeader label="Tier" />
            <StaticHeader label="Subs" align="center" />
            <StaticHeader label="Last payment" />
            <SortableHeader label="Next payment" sortKey="nextPaymentDate" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableHeader label="Monthly amount" sortKey="monthlyAmount" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const mo = r.pilotRolloverEndDate ? monthsApart(r.pilotRolloverEndDate, now) : null;
            const isUpfront = r.paidUpfront || r.likelyPaidUpfront || r.monthlyAmount === null;
            const mismatch = !isUpfront && hasMismatch(r.lastPaymentAmount, r.nextPaymentAmount);
            return (
              <tr
                key={r.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  borderLeft: mismatch ? '3px solid #f59e0b' : '3px solid transparent',
                }}
              >
                <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span>{r.organizationName}</span>
                    {r.isStripe && <StripeBadge />}
                    {r.rolledOver && <RolledOverBadge />}
                    {r.paidUpfront && <PaidUpfrontBadge />}
                    {!r.paidUpfront && r.likelyPaidUpfront && <LikelyPaidUpfrontBadge />}
                  </div>
                </td>
                <td className={TD}><LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} /></td>
                <td className={TD}>
                  {r.pilotRolloverEndDate ? (
                    <div>
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{formatDate(r.pilotRolloverEndDate)}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{relativeDays(r.pilotRolloverEndDate)}</div>
                    </div>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td className={TD} style={{ fontWeight: 500, color: 'var(--foreground)' }}>{mo !== null ? mo : '—'}</td>
                <td className={TD}><TierBadge tier={r.tier} /></td>
                <td className={TD} style={{ textAlign: 'center', color: 'var(--foreground)' }}>{r.activeSubscriptionCount}</td>
                <td className={TD}><LastPaymentCell r={r} /></td>
                <td className={TD}><NextPaymentCell r={r} mismatch={mismatch} /></td>
                <td className={TD} style={{ textAlign: 'right', fontWeight: 500, color: 'var(--foreground)' }}>
                  {r.paidUpfront
                    ? <PaidUpfrontBadge />
                    : r.likelyPaidUpfront
                    ? <LikelyPaidUpfrontBadge />
                    : r.monthlyAmount === null
                    ? <PaidUpfrontBadge />
                    : (
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <span>{formatUSD(r.monthlyAmount)}</span>
                        {r.monthlyAmount < 2000 && <LegacyPricingBadge />}
                      </div>
                    )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function LivePilotTab({ rows }: { rows: SerializedClientRow[] }) {
  const [view, setView] = useState<View>('in-pilot');

  const inPilot = rows.filter((r) => r.isInPilot);
  const postPilot = rows.filter((r) => r.isPastPilot);

  return (
    <div>
      <div className="mb-4">
        <SegmentedControl
          view={view}
          inCount={inPilot.length}
          postCount={postPilot.length}
          onChange={setView}
        />
      </div>
      {view === 'in-pilot' && <InPilotTable rows={inPilot} />}
      {view === 'post-pilot' && <PostPilotTable rows={postPilot} />}
    </div>
  );
}
