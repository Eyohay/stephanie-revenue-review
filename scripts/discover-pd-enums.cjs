'use strict';
const API_TOKEN = 'f9f472580a54916057aa8ac5b3ab3274771182d9';
const DOMAIN = 'outboundconsulting';
const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

const ACCOUNT_STATUS_KEY = '551ee20f027514fdc9cc4126a00df23591cc7c3b';
const PILOT_DATE_KEY = '4b1232b5de6ce3803ae1c5b5108df631672f5944';
const CO_CUSTOMER_KEY = 'e958cfc16fa99acb991b231d042c7af2a07f0163';
const ACCT_MGR_KEY = '9674cb85c589cf19f3fb34ce9b233d049c4bfdbd';

async function main() {
  // 1. Get Account Status enum options
  const fieldsRes = await fetch(`${BASE}/organizationFields?api_token=${API_TOKEN}&limit=200`);
  const fieldsJson = await fieldsRes.json();
  const statusField = fieldsJson.data.find(f => f.key === ACCOUNT_STATUS_KEY);
  console.log('\nAccount Status enum options:');
  for (const opt of (statusField?.options ?? [])) {
    console.log(`  id=${opt.id} label="${opt.label}"`);
  }

  // 2. Get organization labels (GET /organizationLabels or /labels)
  const labelsRes = await fetch(`${BASE}/organizationLabels?api_token=${API_TOKEN}`);
  const labelsJson = await labelsRes.json();
  if (labelsJson.success) {
    console.log('\nOrganization labels:');
    for (const l of (labelsJson.data ?? [])) {
      console.log(`  id=${l.id} name="${l.name}" color="${l.color}"`);
    }
  } else {
    // Try /labels
    const l2Res = await fetch(`${BASE}/labels?entity=organization&api_token=${API_TOKEN}`);
    const l2Json = await l2Res.json();
    console.log('\nLabels (alt endpoint):', JSON.stringify(l2Json).slice(0, 500));
  }

  // 3. Fetch a few orgs with pilot end date set to check the data shape
  // We need to see custom field values in org responses
  const orgsRes = await fetch(
    `${BASE}/organizations?api_token=${API_TOKEN}&limit=5&sort=id+DESC`
  );
  const orgsJson = await orgsRes.json();
  const sampleOrg = orgsJson.data?.[0];
  if (sampleOrg) {
    console.log('\nSample org custom fields:');
    console.log(`  Account Status (${ACCOUNT_STATUS_KEY}):`, sampleOrg[ACCOUNT_STATUS_KEY]);
    console.log(`  Pilot End Date (${PILOT_DATE_KEY}):`, sampleOrg[PILOT_DATE_KEY]);
    console.log(`  ChargeOver # (${CO_CUSTOMER_KEY}):`, sampleOrg[CO_CUSTOMER_KEY]);
    console.log(`  Account Manager (${ACCT_MGR_KEY}):`, JSON.stringify(sampleOrg[ACCT_MGR_KEY])?.slice(0,100));
    console.log(`  label_ids:`, sampleOrg.label_ids);
  }

  // 4. Fetch orgs with pilot date in April 2026 to verify approach
  // Strategy: fetch all orgs, filter by date in JS (small dataset)
  // Let's check total org count
  const countRes = await fetch(
    `${BASE}/organizations?api_token=${API_TOKEN}&limit=1&start=0`
  );
  const countJson = await countRes.json();
  console.log('\nTotal orgs in PipeDrive:', countJson.additional_data?.pagination?.total_count ?? 'unknown');

  // 5. Try fetching orgs with April pilot date (check if filter works via search)
  // Try the filter_id approach by listing existing filters
  const filtersRes = await fetch(`${BASE}/filters?type=org&api_token=${API_TOKEN}`);
  const filtersJson = await filtersRes.json();
  console.log('\nExisting org filters:');
  for (const f of (filtersJson.data ?? [])) {
    console.log(`  id=${f.id} name="${f.name}"`);
  }
}

main().catch(console.error);
