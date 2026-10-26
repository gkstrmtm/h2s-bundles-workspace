const { createOperationsFixture, evaluate, id } = require('./commercial_operations_fixture.cjs');
async function createCalendarFixture(base) {
  const fixture = base || await createOperationsFixture({ CALENDAR_FIXTURE: true });
  if (base && !(await fixture.db.query("select to_regclass('public.commercial_calendar') name")).rows[0].name)
    await fixture.db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'..','..','migrations','036_commercial_calendar_workload.sql'),'utf8'));
  fixture.calendarRoute = evaluate('app\\api\\commercial-calendar\\route.ts', {
    'next/server': { NextResponse: class extends Response { static json(value, options) { return Response.json(value, options); } } },
    '@/lib/supabase': { getSupabase: () => fixture.client },
    '@/lib/dashboardAuth': { getDashboardAuthUserFromSession: async request => {
      const token = request.headers.get('authorization');
      return token === ['Bearer','fixture-admin'].join(' ') ? { userId:id(9),displayName:'Fixture Admin',username:'ADMIN_FIXTURE',role:'ADMIN' }
        : token === ['Bearer','fixture-va'].join(' ') ? { userId:id(10),displayName:'Fixture Staff',username:'STAFF_FIXTURE',role:'VA' } : null;
    } },
    '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/residential_workspace': { processResidentialNotices: async () => ({enabled:false,needsReview:false,processed:[]}) },
  });
  fixture.calendarRequest = (method, body, token = 'fixture-admin', query = {}) => {
    const url = new URL('http://fixture.invalid/api/commercial-calendar');
    Object.entries({ start:'2099-01-01T00:00:00Z',end:'2099-01-02T00:00:00Z',leadId:id(1),...query })
      .forEach(([key,value]) => url.searchParams.set(key,value));
    return fixture.calendarRoute[method](new Request(url, { method, headers: {
      Authorization:['Bearer',token].join(' '),'Content-Type':'application/json',
    }, ...(method === 'POST' ? {body:JSON.stringify(body)} : {}) }));
  };
  return fixture;
}
module.exports = { createCalendarFixture };
