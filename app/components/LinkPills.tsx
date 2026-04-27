'use client';

export function PipeDriveLink({ orgId }: { orgId: number }) {
  return (
    <a
      href={`https://outboundconsulting.pipedrive.com/organization/${orgId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        background: 'rgba(148,163,184,0.15)',
        color: '#94a3b8',
        borderRadius: 4,
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.25)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.15)')}
    >
      PD
    </a>
  );
}

export function ChargeOverLink({ customerId }: { customerId: string | null }) {
  if (!customerId) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium cursor-default select-none"
        style={{ background: 'rgba(148,163,184,0.08)', color: '#475569', borderRadius: 4 }}
        title="No ChargeOver ID"
      >
        CO
      </span>
    );
  }
  return (
    <a
      href={`https://outboundconsulting.chargeover.com/admin/r/customer/view/${customerId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        background: 'rgba(148,163,184,0.15)',
        color: '#94a3b8',
        borderRadius: 4,
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.25)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.15)')}
    >
      CO
    </a>
  );
}

export function LinkPills({
  orgId,
  customerId,
}: {
  orgId: number;
  customerId: string | null;
}) {
  return (
    <div className="flex gap-1">
      <PipeDriveLink orgId={orgId} />
      <ChargeOverLink customerId={customerId} />
    </div>
  );
}
