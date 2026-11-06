'use strict';

// This is a retargeter for reviewed migrations, not an SQL sandbox. The caller
// must set a private session search_path, retain standard_conforming_strings=on,
// and execute with a restricted role.
const SOURCES = new Set([
  '007_create_dashboard_accounts.sql',
  '014_create_commercial_consultation.sql',
  '031_commercial_reliability.sql',
  '032_commercial_operations.sql',
  '033_atomic_stripe_order_metadata.sql',
  '034_commercial_followup_delivery.sql',
  '035_commercial_business_tools.sql',
  '036_commercial_calendar_workload.sql',
  '037_residential_inquiries.sql',
  '038_residential_workspace.sql',
  '039_notification_routing.sql',
  '041_management_assignment.sql',
  '042_management_offer_reliability.sql',
  '043_field_sales.sql',
  '044_field_sales_transactions.sql',
  '045_field_sales_launch_contracts.sql',
  '046_field_sales_workflow.sql',
  '047_field_sales_earnings.sql',
  '048_field_sales_catalog_administration.sql',
  '049_field_sales_opportunities.sql',
  '050_field_sales_credentials.sql',
  '051_field_sales_company_installation.sql',
  '052_shared_dispatch_installation.sql',
]);

function fail(message) {
  throw new Error(`Unsupported staging SQL: ${message}`);
}

function validateSourceName(name) {
  if (typeof name !== 'string' || !SOURCES.has(name)) {
    throw new Error('Unapproved staging migration source name');
  }
  return name;
}

function validateNamespace(name, label) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)
    || /^(?:public|storage|auth|extensions|information_schema|pg_.*)$/.test(name)
    || ['session_user', 'current_user', 'user', 'default', 'select', 'create', 'table'].includes(name)) {
    throw new Error(`Invalid isolated ${label}: use a non-system, lowercase PostgreSQL identifier`);
  }
}

function lex(sql) {
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    const start = i;
    let type = 'symbol';
    let value;
    let tag;
    if (/\s/.test(sql[i])) {
      type = 'space';
      while (i < sql.length && /\s/.test(sql[i])) i++;
    } else if (sql.startsWith('--', i)) {
      type = 'comment';
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (sql.startsWith('/*', i)) {
      type = 'comment';
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) fail('unterminated block comment');
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      type = quote === "'" ? 'string' : 'identifier';
      value = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { value += quote; i += 2; }
          else { i++; closed = true; break; }
        } else value += sql[i++];
      }
      if (!closed) fail('unterminated quoted token');
    } else if (sql[i] === '$' && (tag = /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(sql.slice(i))?.[0])) {
      type = 'dollar';
      i += tag.length;
      const end = sql.indexOf(tag, i);
      if (end < 0) fail('unterminated dollar quote');
      value = sql.slice(i, end);
      i = end + tag.length;
    } else if (/[a-zA-Z_]/.test(sql[i])) {
      type = 'word';
      i++;
      while (i < sql.length && /[a-zA-Z_0-9$]/.test(sql[i])) i++;
      value = sql.slice(start, i).toLowerCase();
    } else {
      i++;
      if (['::', ':=', '||', '=>', '<>', '!='].includes(sql.slice(start, i + 1))) i++;
    }
    tokens.push({ type, raw: sql.slice(start, i), value, tag });
  }
  return tokens;
}

const isName = t => t && (t.type === 'word' || t.type === 'identifier');
const isLiteral = t => t && (t.type === 'string' || t.type === 'dollar');
const text = t => t && (t.value ?? t.raw);
const namespaceColumns = new Set(['nspname', 'table_schema', 'schemaname']);
const regTypes = new Set(['regclass', 'regprocedure', 'regproc', 'regtype', 'regnamespace']);
const regFunctions = new Set(['to_regclass', 'to_regprocedure', 'to_regproc', 'to_regtype', 'to_regnamespace']);

function rewrite(sql, targets, depth = 0, fragment = false) {
  if (depth > 24) fail('SQL nesting exceeds the reviewed limit');
  const tokens = lex(sql);
  const code = tokens.filter(t => t.type !== 'space' && t.type !== 'comment');
  const at = i => text(code[i]);
  const replacement = name => name === 'public' ? targets.schema : targets.storageSchema;
  const setLiteral = (token, value) => {
    if (token.type === 'dollar') {
      if (value.includes(token.tag)) fail('retargeted text collides with dollar delimiter');
      token.raw = token.tag + value + token.tag;
    } else token.raw = "'" + value.replace(/'/g, "''") + "'";
  };
  const castType = i => {
    if (at(i + 1) !== '::') return null;
    return at(i + 2) === 'pg_catalog' && at(i + 3) === '.' ? at(i + 4) : at(i + 2);
  };
  const literalContexts = new Map();
  const markArgument = (i, kind) => {
    if (!isLiteral(code[i])) fail(`${kind} requires a static SQL literal`);
    literalContexts.set(i, kind);
  };
  // 052 interpolates a catalog-derived check expression, never a caller's SQL.
  const isConstraintPatch = i => {
    const template = code[i].value;
    if (!['public', targets.schema].some(schema =>
      template === `alter table ${schema}.h2s_dispatch_jobs add constraint %I check(job_kind='installation' or (%s))`)) return false;
    const args = [',', 'existing', '.', 'conname', ',', 'existing', '.', 'expression', ')'];
    if (!args.every((value, offset) => at(i + 1 + offset) === value)) return false;
    const origin = ['for', 'existing', 'in', 'select', 'conname', ',', 'pg_get_expr', '(',
      'conbin', ',', 'conrelid', ')', 'as', 'expression', 'from', 'pg_constraint', 'where', 'conrelid', '='];
    return code.some((token, start) => origin.every((value, offset) => at(start + offset) === value)
      && isLiteral(code[start + origin.length])
      && ['public', targets.schema].some(schema => at(start + origin.length) === `${schema}.h2s_dispatch_jobs`)
      && at(start + origin.length + 1) === '::' && at(start + origin.length + 2) === 'regclass');
  };

  for (let i = 0; i < code.length; i++) {
    if (!isName(code[i])) continue;
    const word = at(i);
    if (['e', 'u', 'b', 'x'].includes(word) && (isLiteral(code[i + 1]) || at(i + 1) === '&')) {
      fail('prefixed/escaped SQL strings are not reviewed');
    }
    if (['alter', 'create', 'drop'].includes(word) && ['role', 'user', 'database', 'system', 'schema', 'extension'].includes(at(i + 1))) {
      fail(`global ${word} ${at(i + 1)}`);
    }
    if (word === 'schema' && ['set', 'on', 'current', 'in'].includes(at(i - 1))) fail('schema-level operation');
    if (word === 'standard_conforming_strings') fail('string parsing configuration');
    if (word === 'reset' && ['search_path', 'all', 'role', 'session_authorization'].includes(at(i + 1))) fail('session reset');
    if (word === 'set_config' && at(i + 1) === '('
      && (!isLiteral(code[i + 2]) || at(i + 3) !== ','
        || ['search_path', 'role', 'session_authorization', 'standard_conforming_strings'].includes(at(i + 2).toLowerCase()))) {
      fail('dynamic or search_path set_config');
    }
    if (word === 'language' && !['sql', 'plpgsql'].includes(at(i + 1))) fail('unreviewed function language');
    if (word === 'search_path' && ['set', 'local', 'session'].includes(at(i - 1))) {
      if (!['=', 'to'].includes(at(i + 1))) fail('unsupported search_path assignment');
      let j = i + 2;
      let count = 0;
      for (;;) {
        const name = at(j);
        if (!isName(code[j]) || !['public', 'storage', 'pg_catalog', 'pg_temp', targets.schema, targets.storageSchema].includes(name)) {
          fail('search_path must be a static, reviewed schema list');
        }
        if (name === 'public' || name === 'storage') {
          code[j].raw = code[j].type === 'identifier' ? `"${replacement(name)}"` : replacement(name);
        }
        count++;
        if (at(j + 1) !== ',') break;
        j += 2;
      }
      if (!count || ![';', 'as', 'language', 'security', 'stable', 'volatile', 'immutable', undefined].includes(at(j + 1))) {
        fail('ambiguous search_path boundary');
      }
    }
    if (regFunctions.has(word) && at(i + 1) === '(') {
      markArgument(i + 2, word === 'to_regnamespace' ? 'namespace' : 'reference');
      if (at(i + 3) !== ')') fail('computed reg* reference');
    }
    if (word === 'cast' && at(i + 1) === '(') {
      const type = at(i + 4) === 'pg_catalog' && at(i + 5) === '.' ? at(i + 6) : at(i + 4);
      if (at(i + 3) === 'as' && regTypes.has(type)) {
        markArgument(i + 2, type === 'regnamespace' ? 'namespace' : 'reference');
      }
    }
    if (namespaceColumns.has(word)
      && !['=', ';', ',', ')', undefined].includes(at(i + 1))) {
      fail('unreviewed namespace predicate');
    }
    if (word === 'execute' && !['function', 'procedure', 'on'].includes(at(i + 1))) {
      if (at(i + 1) === 'format' && at(i + 2) === '(') {
        markArgument(i + 3, 'dynamic SQL');
        if (![',', ')'].includes(at(i + 4))) fail('computed dynamic SQL template');
        if (code[i + 3].value.replace(/%%/g, '').replace(/%[Is]/g, '').includes('%')) {
          fail('unreviewed format placeholder');
        }
        if (isConstraintPatch(i + 3)) literalContexts.set(i + 3, 'constraint patch');
      }
      else if (isLiteral(code[i + 1])) {
        markArgument(i + 1, 'dynamic SQL');
        if (at(i + 2) !== ';') fail('dynamic SQL concatenation or parameters');
      } else if (at(i + 1) !== 'src' || at(i + 2) !== ';') {
        fail('unreviewed dynamic SQL expression');
      }
    }
    if (word === 'format' && at(i + 1) === '(' && !literalContexts.has(i + 2)) {
      // Reviewed migrations use format only as the direct argument to EXECUTE.
      fail('format outside a reviewed EXECUTE');
    }
    if (word === 'src' && at(i + 1) === ':=') {
      if (!['pg_get_functiondef', 'replace'].includes(at(i + 2))) fail('unreviewed dynamic SQL source');
    }
    if (word === 'replace' && at(i + 1) === '(' && at(i + 2) === 'src') {
      if (at(i + 3) !== ',') fail('malformed function-definition patch');
      markArgument(i + 4, 'SQL patch');
      if (at(i + 5) !== ',') fail('nonliteral function-definition patch');
      markArgument(i + 6, 'SQL patch');
      if (at(i + 7) !== ')') fail('nonliteral function-definition patch');
    }
  }

  for (let i = 0; i < code.length; i++) {
    const token = code[i];
    const name = at(i);
    if (isName(token) && ['public', 'storage'].includes(name) && at(i + 1) === '.') {
      if (at(i - 1) === '.') fail('three-part schema references');
      if (!isName(code[i + 2]) && !(fragment && at(i + 2) === '%')) fail('incomplete schema qualifier');
      token.raw = token.type === 'identifier' ? `"${replacement(name)}"` : replacement(name);
      continue;
    }
    if (!isLiteral(token)) continue;
    const cast = castType(i);
    let kind = literalContexts.get(i);
    if (regTypes.has(cast)) kind = cast === 'regnamespace' ? 'namespace' : 'reference';
    if (isName(code[i - 2]) && namespaceColumns.has(at(i - 2)) && at(i - 1) === '=') kind = 'namespace';
    if (at(i + 1) === '=' && isName(code[i + 2]) && namespaceColumns.has(at(i + 2))) kind = 'namespace';
    if (at(i + 1) === '=' && isName(code[i + 2]) && at(i + 3) === '.'
      && isName(code[i + 4]) && namespaceColumns.has(at(i + 4))) kind = 'namespace';
    const body = (isName(code[i - 1]) && ['as', 'do'].includes(at(i - 1)))
      || (at(i - 3) === 'do' && at(i - 2) === 'language' && at(i - 1) === 'plpgsql');
    if (token.type === 'dollar' && body) kind = 'body';
    if (token.type === 'string' && body) fail('single-quoted function bodies');
    if (kind === 'namespace') {
      if (!['public', 'storage', targets.schema, targets.storageSchema].includes(token.value)) {
        fail('unreviewed namespace literal');
      }
      if (['public', 'storage'].includes(token.value)) setLiteral(token, replacement(token.value));
    } else if (kind === 'reference') {
      // A reference is a single static reg* name, not executable SQL.
      const schemas = `public|storage|${targets.schema}|${targets.storageSchema}`;
      const reference = new RegExp(`^(?:(?:"(?:${schemas})"|(?:${schemas}))\\s*\\.\\s*)?(?:"[^"]+"|[a-zA-Z_][a-zA-Z_0-9]*)(?:\\([^;]*\\))?$`);
      if (!reference.test(token.value)) {
        fail('unreviewed reg* reference');
      }
      const rewritten = rewrite(token.value, targets, depth + 1, true);
      setLiteral(token, rewritten);
    } else if (['dynamic SQL', 'constraint patch', 'SQL patch', 'body'].includes(kind)) {
      if (kind === 'dynamic SQL' && /(?:%[0-9$]*[ILs])\s*\./.test(token.value)) {
        fail('dynamic schema qualifier');
      }
      if (kind === 'dynamic SQL' && /%s/.test(token.value)
        && !/^(?:revoke all on function %s from|grant execute on function %s to) [a-z_,]+$/i.test(token.value)) {
        fail('unreviewed raw SQL interpolation');
      }
      setLiteral(token, rewrite(token.value, targets, depth + 1, kind !== 'body'));
    } else if (['public', 'storage'].includes(token.value)
      && ((isName(code[i - 3]) && namespaceColumns.has(at(i - 3)))
        || (isName(code[i - 2]) && namespaceColumns.has(at(i - 2))))) {
      fail('ambiguous namespace comparison');
    }
  }

  // EXECUTE src is limited to the reviewed pg_get_functiondef/replace pattern;
  // all regprocedure literals and SQL fragments in that pattern were retargeted.
  if (code.some((t, i) => isName(t) && at(i) === 'execute' && at(i + 1) === 'src')
    && !code.some((t, i) => isName(t) && at(i) === 'src' && at(i + 1) === ':=' && at(i + 2) === 'pg_get_functiondef')) {
    fail('dynamic SQL source has no reviewed function-definition origin');
  }
  if (code.some((t, i) => isName(t) && at(i) === 'set'
    && (['role', 'session_authorization', 'authorization'].includes(at(i + 1))
      || (['local', 'session'].includes(at(i + 1)) && at(i + 2) !== 'search_path')))) {
    fail('role/session mutation');
  }
  return tokens.map(t => t.raw).join('');
}

/**
 * Retarget reviewed SQL without executing it or modifying unqualified names.
 * Unqualified objects require the caller's private search_path. Production role
 * names and PUBLIC grants are intentionally untouched; isolation is role-enforced.
 */
function retargetSql(sql, options) {
  if (typeof sql !== 'string') throw new TypeError('SQL must be a string');
  if (!options || typeof options !== 'object') throw new TypeError('Namespace options required');
  const { schema, storageSchema } = options;
  validateNamespace(schema, 'schema');
  validateNamespace(storageSchema, 'storageSchema');
  if (schema === storageSchema) throw new Error('App and storage schemas must be distinct');
  return rewrite(sql, { schema, storageSchema });
}

module.exports = { retargetSql, validateSourceName };
