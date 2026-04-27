// Round 8 diagnostic — uses @prisma/client directly
'use strict';

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
  const today = new Date();
  const todayStart = new Date(today); todayStart.setHours(0,0,0,0);
  const y = today.getFullYear(); // 2026
  const m = today.getMonth();    // 3 = April

  const aprStart = new Date(y, m, 1);
  const aprEnd   = new Date(y, m+1, 0, 23, 59, 59, 999);
  const mayStart = new Date(y, m+1, 1);
  const mayEnd   = new Date(y, m+2, 0, 23, 59, 59, 999);
  const junStart = new Date(y, m+2, 1);
  const junEnd   = new Date(y, m+3, 0, 23, 59, 59, 999);

  // 1. Current: Live + Pre-Launch
  const r1 = await prisma.client.count({
    where: { accountStatus: { in: ['Live', 'Pre-Launch'] }, ...FLOOR9_WHERE },
  });
  console.log('1. Live + Pre-Launch count (current dashboard):', r1);

  // 2. Live-only
  const r2 = await prisma.client.count({
    where: { accountStatus: 'Live', ...FLOOR9_WHERE },
  });
  console.log('2. Live-only count (post-change target):', r2);

  // 3. Status breakdown
  const r3live = await prisma.client.count({
    where: { accountStatus: 'Live', ...FLOOR9_WHERE },
  });
  const r3pre = await prisma.client.count({
    where: { accountStatus: 'Pre-Launch', ...FLOOR9_WHERE },
  });
  console.log('3. Breakdown: Live =', r3live, '| Pre-Launch =', r3pre);

  // 4. Current "Pilots ending in April" — full calendar month Apr 1-30, Live+Pre-Launch
  const r4 = await prisma.client.count({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      pilotRolloverEndDate: { gte: aprStart, lte: aprEnd },
      ...FLOOR9_WHERE,
    },
  });
  console.log('4. Live+Pre-Launch pilots ending in full April 2026:', r4);

  // 4b. Future-only April (>= today, <= Apr 30) — what "pilotsEndingThisMonth" actually computes
  //     given the current code already uses thisMonthStart = Apr 1 (not today)
  //     But let's also check future-only to see if there's a discrepancy
  const r4b = await prisma.client.count({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      pilotRolloverEndDate: { gte: todayStart, lte: aprEnd },
      ...FLOOR9_WHERE,
    },
  });
  console.log(`4b. Live+Pre-Launch pilots ending >= today (${todayStart.toDateString()}) AND <= Apr 30:`, r4b);

  // 5. Live-only full April 2026 (target after change)
  const r5 = await prisma.client.count({
    where: {
      accountStatus: 'Live',
      pilotRolloverEndDate: { gte: aprStart, lte: aprEnd },
      ...FLOOR9_WHERE,
    },
  });
  console.log('5. Live-only pilots ending in full April 2026 (target):', r5);

  // 6. May and June counts (live-only) for reference
  const r6may = await prisma.client.count({
    where: {
      accountStatus: 'Live',
      pilotRolloverEndDate: { gte: mayStart, lte: mayEnd },
      ...FLOOR9_WHERE,
    },
  });
  const r6jun = await prisma.client.count({
    where: {
      accountStatus: 'Live',
      pilotRolloverEndDate: { gte: junStart, lte: junEnd },
      ...FLOOR9_WHERE,
    },
  });
  console.log('6. Live-only pilots ending in May 2026:', r6may, '| June 2026:', r6jun);

  // 7. Current code logic summary
  console.log('\n--- Current code logic for "Pilots ending in [Month]" (getStats()) ---');
  console.log('  Filter universe: accountStatus IN ("Live", "Pre-Launch")');
  console.log('  thisMonthStart = new Date(y, m, 1)  =>', aprStart.toDateString());
  console.log('  thisMonthEnd   = new Date(y, m+1, 0, 23,59,59,999)  =>', aprEnd.toDateString());
  console.log('  pilotsEndingThisMonth: pd >= thisMonthStart && pd <= thisMonthEnd');
  console.log('  => Full calendar month Apr 1-30, NOT future-only filtered.');
  console.log('  Current "Pilots ending in April" KPI = count 4 =', r4);
  console.log('  After Change 1 (Live-only), the April count becomes count 5 =', r5);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
