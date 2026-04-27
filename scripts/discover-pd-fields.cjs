'use strict';
// Discover PipeDrive organization field hash keys
const API_TOKEN = 'f9f472580a54916057aa8ac5b3ab3274771182d9';
const DOMAIN = 'outboundconsulting';
const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

async function main() {
  const res = await fetch(`${BASE}/organizationFields?api_token=${API_TOKEN}&limit=200`);
  const json = await res.json();
  if (!json.success) { console.error('API error:', json); return; }

  const fields = json.data ?? [];
  console.log(`\nTotal org fields: ${fields.length}\n`);

  // Print all custom fields (edit_flag = true or field_type custom)
  const target = [
    'pilot', 'rollover', 'account status', 'chargeover', 'manager', 'label',
    'tier', 'finance', 'notes', 'launch', 'deal', 'engagement'
  ];

  console.log('=== Fields matching keywords ===');
  for (const f of fields) {
    const name = (f.name ?? '').toLowerCase();
    if (target.some(k => name.includes(k))) {
      console.log(`  "${f.name}" => key="${f.key}" type="${f.field_type}"`);
    }
  }

  console.log('\n=== All custom fields (non-standard) ===');
  for (const f of fields) {
    if (f.key && f.key.length > 20) { // custom field hash keys are long hex strings
      console.log(`  "${f.name}" => key="${f.key}" type="${f.field_type}"`);
    }
  }

  // Also fetch one sample org to see the label structure
  console.log('\n=== Sample org (first result) to inspect structure ===');
  const orgRes = await fetch(`${BASE}/organizations?api_token=${API_TOKEN}&limit=1`);
  const orgJson = await orgRes.json();
  if (orgJson.data && orgJson.data[0]) {
    const org = orgJson.data[0];
    // Show all keys that have values
    for (const [k, v] of Object.entries(org)) {
      if (v !== null && v !== undefined && v !== '' && k !== 'owner_id') {
        if (typeof v === 'object') {
          console.log(`  ${k}:`, JSON.stringify(v).slice(0, 120));
        } else {
          console.log(`  ${k}:`, String(v).slice(0, 80));
        }
      }
    }
  }
}

main().catch(console.error);
