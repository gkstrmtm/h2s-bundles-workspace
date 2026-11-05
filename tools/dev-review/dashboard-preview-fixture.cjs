'use strict';

const crypto = require('node:crypto');
const { createFixture } = require('../../backend/tests/helpers/commercial_contact_fixture.cjs');
const { evaluate } = require('../../backend/tests/helpers/commercial_operations_fixture.cjs');
const { pages } = require('../../frontend/media-page-heroes.js');
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;

function createDashboardPreview() {
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
    fixture.tables.h2s_orders.push({ id: id(300), order_id: 'SYNTHETIC-ORDER-1',
        customer_name: fixture.tables.commercial_leads[0].full_name, customer_email: 'review1@example.invalid',
        address: '100 Synthetic Review Lane', service_name: 'SYNTHETIC installation review',
        total: null, status: 'pending', metadata_json: {}, created_at: now, updated_at: now });
    fixture.tables.h2s_dispatch_jobs.push({ job_id: id(301), order_id: 'SYNTHETIC-ORDER-1',
        status: 'queued', due_at: new Date(Date.now() + 86400000).toISOString(), updated_at: now });
    const foundation = evaluate('lib\\operationsFoundation.ts', {});
    const operations = evaluate('lib\\managementOperations.ts', { '@/lib/operationsFoundation': foundation });
    const planning = evaluate('lib\\managementPlanning.ts', { 'node:crypto': crypto,
        '@/lib/operationsFoundation': foundation, '@/lib/managementOperations': operations });
    const readDb = { from: fixture.database.from.bind(fixture.database), async rpc(name) {
        if (name !== 'h2s_job_readiness') throw Error('Unsupported isolated dashboard RPC: ' + name);
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
            if (name === 'management-operations') return json({ ok: true, ...await operations.readManagementOperations(readDb,
                { offset, limit: 25, verifyPayment: async () => ({ status: 'unverified', detail: 'No external payment verification in this read fixture.' }) }) });
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
