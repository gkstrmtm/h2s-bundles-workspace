'use strict';

const crypto = require('node:crypto');
const { createFixture } = require('../../backend/tests/helpers/commercial_contact_fixture.cjs');
const { evaluate } = require('../../backend/tests/helpers/commercial_operations_fixture.cjs');
const { pages } = require('../../frontend/media-page-heroes.js');
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;

function createDashboardPreview({ jobCount = 1 } = {}) {
    if (!Number.isInteger(jobCount) || jobCount < 0 || jobCount > 1000) throw Error('Use 0-1000 isolated Operations jobs.');
    const fixture = createFixture(), now = new Date().toISOString();
    for (const [index, market, name] of [
        [1, 'residential', 'SYNTHETIC Morgan and Jordan Wellington household'],
        [2, 'commercial', 'SYNTHETIC Northwind Community Services and Facilities Management']
    ]) {
        fixture.tables.commercial_leads.push({
            lead_id: id(index), full_name: name, company_name: market === 'commercial' ? name : '',
            email: `review${index}@example.invalid`, phone: '+15550000005', contact_preference: 'call',
            attribution: { market }, service_needs: ['TV Mounting', 'Cameras'],
            scope_summary: 'SYNTHETIC inquiry for responsive dashboard inspection only.',
            notes: 'No customer contact, booking or production record.', project_photo_urls: [],
            created_at: now, updated_at: now, last_submitted_at: now
        });
        fixture.tables.commercial_consultation_requests.push({
            request_id: id(10 + index), lead_id: id(index), status: 'pending',
            related_order_id: null, created_at: now, updated_at: now,
            metadata: { request_kind: market === 'residential' ? 'residential_inquiry' : 'commercial_consultation' }
        });
    }
    const assets = ['tv_mounting', 'cameras', 'tv_mounting'].map((service, index) => ({
        asset_id: id(100 + index), pack_id: id(service === 'cameras' ? 201 : 200), service,
        media_kind: 'photo', is_visible: true, storage_bucket: 'review-media',
        storage_path: `synthetic-${index}.png`, original_filename: `SYNTHETIC ${service} example ${index + 1}`,
        title: `SYNTHETIC ${service} example ${index + 1}`, created_at: now, updated_at: now
    }));
    fixture.tables.proof_assets = assets;
    fixture.tables.proof_packs = ['tv_mounting', 'cameras'].map((service, index) => ({
        pack_id: id(200 + index), service, surface: 'bundles', title: `SYNTHETIC ${service} library`,
        week_of: now.slice(0, 10), created_at: now, status: 'draft'
    }));
    fixture.tables.proof_slots = [];
    for (const table of ['h2s_dispatch_jobs', 'h2s_dispatch_job_assignments', 'h2s_dispatch_legacy_job_links',
        'h2s_pros', 'h2s_dispatch_pros', 'h2s_jobs', 'h2s_payouts_ledger', 'commercial_reservations',
        'h2s_dispatch_pros_availability', 'h2s_dispatch_pro_capacity']) fixture.tables[table] = [];
    const readiness = new Map(), payments = new Map();
    for (let i = 0; i < jobCount; i++) {
        const jobId = id(301 + i * 10), orderId = id(300 + i * 10), proId = id(50000 + i % 3), legacyId = 'SYNTHETIC-LEGACY-' + i;
        const start = new Date(Date.now() + 86400000 * (1 + Math.floor(i / 10)));
        start.setUTCHours(15 + (i % 10 === 3 ? 0 : i % 3) * 2, 0, 0, 0);
        const scheduled = i % 10 !== 2, completed = i % 10 === 4;
        const end = new Date(start.getTime() + 7200000).toISOString();
        const email = `installation${i}@example.invalid`;
        fixture.tables.h2s_orders.push({ id: orderId, order_id: 'SYNTHETIC-ORDER-' + (i + 1),
            customer_name: i === 0 ? fixture.tables.commercial_leads[0].full_name : `SYNTHETIC ${['Rivera', 'Chen', 'Patel', 'Williams'][i % 4]} household ${i + 1}`,
            customer_email: email, address: `${100 + i} Synthetic Review Lane`, city: 'Review City',
            service_name: i % 2 ? 'SYNTHETIC camera installation' : 'SYNTHETIC TV installation',
            total: null, status: completed ? 'completed' : 'pending',
            items: 'Customer-owned equipment; mounting supplies require review',
            metadata_json: scheduled ? { scheduled_end: end, scheduled_tz: 'America/Chicago', order_required: true,
                order_stage: i % 10 === 6 ? 'pending' : 'delivered' } : {},
            created_at: now, updated_at: now });
        fixture.tables.h2s_dispatch_jobs.push({ job_id: jobId, order_id: 'SYNTHETIC-ORDER-' + (i + 1),
            status: completed ? 'completed' : scheduled ? 'assigned' : 'queued',
            due_at: scheduled ? start.toISOString() : null, updated_at: now });
        if (!fixture.tables.h2s_pros.some(row => row.pro_id === proId)) fixture.tables.h2s_pros.push({
            pro_id: proId, name: ['SYNTHETIC Alex installer', 'SYNTHETIC Taylor installer', 'SYNTHETIC Casey installer'][i % 3],
            email: `installer${i % 3}@example.invalid`, is_active: true });
        if (scheduled) fixture.tables.h2s_dispatch_job_assignments.push({ assign_id: 'SYNTHETIC-OFFER-' + i, job_id: jobId,
            pro_id: proId, state: completed ? 'completed' : i % 10 === 0 ? 'pending' : 'accepted', updated_at: now });
        fixture.tables.h2s_jobs.push({ job_id: legacyId, customer_email: email });
        if (i % 10 !== 8) fixture.tables.h2s_dispatch_legacy_job_links.push({ dispatch_job_id: jobId, legacy_job_id: legacyId,
            evidence_basis: 'source_record', evidence_reference: 'SYNTHETIC reviewed link, not production',
            reviewed_by_user_id: id(9), reviewed_at: now });
        readiness.set(jobId, i % 10 === 7 || jobCount === 1 ? null : { ready: ![2, 6].includes(i % 10),
            blockers: [2, 6].includes(i % 10) ? ['Equipment or materials require review', 'Confirm property access instructions'] : [] });
        payments.set(orderId, jobCount === 1 ? { status: 'unverified', detail: 'No external payment verification in this read fixture.' }
            : { status: i % 10 === 5 ? 'unpaid' : i % 10 === 7 ? 'unavailable' : 'paid',
                detail: 'SYNTHETIC full-order payment evidence only; not a real payment or verified deposit allocation.', checkedAt: now });
        if (i % 10 === 1) {
            fixture.tables.commercial_lead_operations.push({ lead_id: id(90000 + i), installation_job_id: jobId, order_id: orderId });
            fixture.tables.commercial_reservations.push({ lead_id: id(90000 + i), revision: 1, state: 'confirmed',
                starts_at: start.toISOString(), ends_at: end, expires_at: null, timezone: 'America/Chicago' });
        }
    }
    if (jobCount > 1) fixture.tables.h2s_dispatch_job_assignments.push({ assign_id: 'SYNTHETIC-HISTORICAL-ORPHAN',
        job_id: id(999999), pro_id: id(50000), state: 'accepted', updated_at: now });
    const foundation = evaluate('lib\\operationsFoundation.ts', {});
    const operations = evaluate('lib\\managementOperations.ts', { '@/lib/operationsFoundation': foundation });
    const planning = evaluate('lib\\managementPlanning.ts', { 'node:crypto': crypto,
        '@/lib/operationsFoundation': foundation, '@/lib/managementOperations': operations });
    const readDb = { from: fixture.database.from.bind(fixture.database), async rpc(name, args) {
        if (name !== 'h2s_job_readiness') throw Error('Unsupported isolated dashboard RPC: ' + name);
        if (readiness.get(args.p_job_id)) return { data: readiness.get(args.p_job_id), error: null };
        return { data: null, error: { code: '42883', message: 'Readiness evidence is unavailable in this read fixture.' } };
    } };
    const imports = { 'next/server': { NextResponse: Response }, '@/lib/supabase': { getSupabase: () => fixture.database } };
    const media = Object.fromEntries(['proof-packs', 'proof-assets', 'proof-slots'].map(name =>
        ['admin/' + name, evaluate(`app\\api\\admin\\${name}\\route.ts`, imports)]));
    const known = {
        candidates: { candidates: [{ Candidate_ID: 'SYNTHETIC-APPLICANT', First_Name: 'SYNTHETIC',
            Last_Name: 'Technician applicant', Current_Stage: 'SCREENED', Created_At: now }] },
        aiProfiles: { profiles: [] }, training: { training: [], resources: [] },
        tasks: { tasks: [{ Task_ID: 'SYNTHETIC-TASK', Title: 'SYNTHETIC review installation materials',
            Status: 'PENDING', Priority: 'medium', Assigned_To: 'ADMIN_FIXTURE', Created_At: now }] },
        deliverables: { deliverables: [] }, hours: { hours: [] }, trainingCompletions: { trainingCompletions: [] },
        taskCounts: { taskCounts: { total: 1, completed: 0, pending: 1 } },
        bug_reports: { bug_reports: { reports: [], meta: { synthetic: true } } },
        dashboardUsers: { users: [{ User_ID: id(9), Username: 'ADMIN_FIXTURE',
            Display_Name: 'SYNTHETIC Review Administrator', Role: 'ADMIN', Is_Disabled: false }] },
        taskResources: { taskResources: [] }, reports: { reports: [] }
    };
    const json = (value, status = 200) => Response.json({ ...value, simulatedOnly: true },
        { status, headers: { 'X-H2S-Review-Source': 'isolated-dashboard-read-fixture' } });
    return {
        async request(name, method, actor, query, origin) {
            const url = new URL('/api/' + name + (query || ''), origin);
            const action = url.searchParams.get('action');
            const supported = name === 'v1' ? action === 'commercialQueue' || Object.hasOwn(known, action)
                : Object.hasOwn(media, name) || ['get_supabase_config', 'owner-media/public', 'proof-slots',
                    'proof-gallery', 'admin/media-placements', 'management-operations', 'management-planning'].includes(name);
            if (!supported || method !== 'GET') return null;
            if (actor !== 'admin') return json({ ok: false, error: 'Administrator review session required.' }, 403);
            if (name === 'v1') return json({ ok: true, ...(action === 'commercialQueue'
                ? { commercialQueue: await fixture.queue(url.searchParams) } : known[action]) });
            const offset = Number(url.searchParams.get('offset') || 0);
            if (['management-operations', 'management-planning'].includes(name)
                && (!Number.isSafeInteger(offset) || offset < 0))
                return json({ ok: false, error: 'Invalid review offset.' }, 400);
            if (name === 'management-operations') return json({ ok: true, assignmentManagementEnabled: false, ...await operations.readManagementOperations(readDb,
                { offset, limit: url.searchParams.has('jobId') ? 1 : 25, jobId: url.searchParams.get('jobId') || undefined,
                    verifyPayment: async order => payments.get(order.id) }) });
            if (name === 'management-planning') return json({ ok: true, reviewOwnerId: id(9),
                ...await planning.readManagementPlanning(readDb, { offset, limit: 25,
                    view: url.searchParams.get('view') === 'reconciliation' ? 'reconciliation' : 'schedule',
                    filter: url.searchParams.get('filter') || 'all' }) });
            if (media[name]) {
                const response = await media[name].GET(new Request(url));
                return json(await response.json(), response.status);
            }
            if (name === 'get_supabase_config') return json({ ok: true, url: origin, anonKey: '' });
            const photos = assets.map(asset => ({ ...asset, source: 'proof_asset',
                media_url: origin + '/walkthrough/sample-photo.png' }));
            if (name === 'admin/media-placements') return json({ ok: true, placements: [] });
            if (name === 'proof-slots') return json({ ok: true, slots: [], hero_media: [photos[0]], hero_exclusions: [] });
            if (name === 'proof-gallery') return json({ ok: true, categories: Object.fromEntries(
                ['tv_mounting', 'cameras'].map(service => [service, { items: photos.filter(item => item.service === service) }])) });
            const surface = url.searchParams.get('surface');
            if (!pages[surface]) return json({ ok: false, error: 'Unsupported synthetic media surface.' }, 400);
            return json({ ok: true, surface, sections: Object.fromEntries(Object.keys(pages[surface].areas).map(area =>
                [area, { items: photos.filter(item => item.service === (area.includes('camera') || area.includes('security') ? 'cameras' : 'tv_mounting')).slice(0, 1) }])) });
        },
        hasMedia(bucket, path) { return assets.some(asset => asset.storage_bucket === bucket && asset.storage_path === path); },
        fixture
    };
}
module.exports = { createDashboardPreview };
