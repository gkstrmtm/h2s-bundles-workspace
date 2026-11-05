import { ForecastFact, ForecastResearch } from '@/lib/forecast';

export type ForecastResearchProvider = { research(place: string, state: string): Promise<ForecastResearch> };
export type ForecastOptionalProvider = { name: 'wages' | 'competition' | 'tax' | 'ads';
  research(place: string, state: string): Promise<ForecastResearch> };
export const FORECAST_UNCONNECTED_SOURCES = ['Wage provider not connected.', 'Competition provider not connected.',
  'Tax provider not connected.', 'Advertising benchmark provider not connected.'];
const DATASET = 'acs/acs5';
const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g,' ');
const unavailable = (message: string): ForecastResearch => ({ facts: [], missing: [message] });

export function createCensusForecastProvider(options: {
  enabled: boolean; apiKey?: string; fetch?: typeof fetch; now?: () => number; year?: number; ttlMs?: number; timeoutMs?: number; maxBytes?: number;
}): ForecastResearchProvider {
  const fetcher = options.fetch || fetch, now = options.now || Date.now, year = options.year || 2024;
  const ttl = Math.max(1000, Math.min(options.ttlMs || 86400000, 7*86400000));
  const cache = new Map<string,{ at: number; value: unknown }>(), pending = new Map<string,Promise<unknown>>();
  if (!Number.isInteger(year) || year < 2010 || year > new Date(now()).getUTCFullYear()-1) throw new Error('Invalid ACS dataset year.');
  async function json(url: string): Promise<any> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.census.gov' || parsed.port || parsed.username || parsed.password
      || parsed.pathname !== `/data/${year}/${DATASET}`) throw new Error('Research URL not allowlisted.');
    const prior = cache.get(url);
    if (prior && now()-prior.at < ttl) return prior.value;
    if (pending.has(url)) return pending.get(url)!;
    const task = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(options.timeoutMs || 5000,10000));
      try {
        const requestUrl = new URL(url);
        if (options.apiKey?.trim()) requestUrl.searchParams.set('key',options.apiKey.trim());
        const response = await fetcher(requestUrl.href, { signal: controller.signal, redirect:'manual', headers:{ accept:'application/json' } });
        if ([301,302,303,307,308].includes(response.status)
          && response.headers.get('location') === 'https://api.census.gov/data/missing_key.html') throw new Error('CENSUS_KEY_REQUIRED');
        if (!response.ok) throw new Error('Census unavailable.');
        const max = Math.min(options.maxBytes || 2000000,2000000), reader = response.body?.getReader();
        if (!reader) throw new Error('Missing research response.');
        let length = 0, content = '';
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > max) { await reader.cancel(); throw new Error('Research response too large.'); }
          content += decoder.decode(part.value,{stream:true});
        }
        content += decoder.decode();
        const value = JSON.parse(content);
        if (!Array.isArray(value) || value.length > 20000 || !Array.isArray(value[0])) throw new Error('Invalid research response.');
        if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
        cache.set(url,{at:now(),value});
        return value;
      } finally { clearTimeout(timeout); }
    })();
    pending.set(url,task);
    try { return await task; } finally { pending.delete(url); }
  }
  const url = (get: string, geo: string, within?: string) => {
    const u = new URL(`https://api.census.gov/data/${year}/${DATASET}`);
    u.searchParams.set('get',get); u.searchParams.set('for',geo); if (within) u.searchParams.set('in',within);
    return u.href;
  };
  const records = (table: any[][]) => table.slice(1).map(row => Object.fromEntries(table[0].map((key,i) => [key,row[i]])));
  return { async research(place, state) {
    if (!options.enabled) return unavailable('Public Census research is disabled.');
    if (!place.trim() || !state.trim()) return unavailable('An explicit US place and state are required for Census resolution.');
    try {
      const states = records(await json(url('NAME','state:*')));
      // FIPS is an official identifier, not a local demographic assumption.
      const matches = states.filter(s => normalize(s.NAME) === normalize(state) || s.state === state);
      if (matches.length !== 1) return unavailable('State is unavailable or ambiguous. Enter the full official state name (or Census FIPS code).');
      const stateId = matches[0].state;
      const places = records(await json(url('NAME','place:*',`state:${stateId}`)));
      const candidates = places.filter(p => {
        const official = normalize(String(p.NAME).split(',')[0]);
        return official === normalize(place) || official.replace(/ (city|town|village|borough|municipality|cdp)$/,'') === normalize(place);
      });
      if (candidates.length !== 1) return unavailable(candidates.length ? 'Place is ambiguous; use its full official Census designation.' : 'Official Census place could not be resolved.');
      const variables = ['B01003_001E','B11001_001E','B25003_001E','B25003_002E','B25001_001E','B25024_002E'];
      const sourceUrl = url(['NAME',...variables].join(','),`place:${candidates[0].place}`,`state:${stateId}`);
      const table = records(await json(sourceUrl));
      if (table.length !== 1 || table[0].place !== candidates[0].place || table[0].state !== stateId) return unavailable('Census place identity did not reconcile.');
      const row = table[0], fetchedAt = new Date(cache.get(sourceUrl)!.at).toISOString();
      const stale = new Date(now()).getUTCFullYear()-year > 2 || now()-Date.parse(fetchedAt) >= ttl;
      const names = ['population','households','occupied_housing_units','owner_occupied_housing_units','housing_units','single_family_detached_housing_units'];
      const facts: ForecastFact[] = [], missing: string[] = [];
      variables.forEach((v,i) => {
        const value = Number(row[v]);
        if (row[v] === null || row[v] === '' || !Number.isSafeInteger(value) || value < 0) { missing.push(`${names[i]} unavailable from ACS.`); return; }
        facts.push({name:names[i],value,unit:'count',provenance:'market_fact',sourceUrl,dataset:`Census ${year} ACS 5-year estimates`,datasetYear:year,fetchedAt,stale});
      });
      if (stale) missing.push('Public demographic dataset is stale; not current demand evidence.');
      missing.push('ACS estimates have sampling uncertainty; margins of error are not modeled. No conversion/CPL inference is made.');
      return {facts,missing};
    } catch (error) {
      if (error instanceof Error && error.message === 'CENSUS_KEY_REQUIRED') return unavailable(
        `Census ${year} ACS data requires a free API key; no key is connected. Official notice: https://api.census.gov/data/missing_key.html. Metadata access does not verify local demographic values.`);
      return unavailable('Public Census research is unavailable, timed out, or invalid. No local values were substituted.');
    }
  } };
}
