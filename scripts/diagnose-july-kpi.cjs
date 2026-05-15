'use strict';
// Diagnose what `Pilots ending in Jul` (KPI card / month-after-next) returns.
// Mirrors lib/pipedrive/queries.ts:countViaTempFilter exactly.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const text = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = loadEnv();
const BASE = `https://${env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1`;
const TK = env.PIPEDRIVE_API_TOKEN;
const PRE_LAUNCH_STATUS_ID = 24;
const PILOT_END_DATE_FIELD_ID = '4034';
const ACCOUNT_STATUS_FIELD_HASH = '551ee20f027514fdc9cc4126a00df23591cc7c3b';

async function diagnose(firstDay, lastDay, label) {
  console.log(`\n=== ${label} (${firstDay} → ${lastDay}) ===`);

  // 1. Create temp filter
  const createBody = {
    name: label,
    type: 'org',
    conditions: {
      glue: 'and',
      conditions: [
        {
          glue: 'and',
          conditions: [
            { object: 'organization', field_id: PILOT_END_DATE_FIELD_ID, operator: '>=', extra_value: null, value: firstDay, json_value_flag: false },
            { object: 'organization', field_id: PILOT_END_DATE_FIELD_ID, operator: '<=', extra_value: null, value: lastDay, json_value_flag: false },
          ],
        },
        { glue: 'or', conditions: [] },
      ],
    },
  };
  const cRes = await fetch(`${BASE}/filters?api_token=${TK}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  const cJson = await cRes.json();
  if (!cJson.success) {
    console.log('CREATE FAILED:', JSON.stringify(cJson).slice(0, 400));
    return;
  }
  const filterId = cJson.data.id;
  console.log(`Created filter ${filterId}`);

  try {
    // 2. Fetch orgs
    const fRes = await fetch(`${BASE}/organizations?filter_id=${filterId}&limit=500&api_token=${TK}`);
    const fJson = await fRes.json();
    if (!fJson.success) {
      console.log('FETCH FAILED:', JSON.stringify(fJson).slice(0, 400));
      return;
    }
    const orgs = fJson.data ?? [];
    const nonPreLaunch = orgs.filter(raw => raw[ACCOUNT_STATUS_FIELD_HASH] !== PRE_LAUNCH_STATUS_ID);
    console.log(`Total orgs returned: ${orgs.length}`);
    console.log(`Non-Pre-Launch count: ${nonPreLaunch.length}`);
    if (orgs.length > 0 && orgs.length <= 10) {
      console.log('Sample:');
      for (const o of orgs) {
        const pilotEnd = o['4b1232b5de6ce3803ae1c5b5108df631672f5944'];
        const statusId = o[ACCOUNT_STATUS_FIELD_HASH];
        console.log(`  - ${o.name} (pilot end ${pilotEnd}, status ${statusId})`);
      }
    }
  } finally {
    // 3. Delete temp filter
    await fetch(`${BASE}/filters/${filterId}?api_token=${TK}`, { method: 'DELETE' }).catch(() => {});
    console.log(`Deleted filter ${filterId}`);
  }
}

(async () => {
  // Run all three KPI months for context
  await diagnose('2026-05-01', '2026-05-31', 'May 2026 (this month, via temp filter)');
  await diagnose('2026-06-01', '2026-06-30', 'Jun 2026 (next month, via temp filter)');
  await diagnose('2026-07-01', '2026-07-31', 'Jul 2026 (month-after-next — what Stephanie sees as July)');
  await diagnose('2026-08-01', '2026-08-31', 'Aug 2026 (control — should look similar to July if July is legit-empty)');
})().catch(e => { console.error(e); process.exit(1); });
