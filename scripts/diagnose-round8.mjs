// Round 8 diagnostic script — uses fetch() against Neon's HTTP API
// Run: node scripts/diagnose-round8.mjs

const DB = "postgresql://neondb_owner:npg_wuCqLOG24Yba@ep-floral-leaf-a42sbvot-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

// Use Prisma's query engine via ts-node would be complex — instead use @vercel/postgres
// Actually let's just use the Prisma binary directly via a tiny prisma script

// We'll use the Neon serverless driver which is already in node_modules
import { neon } from '@neondatabase/serverless';

const sql = neon(DB);

const FLOOR9 = ['Floor 9','floor 9','FLOOR 9','Floor9','floor9'];
const FLOOR9_BRAND = [...FLOOR9, 'Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'];

async function main() {
  const today = new Date().toISOString().slice(0,10);

  // 1. Live + Pre-Launch count
  const r1 = await sql`
    SELECT COUNT(*) AS n FROM "Client"
    WHERE account_status IN ('Live', 'Pre-Launch')
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
  `;
  console.log('1. Live + Pre-Launch count (current dashboard):', r1[0].n);

  // 2. Live-only count
  const r2 = await sql`
    SELECT COUNT(*) AS n FROM "Client"
    WHERE account_status = 'Live'
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
  `;
  console.log('2. Live-only count (post-change target):', r2[0].n);

  // 3. Status breakdown
  const r3 = await sql`
    SELECT account_status, COUNT(*) AS n FROM "Client"
    WHERE account_status IN ('Live', 'Pre-Launch')
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
    GROUP BY account_status
  `;
  console.log('3. Status breakdown:', r3);

  // 4. Current "Pilots ending in April" KPI — full calendar month, Live+Pre-Launch
  const r4 = await sql`
    SELECT COUNT(*) AS n FROM "Client"
    WHERE account_status IN ('Live', 'Pre-Launch')
    AND pilot_rollover_end_date >= '2026-04-01'
    AND pilot_rollover_end_date <  '2026-05-01'
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
  `;
  console.log('4. Live+Pre-Launch with pilot end in full April 2026 (current code range):', r4[0].n);

  // 4b. Future-only April (>= today)
  const r4b = await sql`
    SELECT COUNT(*) AS n FROM "Client"
    WHERE account_status IN ('Live', 'Pre-Launch')
    AND pilot_rollover_end_date >= ${today}
    AND pilot_rollover_end_date <  '2026-05-01'
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
  `;
  console.log(`4b. Live+Pre-Launch with pilot end >= today (${today}) AND < May 1:`, r4b[0].n);

  // 5. Live-only full April 2026 (what it should be post-change)
  const r5 = await sql`
    SELECT COUNT(*) AS n FROM "Client"
    WHERE account_status = 'Live'
    AND pilot_rollover_end_date >= '2026-04-01'
    AND pilot_rollover_end_date <  '2026-05-01'
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_BRAND}))
  `;
  console.log('5. Live-only with pilot end in full April 2026 (target):', r5[0].n);

  // 6. Confirm what the current JS code computes for thisMonthStart
  console.log('\nCurrent code analysis:');
  console.log('  getStats() filters accountStatus IN (Live, Pre-Launch)');
  console.log('  pilotsEndingThisMonth: pd >= thisMonthStart(Apr 1) && pd <= thisMonthEnd(Apr 30)');
  console.log('  => already full-calendar-month, NOT future-only');
  console.log('  So current "Pilots ending in April" KPI = count 4 above');
  console.log('  After change (Live-only) = count 5 above');
}

main().catch(console.error);
