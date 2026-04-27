/**
 * PipeDrive query functions for the dashboard.
 *
 * "Pilots ending this month" strategy:
 *   PipeDrive maintains filter ID 110 ("Pilot Periods Ending this Month") which
 *   is the exact filter Stephanie uses in her PipeDrive view. Using it directly
 *   means our count always matches hers, and she controls the filter definition.
 *
 * "Pilots ending next month / month after":
 *   Filter 1045 ("Org Pilot Period / Rollover End Date is next month") handles
 *   next month. For month-after-next there is no permanent filter, so we
 *   create a temporary filter with absolute date bounds (POST /filters), fetch
 *   results, and immediately delete the filter. The entire sequence is cached
 *   by Next.js for 60s (same as other PD calls), so it executes at most once
 *   per minute. PipeDrive org counts are 500 total including ~150 active clients.
 *   Note: total PipeDrive org database has 44,000+ records (all historical leads
 *   and prospects), so "fetch all orgs" is NOT viable — filters are required.
 *
 * Filter IDs:
 *   110  = "Pilot Periods Ending this Month"  (maintained by Stephanie)
 *   1045 = "Org Pilot Period / Rollover End Date is next month"
 *
 * PipeDrive field numeric IDs (used in filter conditions):
 *   4034 = Pilot Period / Rollover End Date (hash: 4b1232b5de6ce3803ae1c5b5108df631672f5944)
 */

import {
  pdFetchAll,
  pdBase,
  pdToken,
  PD_FIELDS,
  PD_STATUS_MAP,
  PD_LABELS,
  type PdOrgRaw,
} from './client';

// Pre-Launch status ID — excluded from pilot KPI counts
const PRE_LAUNCH_STATUS_ID = 24;
// Numeric field ID for "Pilot Period / Rollover End Date" (used in dynamic filter conditions)
const PILOT_END_DATE_FIELD_ID = '4034';

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

// ---------------------------------------------------------------------------
// Pilot KPI counts from PipeDrive (for the three stats cards)
// ---------------------------------------------------------------------------

/**
 * Count non-Pre-Launch orgs from a PipeDrive filter.
 * Uses pdFetchAll which handles pagination and Next.js 60s cache.
 */
async function countNonPreLaunchFromFilter(filterId: number): Promise<number> {
  const raws = await pdFetchAll<PdOrgRaw>('/organizations', { filter_id: filterId });
  return raws.filter(raw => {
    const statusId = raw[PD_FIELDS.ACCOUNT_STATUS] as number | null;
    return statusId !== PRE_LAUNCH_STATUS_ID;
  }).length;
}

/**
 * Create a temporary PipeDrive org filter bounded to [firstDay, lastDay] on
 * field 4034 (Pilot Period / Rollover End Date), fetch the non-Pre-Launch count,
 * then immediately delete the filter.
 *
 * This is intentionally NOT cached — POST and DELETE are mutations, and the
 * fetch inside also runs uncached so the temp filter's lifetime is as short as
 * possible. The calling function (getPilotKpiCounts) is invoked from a
 * force-dynamic page so caching at this level is not required.
 */
async function countViaTempFilter(firstDay: string, lastDay: string, label: string): Promise<number> {
  const base = pdBase();
  const tk = pdToken();

  // 1. Create temp filter
  const createRes = await fetch(`${base}/filters?api_token=${tk}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      name: label,
      type: 'org',
      conditions: {
        glue: 'and',
        conditions: [
          {
            glue: 'and',
            conditions: [
              { object: 'organization', field_id: PILOT_END_DATE_FIELD_ID, operator: '>=', extra_value: null, value: firstDay, json_value_flag: false },
              { object: 'organization', field_id: PILOT_END_DATE_FIELD_ID, operator: '<=', extra_value: null, value: lastDay,  json_value_flag: false },
            ],
          },
          { glue: 'or', conditions: [] },
        ],
      },
    }),
  });
  const createJson = await createRes.json() as { success: boolean; data: { id: number } };
  if (!createJson.success) throw new Error(`Failed to create temp PipeDrive filter: ${JSON.stringify(createJson)}`);
  const filterId = createJson.data.id;

  try {
    // 2. Fetch orgs via temp filter (uncached — filter is transient)
    const fetchRes = await fetch(
      `${base}/organizations?filter_id=${filterId}&limit=500&api_token=${tk}`,
      { cache: 'no-store' },
    );
    const fetchJson = await fetchRes.json() as { success: boolean; data: PdOrgRaw[] | null };
    const orgs = fetchJson.data ?? [];
    return orgs.filter(raw => {
      const statusId = raw[PD_FIELDS.ACCOUNT_STATUS] as number | null;
      return statusId !== PRE_LAUNCH_STATUS_ID;
    }).length;
  } finally {
    // 3. Always delete the temp filter (even if fetch threw)
    await fetch(`${base}/filters/${filterId}?api_token=${tk}`, {
      method: 'DELETE',
      cache: 'no-store',
    }).catch(() => { /* best-effort cleanup */ });
  }
}

/**
 * Return the pilot-ending org counts (excluding Pre-Launch) for:
 *   - this month   → filter 110
 *   - next month   → filter 1045
 *   - month+2      → dynamic temp filter (create → fetch → delete)
 */
export async function getPilotKpiCounts(now: Date = new Date()): Promise<{
  thisMonth: number;
  nextMonth: number;
  monthAfterNext: number;
}> {
  const y  = now.getFullYear();
  const m  = now.getMonth() + 1; // 1-based

  // Compute month+2 calendar info
  const m2    = m < 12 ? m + 1 : 1;
  const y2    = m < 12 ? y     : y + 1;
  const m3    = m2 < 12 ? m2 + 1 : 1;
  const y3    = m2 < 12 ? y2    : y2 + 1;
  const m3pad = String(m3).padStart(2, '0');
  const lastDayM3 = new Date(y3, m3, 0).getDate(); // day 0 of next month = last day of this month
  const firstDay  = `${y3}-${m3pad}-01`;
  const lastDay   = `${y3}-${m3pad}-${String(lastDayM3).padStart(2, '0')}`;
  const label     = `TEMP Dashboard: Pilots ${y3}-${m3pad}`;

  const [thisMonth, nextMonth, monthAfterNext] = await Promise.all([
    countNonPreLaunchFromFilter(FILTER_PILOTS_THIS_MONTH),         // filter 110
    countNonPreLaunchFromFilter(1045),                             // filter 1045
    countViaTempFilter(firstDay, lastDay, label),                  // dynamic
  ]);

  return { thisMonth, nextMonth, monthAfterNext };
}
