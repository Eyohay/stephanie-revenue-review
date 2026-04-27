'use client';

import { useState } from 'react';
import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, formatUSDPrecise, relativeDays, daysAgo, monthsApart } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { TierBadge, PendingBadge } from './StatusBadge';

const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide bg-gray-50 whitespace-nowrap';
const TD = 'px-3 py-2.5 align-top';

type View = 'in-pilot' | 'post-pilot';

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
    <div className="inline-flex rounded-full bg-gray-100 p-0.5 gap-0.5">
      <button
        onClick={() => onChange('in-pilot')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          view === 'in-pilot'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        In pilot ({inCount})
      </button>
      <button
        onClick={() => onChange('post-pilot')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          view === 'post-pilot'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Post-pilot ({postCount})
      </button>
    </div>
  );
}

function InPilotTable({ rows }: { rows: SerializedClientRow[] }) {
  if (rows.length === 0) return <div className="text-center py-8 text-gray-400 text-sm">No clients in pilot.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
            <th className={TH}>Client</th>
            <th className={TH}>Links</th>
            <th className={TH}>Pilot ends</th>
            <th className={TH}>Tier</th>
            <th className={TH} style={{ textAlign: 'center' }}>Subs</th>
            <th className={TH}>Last payment</th>
            <th className={TH}>Next payment</th>
            <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ '--tw-divide-color': 'var(--color-border-tertiary)' } as React.CSSProperties}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className={TD} style={{ fontWeight: 500 }}>{r.organizationName}</td>
              <td className={TD}>
                <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
              </td>
              <td className={TD}>
                {r.pilotRolloverEndDate ? (
                  <div>
                    <div className="font-medium">{formatDate(r.pilotRolloverEndDate)}</div>
                    <div className="text-gray-400 text-[11px]">{relativeDays(r.pilotRolloverEndDate)}</div>
                  </div>
                ) : '—'}
              </td>
              <td className={TD}><TierBadge tier={r.tier} /></td>
              <td className={TD} style={{ textAlign: 'center' }}>{r.activeSubscriptionCount}</td>
              <td className={TD}>
                {r.lastPaymentDate ? (
                  <div>
                    <div className="flex items-center gap-1">
                      <span>{formatDate(r.lastPaymentDate)}</span>
                      {r.lastPaymentPending && <PendingBadge />}
                    </div>
                    <div className="text-gray-400 text-[11px]">
                      {formatUSDPrecise(r.lastPaymentAmount)} · {daysAgo(r.lastPaymentDate)}
                    </div>
                  </div>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className={TD}>
                {r.nextPaymentDate ? (
                  <div>
                    <div>{formatDate(r.nextPaymentDate)}</div>
                    <div className="text-gray-400 text-[11px]">
                      {formatUSDPrecise(r.nextPaymentAmount)} · {daysAgo(r.nextPaymentDate)}
                    </div>
                  </div>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className={TD} style={{ textAlign: 'right', fontWeight: 500 }}>
                {r.largestSubAmount !== null ? formatUSD(r.largestSubAmount) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PostPilotTable({ rows }: { rows: SerializedClientRow[] }) {
  const now = new Date();
  if (rows.length === 0) return <div className="text-center py-8 text-gray-400 text-sm">No post-pilot clients.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
            <th className={TH}>Client</th>
            <th className={TH}>Links</th>
            <th className={TH}>Pilot ended</th>
            <th className={TH}>Months since pilot ended</th>
            <th className={TH}>Tier</th>
            <th className={TH} style={{ textAlign: 'center' }}>Subs</th>
            <th className={TH}>Last payment</th>
            <th className={TH}>Next payment</th>
            <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ '--tw-divide-color': 'var(--color-border-tertiary)' } as React.CSSProperties}>
          {rows.map((r) => {
            const mo = r.pilotRolloverEndDate ? monthsApart(r.pilotRolloverEndDate, now) : null;
            return (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className={TD} style={{ fontWeight: 500 }}>{r.organizationName}</td>
                <td className={TD}>
                  <LinkPills orgId={r.pipedriveOrgId} customerId={r.chargeoverCustomerId} />
                </td>
                <td className={TD}>
                  {r.pilotRolloverEndDate ? (
                    <div>
                      <div className="font-medium">{formatDate(r.pilotRolloverEndDate)}</div>
                      <div className="text-gray-400 text-[11px]">{relativeDays(r.pilotRolloverEndDate)}</div>
                    </div>
                  ) : '—'}
                </td>
                <td className={TD} style={{ fontWeight: 500 }}>
                  {mo !== null ? mo : '—'}
                </td>
                <td className={TD}><TierBadge tier={r.tier} /></td>
                <td className={TD} style={{ textAlign: 'center' }}>{r.activeSubscriptionCount}</td>
                <td className={TD}>
                  {r.lastPaymentDate ? (
                    <div>
                      <div className="flex items-center gap-1">
                        <span>{formatDate(r.lastPaymentDate)}</span>
                        {r.lastPaymentPending && <PendingBadge />}
                      </div>
                      <div className="text-gray-400 text-[11px]">
                        {formatUSDPrecise(r.lastPaymentAmount)} · {daysAgo(r.lastPaymentDate)}
                      </div>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className={TD}>
                  {r.nextPaymentDate ? (
                    <div>
                      <div>{formatDate(r.nextPaymentDate)}</div>
                      <div className="text-gray-400 text-[11px]">
                        {formatUSDPrecise(r.nextPaymentAmount)} · {daysAgo(r.nextPaymentDate)}
                      </div>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className={TD} style={{ textAlign: 'right', fontWeight: 500 }}>
                  {r.largestSubAmount !== null ? formatUSD(r.largestSubAmount) : '—'}
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

  const inPilot = [...rows.filter((r) => r.isInPilot)].sort((a, b) => {
    if (!a.pilotRolloverEndDate) return 1;
    if (!b.pilotRolloverEndDate) return -1;
    return new Date(a.pilotRolloverEndDate).getTime() - new Date(b.pilotRolloverEndDate).getTime();
  });

  const postPilot = [...rows.filter((r) => r.isPastPilot)].sort((a, b) => {
    if (!a.pilotRolloverEndDate) return 1;
    if (!b.pilotRolloverEndDate) return -1;
    return new Date(a.pilotRolloverEndDate).getTime() - new Date(b.pilotRolloverEndDate).getTime();
  });

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
