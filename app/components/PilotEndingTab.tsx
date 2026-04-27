import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, formatUSDPrecise, relativeDays, daysAgo } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { StatusBadge, PendingBadge } from './StatusBadge';

const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide bg-gray-50 whitespace-nowrap';
const TD = 'px-3 py-2.5 align-top';

export default function PilotEndingTab({ rows }: { rows: SerializedClientRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No pilots ending in the next 10 days.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
            <th className={TH}>Client</th>
            <th className={TH}>Links</th>
            <th className={TH}>Pilot ends</th>
            <th className={TH}>Status</th>
            <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
            <th className={TH}>Last payment</th>
            <th className={TH}>Next payment</th>
            <th className={TH} style={{ textAlign: 'right' }}>Lifetime total</th>
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
              <td className={TD}><StatusBadge status={r.accountStatus} /></td>
              <td className={TD} style={{ textAlign: 'right', fontWeight: 500 }}>
                {r.largestSubAmount !== null ? (
                  <span>{formatUSD(r.largestSubAmount)}<span className="text-gray-400 font-normal">/mo</span></span>
                ) : <span className="text-gray-400">—</span>}
              </td>
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
                {formatUSD(r.lifetimeTotalPaid)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
