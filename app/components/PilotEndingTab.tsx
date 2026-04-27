import { type SerializedClientRow } from '@/lib/query';
import { formatDate, formatUSD, formatUSDPrecise, relativeDays, daysAgo } from '@/lib/format';
import { LinkPills } from './LinkPills';
import { TierBadge, PendingBadge, PaidUpfrontBadge } from './StatusBadge';

const TH_STYLE: React.CSSProperties = {
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
};
const TD = 'px-3 py-2.5 align-top';

export default function PilotEndingTab({ rows }: { rows: SerializedClientRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No pilots ending in the next 10 days.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={TH_STYLE}>Client</th>
            <th style={TH_STYLE}>Links</th>
            <th style={TH_STYLE}>Pilot ends</th>
            <th style={TH_STYLE}>Tier</th>
            <th style={{ ...TH_STYLE, textAlign: 'right' }}>Monthly amount</th>
            <th style={TH_STYLE}>Last payment</th>
            <th style={TH_STYLE}>Next payment</th>
            <th style={{ ...TH_STYLE, textAlign: 'right' }}>Lifetime total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
              <td className={TD}>
                {r.pilotRolloverEndDate ? (
                  <div>
                    <div className="font-medium" style={{ color: 'var(--foreground)' }}>{formatDate(r.pilotRolloverEndDate)}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{relativeDays(r.pilotRolloverEndDate)}</div>
                  </div>
                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td className={TD}><TierBadge tier={r.tier} /></td>
              <td className={TD} style={{ textAlign: 'right' }}>
                {r.monthlyRetainer !== null ? (
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                      {formatUSD(r.monthlyRetainer)}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span>
                    </span>
                    {r.paidUpfront && <PaidUpfrontBadge />}
                  </div>
                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td className={TD}>
                {r.lastPaymentDate ? (
                  <div>
                    <div className="flex items-center gap-1">
                      <span style={{ color: 'var(--foreground)' }}>{formatDate(r.lastPaymentDate)}</span>
                      {r.lastPaymentPending && <PendingBadge />}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {formatUSDPrecise(r.lastPaymentAmount)} · {daysAgo(r.lastPaymentDate)}
                    </div>
                  </div>
                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td className={TD}>
                {r.nextPaymentDate ? (
                  <div>
                    <div style={{ color: 'var(--foreground)' }}>{formatDate(r.nextPaymentDate)}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {formatUSDPrecise(r.nextPaymentAmount)} · {daysAgo(r.nextPaymentDate)}
                    </div>
                  </div>
                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td className={TD} style={{ textAlign: 'right', fontWeight: 500, color: 'var(--foreground)' }}>
                {formatUSD(r.lifetimeTotalPaid)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
