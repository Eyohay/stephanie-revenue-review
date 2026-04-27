import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, relativeDays, monthsApart } from '@/lib/format';
import { PipeDriveLink, ChargeOverLink } from './LinkPills';
import { TierBadge, PendingBadge } from './StatusBadge';

const TH = 'px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap';
const TD = 'px-3 py-2 align-top';

function SubSection({
  title,
  rows,
  showMonthsOut,
}: {
  title: string;
  rows: SerializedClientRow[];
  showMonthsOut: boolean;
}) {
  const now = new Date();

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-gray-700 mb-2 px-1">
        {title} <span className="font-normal text-gray-400">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400 px-1 py-4">None.</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border-tertiary)' }}>
          <table className="w-full border-collapse" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <th className={TH}>Client</th>
                <th className={TH}>Links</th>
                <th className={TH}>{showMonthsOut ? 'Pilot ended' : 'Pilot ends'}</th>
                {showMonthsOut && <th className={TH}>Months out</th>}
                <th className={TH}>Tier</th>
                <th className={TH} style={{ textAlign: 'center' }}>Subs</th>
                <th className={TH}>Last payment</th>
                <th className={TH}>Next payment</th>
                <th className={TH} style={{ textAlign: 'right' }}>Monthly amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mo = showMonthsOut && r.pilotRolloverEndDate
                  ? monthsApart(r.pilotRolloverEndDate, now)
                  : null;
                return (
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
                    {showMonthsOut && (
                      <td className={TD} style={{ fontWeight: 500 }}>
                        {mo !== null ? `${mo}` : '—'}
                      </td>
                    )}
                    <td className={TD}><TierBadge tier={r.tier} /></td>
                    <td className={TD} style={{ textAlign: 'center' }}>{r.activeSubscriptionCount}</td>
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
                      {r.largestSubAmount !== null ? formatUSD(r.largestSubAmount) : '—'}
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
}

export default function LivePilotTab({ rows }: { rows: SerializedClientRow[] }) {
  const inPilot = rows
    .filter((r) => r.isInPilot)
    .sort((a, b) => {
      if (!a.pilotRolloverEndDate) return 1;
      if (!b.pilotRolloverEndDate) return -1;
      return new Date(a.pilotRolloverEndDate).getTime() - new Date(b.pilotRolloverEndDate).getTime();
    });

  const postPilot = rows
    .filter((r) => r.isPastPilot)
    .sort((a, b) => {
      if (!a.pilotRolloverEndDate) return 1;
      if (!b.pilotRolloverEndDate) return -1;
      return new Date(a.pilotRolloverEndDate).getTime() - new Date(b.pilotRolloverEndDate).getTime();
    });

  return (
    <div>
      <SubSection title="In pilot" rows={inPilot} showMonthsOut={false} />
      <SubSection title="Post-pilot" rows={postPilot} showMonthsOut={true} />
    </div>
  );
}
