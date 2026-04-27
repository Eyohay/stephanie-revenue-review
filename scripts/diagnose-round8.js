// Round 8 diagnostic script
// Run: node scripts/diagnose-round8.js

const { Client } = require('pg');

const DB = "postgresql://neondb_owner:npg_wuCqLOG24Yba@ep-floral-leaf-a42sbvot-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

const FLOOR9_NAMES = ['Floor 9', 'floor 9', 'FLOOR 9', 'Floor9', 'floor9', 'Floor 9 Ventures', 'floor 9 ventures', 'FLOOR 9 VENTURES'];

async function main() {
  const client = new Client({ connectionString: DB });
  await client.connect();

  // Helper to exclude Floor9
  const floor9Exclude = `
    AND (engagement_type IS NULL OR engagement_type NOT IN (${FLOOR9_NAMES.slice(0,5).map((_, i) => `$${i+1}`).join(',')}))
    AND (deal_type IS NULL OR deal_type NOT IN (${FLOOR9_NAMES.slice(0,5).map((_, i) => `$${i+1}`).join(',')}))
    AND (brand_name IS NULL OR brand_name NOT IN (${FLOOR9_NAMES.map((_, i) => `$${i+1}`).join(',')}))
  `;

  const params = FLOOR9_NAMES;

  // 1. Current dashboard count: Live + Pre-Launch
  const r1 = await client.query(
    `SELECT COUNT(*) FROM "Client"
     WHERE account_status IN ('Live', 'Pre-Launch')
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))`,
    []
  );
  console.log('1. Live + Pre-Launch count (current dashboard):', r1.rows[0].count);

  // 2. Live-only count
  const r2 = await client.query(
    `SELECT COUNT(*) FROM "Client"
     WHERE account_status = 'Live'
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))`,
    []
  );
  console.log('2. Live-only count (post-change target):', r2.rows[0].count);

  // 3. Current pilotsEndingThisMonth: clients with pilotRolloverEndDate in April 2026
  //    from Live+Pre-Launch universe (what the current code computes)
  const r3 = await client.query(
    `SELECT COUNT(*) FROM "Client"
     WHERE account_status IN ('Live', 'Pre-Launch')
     AND pilot_rollover_end_date >= '2026-04-01 00:00:00'
     AND pilot_rollover_end_date <= '2026-04-30 23:59:59'
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))`,
    []
  );
  console.log('3. Live+Pre-Launch with pilotRolloverEndDate in April 2026 (full month):', r3.rows[0].count);

  // 3b. What the current code actually shows: future-only April dates (>= today)
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const r3b = await client.query(
    `SELECT COUNT(*) FROM "Client"
     WHERE account_status IN ('Live', 'Pre-Launch')
     AND pilot_rollover_end_date >= $1
     AND pilot_rollover_end_date <= '2026-04-30 23:59:59'
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))`,
    [`${todayStr} 00:00:00`]
  );
  console.log(`3b. Live+Pre-Launch with pilotRolloverEndDate >= today (${todayStr}) AND <= Apr 30:`, r3b.rows[0].count);

  // 4. Live-only with pilotRolloverEndDate in full April 2026 (what it SHOULD be post-change)
  const r4 = await client.query(
    `SELECT COUNT(*) FROM "Client"
     WHERE account_status = 'Live'
     AND pilot_rollover_end_date >= '2026-04-01 00:00:00'
     AND pilot_rollover_end_date <= '2026-04-30 23:59:59'
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))`,
    []
  );
  console.log('4. Live-only with pilotRolloverEndDate in full April 2026:', r4.rows[0].count);

  // 5. Show pre-launch count breakdown
  const r5 = await client.query(
    `SELECT account_status, COUNT(*) FROM "Client"
     WHERE account_status IN ('Live', 'Pre-Launch')
     AND (engagement_type IS NULL OR engagement_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (deal_type IS NULL OR deal_type NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
     AND (brand_name IS NULL OR brand_name NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))
     GROUP BY account_status`,
    []
  );
  console.log('5. Breakdown by status:', r5.rows);

  // 6. Confirm current code logic for pilotsEndingThisMonth
  console.log('\n6. Current code filter for "Pilots ending in April" KPI (from getStats()):');
  console.log('   thisMonthStart = new Date(y, m, 1)  =>  2026-04-01 00:00:00 local');
  console.log('   thisMonthEnd   = new Date(y, m+1, 0, 23,59,59,999)  =>  2026-04-30 23:59:59 local');
  console.log('   Filter: pd >= thisMonthStart && pd <= thisMonthEnd');
  console.log('   This already covers the FULL calendar month (Apr 1 - Apr 30).');
  console.log('   The difference between count 3 and count 4 is Live vs Live+Pre-Launch universe.');

  await client.end();
}

main().catch(console.error);
