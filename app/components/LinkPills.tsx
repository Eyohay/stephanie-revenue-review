'use client';

export function PipeDriveLink({ orgId }: { orgId: number }) {
  return (
    <a
      href={`https://outboundconsulting.pipedrive.com/organization/${orgId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
      style={{ borderRadius: 4 }}
    >
      PD
    </a>
  );
}

export function ChargeOverLink({ customerId }: { customerId: string | null }) {
  if (!customerId) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-300 cursor-default select-none"
        style={{ borderRadius: 4 }}
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
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
      style={{ borderRadius: 4 }}
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
