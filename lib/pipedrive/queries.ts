/**
 * PipeDrive query functions for the dashboard.
 *
 * "Pilots ending this month" strategy:
 *   PipeDrive maintains filter ID 110 ("Pilot Periods Ending this Month") which
 *   is the exact filter Stephanie uses in her PipeDrive view. Using it directly
 *   means our count always matches hers, and she controls the filter definition.
 *
 *   We use GET /organizations?filter_id=110 rather than building a custom date
 *   range filter because:
 *     1. The existing filter is maintained and trusted by the team
 *     2. ~150 total orgs means pagination is trivial (one page at 500 limit)
 *     3. PipeDrive's custom-field date-range filter syntax requires POST /filters
 *        which is stateful and harder to clean up
 */

import {
  pdFetchAll,
  PD_FIELDS,
  PD_STATUS_MAP,
  PD_LABELS,
  type PdOrgRaw,
} from './client';

export type PdOrg = {
  pipedriveOrgId: number;
  organizationName: string;
  accountStatus: string;
  accountManager: string | null;
  chargeoverCustomerId: string | null;
  pilotRolloverEndDate: string | null;   // ISO date string "YYYY-MM-DD" or null
  labels: { id: number; name: string; color: string }[];
};

// Filter IDs in PipeDrive:
//   110 = "Pilot Periods Ending this Month"
const FILTER_PILOTS_THIS_MONTH = 110;

function parseOrg(raw: PdOrgRaw): PdOrg {
  const statusId = raw[PD_FIELDS.ACCOUNT_STATUS] as number | null;
  const accountStatus = statusId != null ? (PD_STATUS_MAP[statusId] ?? `Status:${statusId}`) : 'Unknown';

  const coRaw = raw[PD_FIELDS.CHARGEOVER_ID] as number | string | null;
  const chargeoverCustomerId = coRaw != null && coRaw !== '' && coRaw !== 0
    ? String(Math.round(Number(coRaw)))   // stored as double in PD (e.g. 2613.0) → "2613"
    : null;

  const amRaw = raw[PD_FIELDS.ACCOUNT_MANAGER] as { name?: string } | null;
  const accountManager = amRaw?.name ?? null;

  const pilotRaw = raw[PD_FIELDS.PILOT_END_DATE] as string | null;
  const pilotRolloverEndDate = pilotRaw ?? null;   // already "YYYY-MM-DD" from PD

  const labelIds: number[] = Array.isArray(raw.label_ids) ? raw.label_ids : [];
  const labels = labelIds
    .map(id => {
      const def = PD_LABELS[id];
      return def ? { id, name: def.name, color: def.color } : null;
    })
    .filter((l): l is { id: number; name: string; color: string } => l !== null);

  return {
    pipedriveOrgId: raw.id,
    organizationName: raw.name,
    accountStatus,
    accountManager,
    chargeoverCustomerId,
    pilotRolloverEndDate,
    labels,
  };
}

/**
 * Fetch all organizations from PipeDrive's "Pilot Periods Ending this Month"
 * filter (filter_id=110). Returns parsed org rows.
 *
 * Pre-Launch orgs are included in the filter definition — we don't strip them
 * here because the filter itself is Stephanie's source of truth. The UI can
 * choose to badge/highlight them differently.
 */
export async function getOrgsWithPilotEndingThisMonth(): Promise<PdOrg[]> {
  const raws = await pdFetchAll<PdOrgRaw>(
    '/organizations',
    { filter_id: FILTER_PILOTS_THIS_MONTH },
  );

  return raws
    .map(parseOrg)
    .sort((a, b) => {
      if (!a.pilotRolloverEndDate) return 1;
      if (!b.pilotRolloverEndDate) return -1;
      return a.pilotRolloverEndDate.localeCompare(b.pilotRolloverEndDate);
    });
}
