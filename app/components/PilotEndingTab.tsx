import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, relativeDays } from '@/lib/format';
import { PipeDriveLink, ChargeOverLink } from './LinkPills';
import { StatusBadge, PendingBadge } from './StatusBadge';

const TH = 'px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap';
const TD = 'px-3 py-2 align-top';
const BORDER = { borderColor: 'var(--color-border-tertiary)', borderWidth: '0.5px' };

export default function PilotEndingTab({ rows }: { rows: SerializedClientRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No pilots ending in the next 7 days.
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
            <th className={TH}>Subscription</th>
            <th className={TH}>Last payment</th>
            <th className={TH}>Next payment</th>
            <th className={TH} style={{ textAlign: 'right' }}>Lifetime total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
              <td className={TD}>
                {r.pilotRolloverEndDate ? (
                  <div>
                    <div>{formatDate(r.pilotRolloverEndDate)}</div>
                    <div className="text-gray-400 text-[11px]">{relativeDays(r.pilotRolloverEndDate)}</div>
                  </div>
                ) : '—'}
              </td>
              <td className={TD}><StatusBadge status={r.accountStatus} /></td>
              <td className={TD}>
                {r.largestSubAmount !== null ? (
                  <div>
                    {r.largestSubProductName && (
                      <div className="text-gray-600">{r.largestSubProductName}</div>
                    )}
                    <div className="font-medium">{formatUSD(r.largestSubAmount)}<span className="text-gray-400 font-normal">/mo</span></div>
                  </div>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className={TD}>
                {r.lastPaymentDate ? (
                  <div>
                    <div>{formatDate(r.lastPaymentDate)}{r.lastPaymentPending && <PendingBadge />}</div>
                    <div className="text-gray-500">{formatUSD(r.lastPaymentAmount)}</div>
                  </div>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className={TD}>
                {r.nextPaymentDate ? (
                  <div>
                    <div>{formatDate(r.nextPaymentDate)}</div>
                    <div className="text-gray-500">{formatUSD(r.nextPaymentAmount)}</div>
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
