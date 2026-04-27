'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ACTIVE_STATUSES = ['active','current','trialing','in_trial','live','a'];
const FLOOR9_ENGAGEMENT = ['Floor 9','floor 9','FLOOR 9','Floor9','floor9'];
const FLOOR9_BRAND = [...FLOOR9_ENGAGEMENT,'Floor 9 Ventures','floor 9 ventures','FLOOR 9 VENTURES'];

function nextInvoiceTotal(sub, now) {
  const liArr = sub.lineItems;
  if (!Array.isArray(liArr) || liArr.length === 0) return null;
  const serviceItems = liArr.filter(item => item && item.type !== 'discount');
  if (serviceItems.length === 0) return null;
  const toDay = (raw) => String(raw).split(/[\sT]/)[0];
  const todayUTC = now.toISOString().slice(0, 10);
  let soonestDay = null;
  for (const item of serviceItems) {
    const raw = item.nextBillDate || item.next_bill_date;
    if (!raw) continue;
    const day = toDay(raw);
    if (day > todayUTC && (!soonestDay || day < soonestDay)) soonestDay = day;
  }
  if (!soonestDay) return null;
  let total = 0;
  for (const item of serviceItems) {
    const raw = item.nextBillDate || item.next_bill_date;
    if (!raw || toDay(String(raw)) !== soonestDay) continue;
    const price = item.unitPrice || item.unit_price || 0;
    const qty = item.quantity || item.qty || 1;
    total += price * qty;
  }
  return total > 0 ? { date: soonestDay, amount: total } : null;
}

async function main() {
  const now = new Date();

  // ── Fetch all Live/Pre-Launch clients with FLOOR9 filter ──
  const raw = await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live','Pre-Launch'] },
      AND: [
        { OR: [{ engagementType: null },{ engagementType: { notIn: FLOOR9_ENGAGEMENT } }] },
        { OR: [{ dealType: null },{ dealType: { notIn: FLOOR9_ENGAGEMENT } }] },
        { OR: [{ brandName: null },{ brandName: { notIn: FLOOR9_BRAND } }] },
      ]
    },
    include: { subscriptions: true }
  });

  // Ghost dedup
  const matchedDates = new Set(
    raw.filter(c => c.chargeoverCustomerId && c.actualLaunchDate)
       .map(c => new Date(c.actualLaunchDate).getTime())
  );
  const clients = raw.filter(c => {
    if (!c.chargeoverCustomerId && c.actualLaunchDate)
      return !matchedDates.has(new Date(c.actualLaunchDate).getTime());
    return true;
  });

  console.log('Total clients (FLOOR9 filtered, deduped):', clients.length);

  // ── Compute nextInvoiceTotal + pick largest sub for each client ──
  const results = clients.map(c => {
    const activeSubs = c.subscriptions.filter(s => ACTIVE_STATUSES.includes((s.status||'').toLowerCase()));
    const sortedSubs = activeSubs.slice().sort((a,b) => {
      const aAmt = (nextInvoiceTotal(a, now) || {}).amount || Number(a.amount || 0);
      const bAmt = (nextInvoiceTotal(b, now) || {}).amount || Number(b.amount || 0);
      return bAmt - aAmt;
    });
    const largestSub = sortedSubs[0] || null;
    const nit = largestSub ? nextInvoiceTotal(largestSub, now) : null;
    return {
      name: c.organizationName,
      financeNotes: c.financeNotes,
      nextAmt: nit ? nit.amount : null,
      subAmount: largestSub ? Number(largestSub.amount || 0) : null,
      sub: largestSub
    };
  });

  // ── STEP 1: Distribution ──
  const goldFit    = results.filter(r => r.nextAmt !== null && r.nextAmt >= 2000 && r.nextAmt <= 2075);
  const platFit    = results.filter(r => r.nextAmt !== null && r.nextAmt >= 2500 && r.nextAmt <= 2575);
  const goldPlus   = results.filter(r => r.nextAmt !== null && ((r.nextAmt >= 2200 && r.nextAmt <= 2275) || (r.nextAmt >= 3000 && r.nextAmt <= 3075)));
  const platPlus   = results.filter(r => r.nextAmt !== null && ((r.nextAmt >= 2700 && r.nextAmt <= 2775) || (r.nextAmt >= 3500 && r.nextAmt <= 3575)));
  const legacy     = results.filter(r => r.nextAmt !== null && r.nextAmt < 2000);
  const nullAmt    = results.filter(r => r.nextAmt === null);
  const anomalous  = results.filter(r => {
    const v = r.nextAmt;
    if (v === null) return false;
    if (v >= 2000 && v <= 2075) return false;
    if (v >= 2500 && v <= 2575) return false;
    if ((v >= 2200 && v <= 2275) || (v >= 3000 && v <= 3075)) return false;
    if ((v >= 2700 && v <= 2775) || (v >= 3500 && v <= 3575)) return false;
    if (v < 2000) return false;
    return true;
  });

  function names5(arr) { return arr.slice(0,5).map(r => r.name).join(' | '); }

  console.log('\n=== STEP 1: DISTRIBUTION ===');
  console.log('Gold-fit ($2,000-$2,075):              ' + goldFit.length + '  e.g.: ' + names5(goldFit));
  console.log('Platinum-fit ($2,500-$2,575):          ' + platFit.length + '  e.g.: ' + names5(platFit));
  console.log('Gold+profile ($2,200-$2,275/$3,000-$3,075): ' + goldPlus.length + '  e.g.: ' + names5(goldPlus));
  console.log('Plat+profile ($2,700-$2,775/$3,500-$3,575): ' + platPlus.length + '  e.g.: ' + names5(platPlus));
  console.log('Legacy/under (<$2,000):                ' + legacy.length + '  e.g.: ' + names5(legacy));
  console.log('ANOMALOUS (everything else non-null):  ' + anomalous.length + '  e.g.: ' + names5(anomalous));
  console.log('Null (no future invoice):              ' + nullAmt.length);
  console.log('SUM CHECK (should == total):', goldFit.length + platFit.length + goldPlus.length + platPlus.length + legacy.length + anomalous.length + nullAmt.length);

  // ── STEP 2: Full line-item dump for anomalous clients ──
  console.log('\n\n=== STEP 2: ANOMALOUS CLIENTS - FULL LINE ITEM DUMP ===');
  for (const r of anomalous) {
    console.log('\n--- ' + r.name + ' ---');
    console.log('  financeNotes: ' + JSON.stringify(r.financeNotes));
    console.log('  Subscription.amount: ' + r.subAmount + '  |  nextInvoiceTotal: ' + r.nextAmt);
    if (r.sub && r.sub.lineItems) {
      r.sub.lineItems.forEach((li, i) => {
        console.log('  lineItem[' + i + ']: ' + JSON.stringify(li));
      });
    }
  }

  // ── STEP 3: Named clients ──
  const NAMED_SEARCH = [
    { label: 'atlphantom.com', term: 'atlphantom' },
    { label: 'createethos.com', term: 'createethos' },
    { label: 'Momentum Media Group', term: 'Momentum Media' },
    { label: 'Symmetri Consulting', term: 'Symmetri' },
    { label: 'HCK2 Partners', term: 'HCK2' },
  ];
  console.log('\n\n=== STEP 3: NAMED CLIENTS - FULL LINE ITEM DUMP ===');
  for (const { label, term } of NAMED_SEARCH) {
    const r = results.find(r => r.name && r.name.toLowerCase().includes(term.toLowerCase()));
    if (!r) { console.log('\n--- ' + label + ': NOT FOUND ---'); continue; }
    console.log('\n--- ' + r.name + ' ---');
    console.log('  financeNotes: ' + JSON.stringify(r.financeNotes));
    console.log('  Subscription.amount: ' + r.subAmount + '  |  nextInvoiceTotal: ' + r.nextAmt);
    if (r.sub && r.sub.lineItems) {
      r.sub.lineItems.forEach((li, i) => {
        console.log('  lineItem[' + i + ']: ' + JSON.stringify(li));
      });
    }
  }

  // ── STEP 4: sub.amount vs nextInvoiceTotal comparison ──
  // Named clients + 5 random anomalous
  const step4clients = [
    ...NAMED_SEARCH.map(({ term }) => results.find(r => r.name && r.name.toLowerCase().includes(term.toLowerCase()))).filter(Boolean),
    ...anomalous.slice(0, 5)
  ];
  console.log('\n\n=== STEP 4: sub.amount vs nextInvoiceTotal COMPARISON ===');
  const seen = new Set();
  for (const r of step4clients) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    const diff = r.subAmount !== null && r.nextAmt !== null ? (r.nextAmt - r.subAmount).toFixed(2) : 'N/A';
    const match = r.subAmount === r.nextAmt ? 'MATCH' : 'DIFFER (delta: ' + diff + ')';
    console.log('  ' + r.name + ': sub.amount=' + r.subAmount + '  nextInvoiceTotal=' + r.nextAmt + '  => ' + match);
  }

  // ── STEP 5: Line-item name/type inventory ──
  console.log('\n\n=== STEP 5: LINE ITEM TYPE DISTRIBUTION ===');
  const typeCount = {};
  const nameMap = {};

  for (const c of clients) {
    for (const sub of c.subscriptions) {
      if (!ACTIVE_STATUSES.includes((sub.status||'').toLowerCase())) continue;
      for (const li of (sub.lineItems || [])) {
        const t = li.type || 'NONE';
        typeCount[t] = (typeCount[t] || 0) + 1;
        const nm = li.name || 'UNNAMED';
        if (!nameMap[nm]) nameMap[nm] = { count: 0, totalLineValue: 0, types: new Set(), qtys: [] };
        nameMap[nm].count++;
        nameMap[nm].totalLineValue += (li.unitPrice || 0) * (li.quantity || 1);
        nameMap[nm].types.add(t);
        nameMap[nm].qtys.push(li.quantity || 1);
      }
    }
  }

  Object.entries(typeCount).sort((a,b) => b[1]-a[1]).forEach(([t,c]) => {
    console.log('  type=' + t + ': ' + c + ' occurrences');
  });

  console.log('\n=== STEP 5: LINE ITEM NAMES (by frequency) ===');
  Object.entries(nameMap)
    .sort((a,b) => b[1].count - a[1].count)
    .forEach(([nm, info]) => {
      const avg = Math.round(info.totalLineValue / info.count);
      const minQ = Math.min(...info.qtys);
      const maxQ = Math.max(...info.qtys);
      const qStr = minQ === maxQ ? String(minQ) : minQ + '-' + maxQ;
      const typeStr = [...info.types].join(',');
      console.log('  [' + info.count + '] name=' + JSON.stringify(nm) + ' avg_line_value=$' + avg + ' qty=' + qStr + ' types=' + typeStr);
    });

  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
