'use strict';
const API_TOKEN = 'f9f472580a54916057aa8ac5b3ab3274771182d9';
const DOMAIN = 'outboundconsulting';
const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

async function main() {
  // Try to get label definitions via the label_ids field options
  const fieldsRes = await fetch(`${BASE}/organizationFields?api_token=${API_TOKEN}&limit=200`);
  const fieldsJson = await fieldsRes.json();
  const labelField = fieldsJson.data.find(f => f.key === 'label_ids');
  const labelField2 = fieldsJson.data.find(f => f.key === 'label');

  console.log('label_ids field:', JSON.stringify(labelField, null, 2)?.slice(0, 2000));
  console.log('\nlabel field:', JSON.stringify(labelField2, null, 2)?.slice(0, 2000));

  // Try v2 API
  const v2Res = await fetch(`https://${DOMAIN}.pipedrive.com/api/v2/organizations/labels?api_token=${API_TOKEN}`);
  const v2Json = await v2Res.json();
  console.log('\nv2 /organizations/labels:', JSON.stringify(v2Json).slice(0, 1000));

  // Try /organizationLabels without trailing s
  const r2 = await fetch(`${BASE}/organizationLabel?api_token=${API_TOKEN}`);
  const j2 = await r2.json();
  console.log('\n/organizationLabel:', JSON.stringify(j2).slice(0, 500));

  // Try /orgCategories
  const r3 = await fetch(`${BASE}/orgCategories?api_token=${API_TOKEN}`);
  const j3 = await r3.json();
  console.log('\n/orgCategories:', JSON.stringify(j3).slice(0, 500));

  // Check a specific org's full data to see if labels come with names
  const orgRes = await fetch(`${BASE}/organizations/175168?api_token=${API_TOKEN}`);
  const orgJson = await orgRes.json();
  console.log('\nFull org 175168 labels:', JSON.stringify(orgJson.data?.labels ?? orgJson.data?.label_ids).slice(0, 500));
  // Show all top-level keys
  const allKeys = Object.keys(orgJson.data ?? {}).filter(k => k.toLowerCase().includes('label'));
  console.log('Label-related keys in full org:', allKeys);
  for (const k of allKeys) {
    console.log(`  ${k}:`, JSON.stringify(orgJson.data[k]));
  }
}

main().catch(console.error);
