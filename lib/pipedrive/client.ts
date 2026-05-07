/**
 * PipeDrive API v1 client
 *
 * Field hash keys discovered via GET /organizationFields (scripts/discover-pd-fields.cjs):
 *   Pilot Period / Rollover End Date  → 4b1232b5de6ce3803ae1c5b5108df631672f5944  (date)
 *   Account Status                    → 551ee20f027514fdc9cc4126a00df23591cc7c3b  (enum)
 *   Chargeover Customer #             → e958cfc16fa99acb991b231d042c7af2a07f0163  (double)
 *   Account Manager                   → 9674cb85c589cf19f3fb34ce9b233d049c4bfdbd  (user)
 *   Kick-Off Call                     → ad398edd01666a9973599bd41fa63b0f8ff575b9  (date)
 *
 * Account Status enum (id → label):
 *   22 → Live, 23 → Churned, 24 → Pre-Launch, 48 → Executed Out,
 *   200 → Pause Billing - Active Client
 *
 * Organization label options (from label_ids field in organizationFields):
 *   94  Struggling Account       red
 *   95  Disengaged Account       pink
 *   96  Top Performing Account   green
 *   98  Rolled Over              green
 *   99  Potential Content Upsell blue
 *   106 Potential Rollover       purple
 *   109 BD Upsell Candidate      blue
 *   113 $500 Candidate           gray
 *   130 Thought Leadership Prog  yellow
 *   142 $1,000 CANDIDATE         dark-gray
 *   149 First 45 Days            purple
 *   194 Dead / offboarded        dark-gray
 *   198 Upgraded to Platinum     orange
 *   199 6 month extention        yellow
 *   210 2x Linkedin Profiles     yellow
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const PD_FIELDS = {
  PILOT_END_DATE:    '4b1232b5de6ce3803ae1c5b5108df631672f5944',
  ACCOUNT_STATUS:    '551ee20f027514fdc9cc4126a00df23591cc7c3b',
  CHARGEOVER_ID:     'e958cfc16fa99acb991b231d042c7af2a07f0163',
  ACCOUNT_MANAGER:   '9674cb85c589cf19f3fb34ce9b233d049c4bfdbd',
  KICK_OFF_CALL:     'ad398edd01666a9973599bd41fa63b0f8ff575b9',
} as const;

export const PD_STATUS_MAP: Record<number, string> = {
  22: 'Live',
  23: 'Churned',
  24: 'Pre-Launch',
  48: 'Executed Out',
  200: 'Pause Billing - Active Client',
};

// PipeDrive color names → CSS hex values for dark-mode display
export const PD_LABEL_COLORS: Record<string, string> = {
  red:       '#f87171',
  pink:      '#f472b6',
  green:     '#4ade80',
  blue:      '#60a5fa',
  purple:    '#c084fc',
  yellow:    '#fbbf24',
  orange:    '#fb923c',
  gray:      '#94a3b8',
  'dark-gray': '#64748b',
};

export const PD_LABELS: Record<number, { name: string; color: string }> = {
  94:  { name: 'Struggling Account',       color: 'red'      },
  95:  { name: 'Disengaged Account',       color: 'pink'     },
  96:  { name: 'Top Performing Account',   color: 'green'    },
  98:  { name: 'Rolled Over',              color: 'green'    },
  99:  { name: 'Potential Content Upsell', color: 'blue'     },
  106: { name: 'Potential Rollover',       color: 'purple'   },
  109: { name: 'BD Upsell Candidate',      color: 'blue'     },
  113: { name: '$500 Candidate',           color: 'gray'     },
  130: { name: 'Thought Leadership Prog',  color: 'yellow'   },
  142: { name: '$1,000 Candidate',         color: 'dark-gray'},
  149: { name: 'First 45 Days',            color: 'purple'   },
  194: { name: 'Dead / offboarded',        color: 'dark-gray'},
  198: { name: 'Upgraded to Platinum',     color: 'orange'   },
  199: { name: '6 month extension',        color: 'yellow'   },
  210: { name: '2x LinkedIn Profiles',     color: 'yellow'   },
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
export function pdBase(): string {
  const domain = process.env.PIPEDRIVE_COMPANY_DOMAIN;
  if (!domain) throw new Error('PIPEDRIVE_COMPANY_DOMAIN is not set');
  return `https://${domain}.pipedrive.com/api/v1`;
}

export function pdToken(): string {
  const t = process.env.PIPEDRIVE_API_TOKEN;
  if (!t) throw new Error('PIPEDRIVE_API_TOKEN is not set');
  return t;
}

export async function pdFetch(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const url = new URL(`${pdBase()}${path}`);
  url.searchParams.set('api_token', pdToken());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    const res = await fetch(url.toString(), {
      next: { revalidate: 60 },    // Next.js cache — refresh every 60s
    });
    if (res.status === 429) {
      lastErr = new Error('PipeDrive rate limited (429)');
      continue;
    }
    if (!res.ok) throw new Error(`PipeDrive ${res.status} on ${path}`);
    const json = await res.json() as { success: boolean; data: unknown; additional_data?: { pagination?: { more_items_in_collection?: boolean; start?: number; limit?: number } } };
    if (!json.success) throw new Error(`PipeDrive API error on ${path}: ${JSON.stringify(json)}`);
    return json;
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Paginated fetch — collects all pages into a single array
// ---------------------------------------------------------------------------
export async function pdFetchAll<T>(
  path: string,
  baseParams: Record<string, string | number> = {},
  limit = 500,
): Promise<T[]> {
  const results: T[] = [];
  let start = 0;

  while (true) {
    const json = await pdFetch(path, { ...baseParams, start, limit }) as {
      data: T[] | null;
      additional_data?: { pagination?: { more_items_in_collection?: boolean } };
    };
    const page = json.data ?? [];
    results.push(...page);

    const hasMore = json.additional_data?.pagination?.more_items_in_collection;
    if (!hasMore || page.length === 0) break;
    start += page.length;
  }

  return results;
}

// ---------------------------------------------------------------------------
// PipeDrive org shape (raw)
// ---------------------------------------------------------------------------
export type PdOrgRaw = {
  id: number;
  name: string;
  label_ids: number[];
  [key: string]: unknown; // custom fields by hash key
};
