'use strict';
// Discover the Pipedrive "Pilot Start Date" field hash on org AND deal fields.
// Reads PIPEDRIVE_API_TOKEN + PIPEDRIVE_COMPANY_DOMAIN from .env.local (no hardcoding).
//
// Exit 0 = found at least one match (prints the hash); exit 1 = no match.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function fetchFields(base, token, kind) {
  const url = `${base}/${kind}Fields?api_token=${token}&limit=500`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.success) {
    console.error(`${kind}Fields API error:`, JSON.stringify(json).slice(0, 300));
    return [];
  }
  return json.data ?? [];
}

function match(fields, kind) {
  const re = /pilot.*start/i;
  const hits = fields.filter(f => re.test(f.name ?? ''));
  for (const f of hits) {
    console.log(`  [${kind}] "${f.name}" => key="${f.key}" type="${f.field_type}"`);
  }
  return hits;
}

(async () => {
  const env = loadEnv();
  const token = env.PIPEDRIVE_API_TOKEN;
  const domain = env.PIPEDRIVE_COMPANY_DOMAIN;
  if (!token || !domain) {
    console.error('Missing PIPEDRIVE_API_TOKEN or PIPEDRIVE_COMPANY_DOMAIN in .env.local');
    process.exit(2);
  }
  const base = `https://${domain}.pipedrive.com/api/v1`;

  console.log(`=== Searching ${domain}.pipedrive.com for fields matching /pilot.*start/i ===\n`);

  const [orgFields, dealFields] = await Promise.all([
    fetchFields(base, token, 'organization'),
    fetchFields(base, token, 'deal'),
  ]);

  console.log(`Total org fields: ${orgFields.length}, deal fields: ${dealFields.length}\n`);

  const orgHits = match(orgFields, 'org');
  const dealHits = match(dealFields, 'deal');

  if (orgHits.length === 0 && dealHits.length === 0) {
    console.log('\nNo matches. Also dumping any field with "pilot" anywhere in the name:\n');
    for (const f of orgFields) {
      if (/pilot/i.test(f.name ?? '')) console.log(`  [org]  "${f.name}" => key="${f.key}" type="${f.field_type}"`);
    }
    for (const f of dealFields) {
      if (/pilot/i.test(f.name ?? '')) console.log(`  [deal] "${f.name}" => key="${f.key}" type="${f.field_type}"`);
    }
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
