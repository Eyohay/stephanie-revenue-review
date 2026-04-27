'use strict';
const API_TOKEN = 'f9f472580a54916057aa8ac5b3ab3274771182d9';
const DOMAIN = 'outboundconsulting';
const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

const ACCOUNT_STATUS_KEY = '551ee20f027514fdc9cc4126a00df23591cc7c3b';
const PILOT_DATE_KEY = '4b1232b5de6ce3803ae1c5b5108df631672f5944';
const CO_CUSTOMER_KEY = 'e958cfc16fa99acb991b231d042c7af2a07f0163';
const ACCT_MGR_KEY = '9674cb85c589cf19f3fb34ce9b233d049c4bfdbd';

// Account Status enum ID → label map
const STATUS_MAP = {
  22: 'Live', 23: 'Churned', 24: 'Pre-Launch', 48: 'Executed Out',
  200: 'Pause Billing - Active Client',
};

async function main() {
  // 1. Use filter 110 "Pilot Periods Ending this Month"
  const res = await fetch(
    `${BASE}/organizations?filter_id=110&limit=500&api_token=${API_TOKEN}`
  );
  const json = await res.json();
  if (!json.success) { console.error('Error:', json); return; }

  const orgs = json.data ?? [];
  console.log(`\nFilter 110 returned ${orgs.length} orgs\n`);

  // Print each org's key fields
  for (const org of orgs) {
    const statusId = org[ACCOUNT_STATUS_KEY];
    const status = STATUS_MAP[statusId] ?? `id:${statusId}`;
    const pilotDate = org[PILOT_DATE_KEY];
    const coId = org[CO_CUSTOMER_KEY];
    const amUser = org[ACCT_MGR_KEY];
    console.log(`  [${org.id}] "${org.name}" | status=${status} | pilot=${pilotDate} | co=${coId} | am="${amUser?.name ?? '—'}" | labels=${JSON.stringify(org.label_ids)}`);
  }

  // 2. Status breakdown
  const breakdown = {};
  for (const org of orgs) {
    const statusId = org[ACCOUNT_STATUS_KEY];
    const s = STATUS_MAP[statusId] ?? `unknown(${statusId})`;
    breakdown[s] = (breakdown[s] ?? 0) + 1;
  }
  console.log('\nStatus breakdown:', breakdown);

  // 3. Try to fetch label definitions
  const endpoints = [
    '/organizationLabels',
    '/orgLabels',
    '/labels',
    '/organizationCategories',
  ];
  for (const ep of endpoints) {
    const r = await fetch(`${BASE}${ep}?api_token=${API_TOKEN}`);
    const j = await r.json();
    if (j.success && j.data?.length > 0) {
      console.log(`\nLabels from ${ep}:`);
      for (const l of j.data) {
        console.log(`  id=${l.id} name="${l.name}" color="${l.color}"`);
      }
      break;
    }
  }

  // 4. Inspect a sample org with label_ids to understand structure
  const orgWithLabels = orgs.find(o => o.label_ids?.length > 0);
  if (orgWithLabels) {
    console.log('\nSample org with labels:', JSON.stringify({
      id: orgWithLabels.id,
      name: orgWithLabels.name,
      label_ids: orgWithLabels.label_ids,
    }));
  }

  // 5. Look at pagination
  console.log('\nPagination:', JSON.stringify(json.additional_data?.pagination));
}

main().catch(console.error);
