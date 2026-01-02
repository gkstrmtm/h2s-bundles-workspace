const PRO_TABLE_CANDIDATES = [
  // Mixed-case table (quoted identifier) in some Supabase projects.
  'H2S_Pros',
  'h2s_dispatch_pros',
  'h2s_pros',
  'h2s_pro_profiles',
  'h2s_techs',
  'h2s_technicians',
];

const ID_COLUMNS = ['pro_id', 'Pro_ID', 'id', 'tech_id', 'Tech_ID'];

export type ProProfileUpdateResult =
  | { ok: true; table: string; idCol: string; updatedRow?: any }
  | { ok: false; error: string };

function nonEmptyObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}

export function sanitizeFilename(name: string): string {
  const base = String(name || 'upload.bin');
  const cleaned = base.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  return cleaned.length ? cleaned : 'upload.bin';
}

export async function bestEffortUpdateProRow(
  sb: any,
  proId: string,
  patches: Array<Record<string, any>>
): Promise<ProProfileUpdateResult> {
  const id = String(proId || '').trim();
  if (!sb) return { ok: false, error: 'Dispatch DB not configured' };
  if (!id) return { ok: false, error: 'Missing pro id' };

  const usablePatches = patches.filter((p) => nonEmptyObject(p));
  if (!usablePatches.length) return { ok: false, error: 'No fields to update' };

  for (const table of PRO_TABLE_CANDIDATES) {
    for (const idCol of ID_COLUMNS) {
      for (const patch of usablePatches) {
        try {
          const { data, error } = await sb
            .from(table)
            .update(patch)
            .eq(idCol as any, id)
            .select('*')
            .limit(1);

          if (error) continue;
          if (Array.isArray(data) && data.length) {
            return { ok: true, table, idCol, updatedRow: data[0] };
          }
        } catch {
          // try next
        }
      }
    }
  }

  return { ok: false, error: 'No matching pro profile row found (or columns differ)' };
}
