'use client';

export function PipeDriveLink({ orgId }: { orgId: number }) {
  return (
    <a
      href={`https://outbound-consulting.pipedrive.com/organization/${orgId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
      style={{ borderRadius: 4 }}
    >
      PD
    </a>
  );
}

export function ChargeOverLink({ customerId }: { customerId: string }) {
  return (
    <a
      href={`https://outbound-consulting.chargeover.com/admin/customer/view/id/${customerId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
      style={{ borderRadius: 4 }}
    >
      CO
    </a>
  );
}
