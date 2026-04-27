export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ';
  if (s === 'live') cls += 'bg-green-100 text-green-700';
  else if (s === 'pre-launch') cls += 'bg-blue-100 text-blue-700';
  else cls += 'bg-gray-100 text-gray-600';
  return <span className={cls}>{status}</span>;
}

export function TierBadge({ tier }: { tier: 'Platinum' | 'Gold' | null }) {
  if (!tier) return <span className="text-gray-400">—</span>;
  const cls =
    tier === 'Platinum'
      ? 'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700'
      : 'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800';
  return <span className={cls}>{tier}</span>;
}

export function PendingBadge() {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 ml-1">
      Pending
    </span>
  );
}
