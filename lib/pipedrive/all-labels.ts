/**
 * Shared Pipedrive label lookup for tabs 1, 3, 4 and Pilot vs Billing.
 *
 * Tab 2 already gets labels via getOrgsWithPilotEndingThisMonth + filter 110.
 * The other tabs read from Neon, which doesn't store label data, so we
 * batch-fetch labels for their orgs by Pipedrive ID and cache the result
 * in-memory for 5 minutes.
 *
 * Fetching by ID (rather than paginating through all 44k PD orgs) keeps the
 * cold-start cost bounded: ~150-200 active client orgs × parallel chunks of 20
 * is a couple of seconds at worst, and subsequent visits hit the cache.
 */

import { pdFetch, PD_LABELS } from './client';

export type LabelInfo = { id: number; name: string; color: string };

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const CHUNK_SIZE = 20;

let cache: { at: number; map: Map<number, LabelInfo[]> } | null = null;

type OrgFetchResult = { data: { id: number; label_ids?: number[] | null } | null };

function labelIdsToInfo(ids: number[] | null | undefined): LabelInfo[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => {
      const def = PD_LABELS[id];
      return def ? { id, name: def.name, color: def.color } : null;
    })
    .filter((l): l is LabelInfo => l !== null);
}

/**
 * Fetch Pipedrive labels for a set of organization IDs.
 * Returns Map<pipedriveOrgId, LabelInfo[]>. Orgs with no labels map to [].
 *
 * Cached for 5 minutes. The cache key is implicit (single map) — callers pass
 * the union of all needed IDs each call. If the cache is fresh, returns it
 * directly without checking which IDs were requested; callers should treat
 * the map as an upper-bound lookup ("if not present, no labels known").
 */
export async function fetchOrgLabelsForIds(ids: number[]): Promise<Map<number, LabelInfo[]>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));
  const map = new Map<number, LabelInfo[]>();

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const json = (await pdFetch(`/organizations/${id}`)) as OrgFetchResult;
          return json?.data ?? null;
        } catch {
          return null;
        }
      }),
    );
    for (const data of results) {
      if (!data) continue;
      map.set(data.id, labelIdsToInfo(data.label_ids));
    }
  }

  cache = { at: Date.now(), map };
  return map;
}

/** Serialize-friendly object form for passing through server -> client component boundary. */
export type LabelsByOrgId = Record<number, LabelInfo[]>;

export function mapToLabelsByOrgId(map: Map<number, LabelInfo[]>): LabelsByOrgId {
  const out: LabelsByOrgId = {};
  map.forEach((v, k) => { out[k] = v; });
  return out;
}
