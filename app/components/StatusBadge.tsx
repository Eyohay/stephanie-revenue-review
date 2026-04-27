export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let style: React.CSSProperties;
  if (s === 'live') {
    style = { background: 'rgba(16,185,129,0.15)', color: '#34d399' };
  } else if (s === 'pre-launch') {
    style = { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' };
  } else if (s === 'executed out') {
    style = { background: 'rgba(168,85,247,0.15)', color: '#c084fc' };
  } else {
    style = { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  }
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={style}
    >
      {status}
    </span>
  );
}

export function TierBadge({ tier }: { tier: 'Platinum' | 'Gold' | 'Custom' | null }) {
  if (!tier) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  let style: React.CSSProperties;
  if (tier === 'Platinum') {
    style = { background: 'rgba(148,163,184,0.2)', color: '#cbd5e1' };
  } else if (tier === 'Gold') {
    style = { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' };
  } else {
    style = { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' };
  }
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={style}
    >
      {tier}
    </span>
  );
}

export function PendingBadge() {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ml-1"
      style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}
    >
      Pending
    </span>
  );
}

export function PaidUpfrontBadge() {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ml-1"
      style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}
    >
      Paid upfront
    </span>
  );
}

/**
 * Muted informational badge for grandfathered / legacy-priced clients.
 * Shown when sub.amount > 0 but < $2,000 (below current Gold tier floor).
 * NOT an error — just a flag so Stephanie knows this client is grandfathered.
 */
export function LegacyPricingBadge() {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ml-1"
      style={{ background: 'rgba(100,116,139,0.2)', color: '#94a3b8' }}
      title="Below standard $2,000 Gold tier — likely grandfathered or downgraded."
    >
      Legacy pricing
    </span>
  );
}

/** Amber dotted-border variant — paid-upfront inferred from qty>1 structure, not confirmed in PipeDrive */
export function LikelyPaidUpfrontBadge() {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ml-1"
      style={{
        background: 'transparent',
        color: '#fbbf24',
        border: '1px dashed #fbbf24',
      }}
      title="Inferred from payment ratio — verify in PipeDrive"
    >
      Paid upfront?
    </span>
  );
}
