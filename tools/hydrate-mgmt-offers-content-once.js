/*
Hydrate MGMT Offers with:
- offer_builder.offerDescription (if missing)
- AI_Analysis.offer_frameworks (if missing)

Goal:
- Run ONCE as a backfill so the UI always has descriptions + frameworks persisted.
- Avoid repeated AI calls during normal UI use.

Safety:
- Dry-run by default.
- Does not print secrets.

Usage:
  node .\\tools\\hydrate-mgmt-offers-content-once.js --limit 200
  node .\\tools\\hydrate-mgmt-offers-content-once.js --limit 200 --apply
  node .\\tools\\hydrate-mgmt-offers-content-once.js --limit 200 --apply --onlyIfMissing
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadDotEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const envVars = {};

  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^([^=#\s]+)=(.*)$/);
    if (!match) continue;
    const key = String(match[1] || '').trim();
    let value = String(match[2] || '').trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key && envVars[key] == null) envVars[key] = value;
  }

  return envVars;
}

function pickFirst(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function safeTrim(v) {
  return String(v == null ? '' : v).trim();
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function compact(s, max = 600) {
  const str = safeTrim(s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function extractFromBriefText(descRaw) {
  const desc = String(descRaw || '');
  const pick = (re) => {
    try {
      const m = desc.match(re);
      return m && m[1] ? String(m[1]).trim() : '';
    } catch {
      return '';
    }
  };

  const offer = pick(/\bOffer:\s*([^\n\r]+)/i);
  const category = pick(/\bCategory:\s*([^\n\r]+)/i);
  const market = pick(/\bMarket:\s*([^\n\r]+)/i);
  const services = pick(/\bServices:\s*([\s\S]*?)(?=\n\s*(Customer Price:|Tech Payout:|Profit:|Margin:|Standards Status:|Headline:|Promise:|Category:|Market:|$))/i);
  const headline = pick(/\bHeadline:\s*([^\n\r]+)/i);
  const promise = pick(/\bPromise:\s*([^\n\r]+)/i);
  const offerDates = pick(/\bOffer Dates:\s*([^\n\r]+)/i);
  const eligibility = pick(/\bEligibility Rules:\s*([\s\S]*?)(?=\n\s*(Redemption Rules:|What's Included:|Whats Included:|Customer Price:|Tech Payout:|Profit:|Margin:|Standards Status:|Headline:|Promise:|$))/i);
  const whatsIncluded = pick(/\b(What's Included|Whats Included):\s*([\s\S]*?)(?=\n\s*(What's Not Included|Whats Not Included|Eligibility Rules:|Customer Price:|Tech Payout:|Profit:|Margin:|Standards Status:|Headline:|Promise:|$))/i);
  const customerPriceStr = pick(/\bCustomer Price:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);

  const customerPrice = (() => {
    const n = Number(String(customerPriceStr || '').replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const servicesList = (() => {
    const lines = String(services || '')
      .split(/\r?\n/)
      .map((x) => safeTrim(x).replace(/^[-*•\d.\)\s]+/, ''))
      .filter(Boolean);
    if (lines.length) return lines;

    // Some briefs store services as comma-separated.
    const parts = safeTrim(services).split(/\s*,\s*/).map((x) => safeTrim(x)).filter(Boolean);
    return parts.length ? parts : [];
  })();

  return { offer, category, market, headline, promise, offerDates, eligibility, whatsIncluded, customerPrice, servicesList };
}

function buildFrameworkGuidance({ offerName, offerDates, eligibility, whatsIncluded, servicesList, customerPrice }) {
  const name = safeTrim(offerName);
  const dates = safeTrim(offerDates);
  const elig = compact(safeTrim(eligibility).replace(/\s+/g, ' '), 140);
  const inc = compact(safeTrim(whatsIncluded).replace(/\s+/g, ' '), 140);
  const services = Array.isArray(servicesList) ? servicesList.filter(Boolean) : [];

  const priceText = (typeof customerPrice === 'number' && customerPrice > 0) ? `$${Math.round(customerPrice)}` : '';
  const servicesText = services.length ? services.slice(0, 4).join(', ') : '';
  const timeText = dates ? ` (${dates})` : '';

  // What you asked for: short, conditional guidance sentences.
  const tof_guidance = compact(
    [
      name ? `TOF: Treat “${name}” as a limited-time offer${timeText}` : `TOF: Treat this as a limited-time offer${timeText}`,
      servicesText ? `and lead with a quick demo/education angle on ${servicesText}` : 'and lead with a quick demo/education angle on the outcome',
      'to earn attention before talking price.'
    ].join(' '),
    240
  );

  const bofBits = [];
  if (priceText) bofBits.push(`BOF: Lead with the package price (${priceText})`);
  else bofBits.push('BOF: Lead with the package price');
  if (inc) bofBits.push(`+ what’s included (${inc})`);
  else if (servicesText) bofBits.push(`+ what’s included (${servicesText})`);
  if (dates) bofBits.push(`, valid ${dates}`);
  if (elig) bofBits.push(`, conditions: ${elig}`);
  bofBits.push(', then proof + direct “book now” CTA.');

  const bof_guidance = compact(bofBits.join(' '), 260);

  const summary = compact(
    [
      name || 'Offer',
      priceText ? `at ${priceText}` : '',
      dates ? `valid ${dates}` : ''
    ].filter(Boolean).join(' — '),
    200
  );

  return { summary, tof_guidance: tof_guidance.replace(/^TOF:\s*/i, ''), bof_guidance: bof_guidance.replace(/^BOF:\s*/i, '') };
}

function buildOfferDescription({ offerName, headline, promise, market, category, servicesList, customerPrice }) {
  const parts = [];

  const title = safeTrim(offerName);
  const h = safeTrim(headline);
  const p = safeTrim(promise);
  const c = safeTrim(category);
  const m = safeTrim(market);

  if (h && p) parts.push(`${h} ${p}`);
  else if (h) parts.push(h);
  else if (p) parts.push(p);

  const metaBits = [c, m].filter(Boolean);
  if (metaBits.length) parts.push(metaBits.join(' • '));

  if (Array.isArray(servicesList) && servicesList.length) {
    const top = servicesList.slice(0, 8);
    parts.push(`Includes: ${top.join(', ')}${servicesList.length > top.length ? ', …' : ''}.`);
  }

  if (typeof customerPrice === 'number' && customerPrice > 0) {
    parts.push(`Customer price: $${Math.round(customerPrice)} (package).`);
  }

  const out = compact(parts.join('\n'), 900);

  // Absolute fallback so UI never shows blank.
  if (!safeTrim(out)) {
    if (title) return compact(`${title}\n(Description not available yet — run Offer Brief generation to fill details.)`, 220);
    return 'Description not available yet — run Offer Brief generation to fill details.';
  }

  return out;
}

function getFallbackFrameworks({ offerId, offerName, headline, lineItems, generatedAt, openaiUsed, guidance }) {
  const offerLabel = offerName || 'Offer';
  const items = (Array.isArray(lineItems) ? lineItems : [])
    .map((x) => ({ name: safeTrim(x && x.name), qty: Number(x && x.qty) || 1 }))
    .filter((x) => x.name)
    .map((x) => `${x.qty}× ${x.name}`)
    .join(', ');

  const summary = compact([offerLabel, headline].filter(Boolean).join(' — '), 160);

  const mkAdType = (key, title, premise, hooks, cta) => ({
    key,
    title,
    premise,
    hook_templates: hooks,
    cta,
    asset_notes: ['1 hero visual', '1 proof visual (review/before-after)', 'simple CTA end card']
  });

  const g = guidance && typeof guidance === 'object' ? guidance : null;

  return {
    version: 'h2s_offer_frameworks_v1',
    generated_at: generatedAt,
    generated_by: openaiUsed ? 'openai' : 'fallback',
    summary: (g && g.summary) ? g.summary : summary,
    tof_guidance: (g && g.tof_guidance) ? g.tof_guidance : '',
    bof_guidance: (g && g.bof_guidance) ? g.bof_guidance : '',
    offer_snapshot: {
      offer_id: offerId,
      offer_name: offerLabel,
      headline: summary,
      includes: items
    },
    pillars: [
      {
        key: 'offer_clarity',
        title: 'Offer clarity',
        goal: 'Make it obvious what they get + outcome.',
        softly_filled: [
          `What it is: ${offerLabel}`,
          items ? `What’s included: ${items}` : 'What’s included: (add your services above)',
          'Outcome: clean, safe, professional result — no surprises.'
        ],
        hook_lines: [`“${offerLabel} — clean, safe, pro install.”`, '“Quote in minutes. Schedule fast.”']
      },
      {
        key: 'objection_killer',
        title: 'Objection killer',
        goal: 'Remove fear: mess, trust, timing, surprise fees.',
        softly_filled: ['Upfront pricing (no surprises).', 'Respect your home (clean work).', 'Text updates + simple scheduling.'],
        hook_lines: ['“No hidden fees. Clean work.”', '“On-time pros. Done right.”']
      },
      {
        key: 'price_anchor',
        title: 'Price anchor',
        goal: 'Make price feel fair by anchoring value + what’s included.',
        softly_filled: ['Transparent quote → clear inclusions → simple CTA.', 'Bundle beats à la carte.'],
        hook_lines: ['“Bundle pricing beats piece-by-piece.”', '“Upfront quote. No surprises.”']
      },
      {
        key: 'proof',
        title: 'Proof / Reviews',
        goal: 'Build trust fast with social proof + before/after.',
        softly_filled: ['Lead with finished result.', 'Use 1 review line + stars + result photo.'],
        hook_lines: ['“Real customers. Real clean finishes.”', '“Before/after tells the story.”']
      },
      {
        key: 'scarcity',
        title: 'Scarcity / availability',
        goal: 'Create urgency based on real capacity constraints.',
        softly_filled: ['Limited installs per day.', 'Next openings: today/tomorrow/this week.'],
        hook_lines: ['“Limited slots this week.”', '“Next openings are going fast.”']
      },
      {
        key: 'hook',
        title: 'Hook variety',
        goal: 'Keep angles fresh so creative doesn’t fatigue.',
        softly_filled: ['Rotate pain → proof → process → offer stack.', 'Keep claims grounded.'],
        hook_lines: ['“Stop living with the mess.”', '“The clean way to get it done.”']
      }
    ],
    tof_ad_types: [
      mkAdType('myth_bust', 'Myth-bust / education', 'Teach the right way vs DIY mistakes.', ['“3 mistakes that ruin a clean install…”', '“Before you buy the cheapest option, watch this…”'], 'Get a quick quote'),
      mkAdType('before_after', 'Before / after', 'Show transformation first, then explain.', ['“Crooked → clean + level in 60 seconds.”', '“This 1 change makes the room look finished.”'], 'Book a slot'),
      mkAdType('tooling', 'Pro tools = pro result', 'Signal expertise with tools/process.', ['“Here’s what pros use to get it perfect…”', '“Why we measure twice (and what it prevents)”'], 'Schedule in minutes'),
      mkAdType('mini_demo', 'Mini-demo', 'Show one tight process step (clean + safe).', ['“Watch how we keep it clean…”', '“The safe way to do this in your home…”'], 'Get pricing'),
      mkAdType('problem_story', 'Problem story', 'Call out an annoying pain and fix it.', ['“If your setup wobbles, do this…”', '“Stop living with the mess…”'], 'See availability')
    ],
    bof_ad_types: [
      mkAdType('offer_stack', 'Offer stack', 'What’s included, clearly, with CTA.', [`“${offerLabel}: what you get (and what you don’t).”`, '“Everything included. No surprises.”'], 'Book now'),
      mkAdType('objection_answer', 'Objection answer', 'Answer the top fear in one line.', ['“Worried about mess? Here’s how we protect your home.”', '“Surprise fees? Not here. Upfront quote.”'], 'Get a quote'),
      mkAdType('review_push', 'Review-led retarget', 'Lead with the review, then the offer.', ['“They nailed it — clean finish.”', '“On time. Done right. Worth it.”'], 'Claim a slot'),
      mkAdType('scarcity_slots', 'Slots scarcity', 'Real constraint urgency.', ['“Limited installs this week.”', '“Next openings: today + tomorrow.”'], 'Check times'),
      mkAdType('price_value', 'Value vs price', 'Anchor value; keep it simple.', ['“Bundle pricing beats à la carte.”', '“Upfront pricing. Pro result.”'], 'See pricing')
    ]
  };
}

function parseArgs(argv) {
  const args = { limit: 200, apply: false, onlyIfMissing: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = clampInt(argv[++i], 1, 1000, args.limit);
    else if (a === '--apply') args.apply = true;
    else if (a === '--onlyIfMissing') args.onlyIfMissing = true;
    else if (a === '--force') args.onlyIfMissing = false;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const envPath = path.join(__dirname, '..', 'backend', '.env.local');
  const env = loadDotEnvFile(envPath);

  const mgmtUrl = pickFirst(env.SUPABASE_URL_MGMT, env.NEXT_PUBLIC_SUPABASE_URL_MGMT);
  const mgmtKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY_MGMT, env.SUPABASE_SERVICE_KEY_MGMT);

  if (!mgmtUrl || !mgmtKey) {
    console.error('Missing SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT in backend/.env.local');
    process.exit(2);
  }

  const sb = createClient(mgmtUrl, mgmtKey, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('=== HYDRATE MGMT OFFERS CONTENT (ONCE) ===');
  console.log(`Mode: ${args.apply ? 'APPLY (writes updates)' : 'DRY-RUN'}`);
  console.log(`Limit: ${args.limit}`);
  console.log(`onlyIfMissing: ${args.onlyIfMissing}`);

  const { data: offers, error: offersErr } = await sb
    .from('Offers')
    .select('Offer_ID, Created_By, Updated_At, Message_Context, AI_Analysis')
    .order('Updated_At', { ascending: false })
    .limit(args.limit);

  if (offersErr) throw new Error(`Failed to load MGMT Offers: ${offersErr.message}`);

  const rows = Array.isArray(offers) ? offers : [];
  const offerIds = rows.map((r) => safeTrim(r.Offer_ID)).filter(Boolean);

  // Load latest offer_brief Description per Offer_ID.
  const briefByOffer = new Map();
  if (offerIds.length) {
    const { data: briefs, error: briefsErr } = await sb
      .from('Deliverables')
      .select('Offer_ID, Deliverable_Type, Description, Created_At')
      .eq('Deliverable_Type', 'offer_brief')
      .in('Offer_ID', offerIds)
      .order('Created_At', { ascending: false })
      .limit(Math.min(offerIds.length * 3, 5000));

    if (!briefsErr && Array.isArray(briefs)) {
      for (const d of briefs) {
        const offerId = safeTrim(d.Offer_ID);
        if (!offerId) continue;
        if (briefByOffer.has(offerId)) continue;
        briefByOffer.set(offerId, d);
      }
    }
  }

  let scanned = 0;
  let needsDesc = 0;
  let needsFw = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const samples = [];

  for (const row of rows) {
    scanned++;
    const offerId = safeTrim(row.Offer_ID);
    if (!offerId) continue;

    let ctx = row.Message_Context;
    ctx = parseMaybeJson(ctx) || ctx;
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

    let ob = ctx.offer_builder || ctx.offerBuilder || {};
    ob = parseMaybeJson(ob) || ob;
    if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

    const offerName = safeTrim(ob.name || ctx.offerName || ctx.offer_name || ctx.name || '');
    const headline = safeTrim(ob.headline || ob.oneSentencePromise || ob.intendedGoal || '');
    const promise = safeTrim(ob.oneSentencePromise || '');

    const items = Array.isArray(ob.lineItems) ? ob.lineItems : [];

    const brief = briefByOffer.get(offerId);
    const briefDesc = brief ? brief.Description : (ctx && ctx.latest_offer_brief && ctx.latest_offer_brief.metadata ? ctx.latest_offer_brief.metadata.description : null);
    const extracted = extractFromBriefText(briefDesc);
    const guidance = buildFrameworkGuidance({
      offerName: offerName || extracted.offer,
      offerDates: extracted.offerDates,
      eligibility: extracted.eligibility,
      whatsIncluded: extracted.whatsIncluded,
      servicesList: extracted.servicesList && extracted.servicesList.length ? extracted.servicesList : items.map((x) => safeTrim(x && x.name)).filter(Boolean),
      customerPrice: extracted.customerPrice || null
    });

    const existingDesc = safeTrim(ob.offerDescription || ob.offer_description || '');
    const shouldWriteDesc = !existingDesc || existingDesc.length < 20;

    let existingAi = row.AI_Analysis;
    existingAi = parseMaybeJson(existingAi) || existingAi;
    if (!existingAi || typeof existingAi !== 'object' || Array.isArray(existingAi)) existingAi = {};

    const fw = existingAi.offer_frameworks;
    const hasFw = !!(fw && typeof fw === 'object' && Array.isArray(fw.pillars) && fw.pillars.length);
    const hasGuidance = !!(
      fw &&
      typeof fw === 'object' &&
      (safeTrim(fw.tof_guidance || fw.tofGuidance || '') || safeTrim(fw.bof_guidance || fw.bofGuidance || '') || safeTrim(fw.summary || fw.framework_summary || ''))
    );

    // Even if frameworks exist, we want to backfill the guidance sentences.
    const shouldWriteFw = !hasFw;
    const shouldWriteGuidance = !hasGuidance;

    const doDesc = shouldWriteDesc;
    const doFw = shouldWriteFw;
    const doGuidance = shouldWriteGuidance;

    if (args.onlyIfMissing) {
      if (!doDesc && !doFw && !doGuidance) {
        skipped++;
        continue;
      }
    }

    if (doDesc) needsDesc++;
    if (doFw) needsFw++;
    if (doGuidance && !doFw) needsFw++;

    const nextOb = { ...ob };
    if (doDesc) {
      nextOb.offerDescription = buildOfferDescription({
        offerName: offerName || extracted.offer,
        headline: extracted.headline || headline,
        promise: extracted.promise || promise,
        market: extracted.market || safeTrim(ob.market || ''),
        category: extracted.category || safeTrim(ob.category || ''),
        servicesList: extracted.servicesList && extracted.servicesList.length ? extracted.servicesList : items.map((x) => safeTrim(x && x.name)).filter(Boolean),
        customerPrice: extracted.customerPrice || null
      });
    }

    const nextCtx = { ...ctx, offer_builder: nextOb };

    const nextAi = { ...existingAi };
    if (doFw) {
      const generatedAt = new Date().toISOString();
      nextAi.offer_frameworks = getFallbackFrameworks({
        offerId,
        offerName: offerName || extracted.offer,
        headline: extracted.headline || headline,
        lineItems: items,
        generatedAt,
        openaiUsed: false,
        guidance
      });
    } else if (doGuidance) {
      // Preserve existing structure, just add the human-meaningful guidance strings.
      const existing = (fw && typeof fw === 'object') ? { ...fw } : {};
      existing.summary = safeTrim(existing.summary || existing.framework_summary || '') || guidance.summary || '';
      existing.tof_guidance = safeTrim(existing.tof_guidance || existing.tofGuidance || '') || guidance.tof_guidance || '';
      existing.bof_guidance = safeTrim(existing.bof_guidance || existing.bofGuidance || '') || guidance.bof_guidance || '';
      nextAi.offer_frameworks = existing;
    }

    if (samples.length < 8) {
      samples.push({
        offerId,
        offerName: offerName || '(unnamed)',
        willWriteDescription: doDesc,
        willWriteFrameworks: doFw || doGuidance,
        hasBrief: !!brief,
        briefCreatedAt: brief ? brief.Created_At : null
      });
    }

    if (!args.apply) continue;

    try {
      const { error: updErr } = await sb
        .from('Offers')
        .update({
          Message_Context: nextCtx,
          AI_Analysis: nextAi,
          Updated_At: new Date().toISOString()
        })
        .eq('Offer_ID', offerId);

      if (updErr) {
        errors++;
        continue;
      }

      updated++;
    } catch {
      errors++;
    }
  }

  console.log('--- Summary ---');
  console.log({ scanned, skipped, needsDesc, needsFw, updated, errors });
  console.log('--- Samples ---');
  console.log(samples);

  if (!args.apply) {
    console.log('DRY-RUN complete. Re-run with --apply to persist changes.');
  }
}

main().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
