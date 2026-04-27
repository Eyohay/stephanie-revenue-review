'use strict';
// Prisma stores columns as camelCase in Postgres (no @map), so raw SQL uses "accountStatus" etc.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FLOOR9 = ['Floor 9','floor 9','FLOOR 9','Floor9','floor9'];
const FLOOR9_BRAND = [...FLOOR9, 'Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'];
const FLOOR9_WHERE = {
  AND: [
    { OR: [{ engagementType: null }, { engagementType: { notIn: FLOOR9 } }] },
    { OR: [{ dealType: null }, { dealType: { notIn: FLOOR9 } }] },
    { OR: [{ brandName: null }, { brandName: { notIn: FLOOR9_BRAND } }] },
  ],
};

async function main() {
  // 1. All distinct accountStatus values with counts (unfiltered)
  const allStatuses = await prisma.$queryRaw`
    SELECT "accountStatus", COUNT(*)::int AS n
    FROM "Client"
    GROUP BY "accountStatus"
    ORDER BY n DESC
  `;
  console.log('\n1. All distinct accountStatus values (entire table, no floor9 filter):');
  for (const r of allStatuses) {
    console.log(`   "${r.accountStatus}" => ${r.n}`);
  }

  // 2. Same but Floor9 excluded using Prisma's groupBy
  const filteredStatuses = await prisma.client.groupBy({
    by: ['accountStatus'],
    where: FLOOR9_WHERE,
    _count: { accountStatus: true },
    orderBy: { _count: { accountStatus: 'desc' } },
  });
  console.log('\n2. accountStatus counts (Floor9 excluded):');
  for (const r of filteredStatuses) {
    console.log(`   "${r.accountStatus}" => ${r._count.accountStatus}`);
  }

  // 3. Exact spellings for churn/exec/cancel/term
  const churnedLike = await prisma.$queryRaw`
    SELECT DISTINCT "accountStatus" FROM "Client"
    WHERE LOWER("accountStatus") LIKE '%churn%'
       OR LOWER("accountStatus") LIKE '%exec%'
       OR LOWER("accountStatus") LIKE '%cancel%'
       OR LOWER("accountStatus") LIKE '%term%'
  `;
  console.log('\n3. Exact spelling of churn/exec/cancel/term variants:');
  for (const r of churnedLike) console.log(`   "${r.accountStatus}"`);

  // 4. All non-Live, non-Pre-Launch statuses
  const nonLive = await prisma.$queryRaw`
    SELECT DISTINCT "accountStatus" FROM "Client"
    WHERE "accountStatus" != 'Live'
      AND "accountStatus" != 'Pre-Launch'
    ORDER BY "accountStatus"
  `;
  console.log('\n4. All non-Live, non-Pre-Launch distinct statuses:');
  for (const r of nonLive) console.log(`   "${r.accountStatus}"`);

  // 5. April 2026 pilot counts by status (Floor9 excluded)
  const aprPilots = await prisma.$queryRaw`
    SELECT c."accountStatus", COUNT(*)::int AS n
    FROM "Client" c
    WHERE c."pilotRolloverEndDate" >= '2026-04-01'
      AND c."pilotRolloverEndDate" <  '2026-05-01'
      AND (c."engagementType" IS NULL OR c."engagementType" NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
      AND (c."dealType" IS NULL OR c."dealType" NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9'))
      AND (c."brandName" IS NULL OR c."brandName" NOT IN ('Floor 9','floor 9','FLOOR 9','Floor9','floor9','Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'))
    GROUP BY c."accountStatus"
    ORDER BY n DESC
  `;
  console.log('\n5. April 2026 pilot counts by accountStatus (Floor9 excluded):');
  for (const r of aprPilots) console.log(`   "${r.accountStatus}" => ${r.n}`);
  const aprilTotal = aprPilots.reduce((s, r) => s + r.n, 0);
  console.log('   TOTAL:', aprilTotal);

  // 6. Total Live + Churned + Executed Out count (using whatever spellings exist)
  // Get all non-Pre-Launch statuses first
  const nonPreLaunch = (filteredStatuses)
    .filter(r => r.accountStatus !== 'Pre-Launch')
    .map(r => r.accountStatus);
  console.log('\n6. Statuses included in new filter (non-Pre-Launch):', nonPreLaunch);
  const newTotal = filteredStatuses
    .filter(r => r.accountStatus !== 'Pre-Launch')
    .reduce((s, r) => s + r._count.accountStatus, 0);
  console.log('   New "Current clients" total:', newTotal);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
