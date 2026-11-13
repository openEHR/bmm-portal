#!/usr/bin/env node
// BMM Portal generator: reads openEHR P_BMM JSON schemas and writes a static site to ./site.
// No dependencies. Node >= 18.
//
// Env overrides:
//   BMM_DIR        components dir of specifications-ITS-BMM (default ../specifications-ITS-BMM/components)
//   DIAGRAM_DIR    bmm-publisher Adoc output with PlantUML SVGs (default ../bmm-publisher/output/Adoc); optional.
//                  A dark variant next to a diagram (<name>.dark.svg) is used in dark mode.
//   SPECS_DIR      folder holding specifications-<COMP> checkouts, for manifest.json (default ..)
//   OUT_DIR       output dir (default ./site)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BMM_DIR = path.resolve(process.env.BMM_DIR || path.join(ROOT, '../specifications-ITS-BMM/components'));
const SPECS_DIR = path.resolve(process.env.SPECS_DIR || path.join(ROOT, '..'));
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, 'site'));
const SRC = path.join(ROOT, 'src');
const DIAGRAM_DIR = path.resolve(process.env.DIAGRAM_DIR || path.join(ROOT, '../bmm-publisher/output/Adoc'));

const log = (...a) => console.log('[bmm-portal]', ...a);

// ---------------------------------------------------------------- load schemas
const schemas = new Map(); // id -> { id, component, release, raw, classes: Map(name -> raw) }

for (const component of fs.readdirSync(BMM_DIR).sort()) {
  const jsonDir = path.join(BMM_DIR, component, 'json');
  if (!fs.existsSync(jsonDir)) continue;
  for (const file of fs.readdirSync(jsonDir).filter((f) => f.endsWith('.bmm.json')).sort()) {
    const id = file.replace(/\.bmm\.json$/, '');
    const raw = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf8'));
    const release = id.replace(/^[a-z]+_[a-z0-9]+_/i, '');
    const classes = new Map();
    for (const [name, c] of Object.entries(raw.primitive_types || {})) classes.set(name, { ...c, name: c.name || name, _primitive: true });
    for (const [name, c] of Object.entries(raw.class_definitions || {})) classes.set(name, { ...c, name: c.name || name });
    schemas.set(id, { id, component, release, raw, classes });
  }
}
if (!schemas.size) {
  console.error(`No BMM schemas found under ${BMM_DIR}`);
  process.exit(1);
}
log(`loaded ${schemas.size} schemas from ${BMM_DIR}`);

// ---------------------------------------------------------------- includes / scope
function includeClosure(id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  const s = schemas.get(id);
  if (!s) return seen;
  for (const inc of Object.keys(s.raw.includes || {})) {
    if (!schemas.has(inc)) log(`WARN ${id} includes unknown schema ${inc}`);
    includeClosure(inc, seen);
  }
  return seen;
}

// Older schemas (RM 1.0.2/1.0.3, TERM, LANG 1.0.0) declare no includes but use BASE types
// (String, Any, List...). As a last resort, resolve such names against the latest BASE release.
const latestBase = [...schemas.values()]
  .filter((s) => s.component === 'BASE' && !s.release.includes('-'))
  .sort((a, b) => b.release.localeCompare(a.release, undefined, { numeric: true }))[0]?.id;

// scope: class name -> defining schema id (own schema wins, then includes in order, then BASE fallback)
for (const s of schemas.values()) {
  s.closure = [...includeClosure(s.id)];
  s.explicit = new Set(s.closure);
  s.implicitBase = latestBase && !s.closure.some((id) => schemas.get(id)?.component === 'BASE') ? latestBase : null;
  if (s.implicitBase) s.closure.push(...includeClosure(s.implicitBase));
  s.scope = new Map();
  for (const sid of s.closure) {
    const t = schemas.get(sid);
    if (!t) continue;
    for (const name of t.classes.keys()) if (!s.scope.has(name)) s.scope.set(name, sid);
  }
}

const findClass = (schema, name) => {
  const sid = schema.scope.get(name);
  return sid ? { sid, cls: schemas.get(sid).classes.get(name) } : null;
};

// ---------------------------------------------------------------- types
function typeOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (x.container_type) {
    const inner = x.type_def ? typeOf(x.type_def) : x.type;
    return `${x.container_type}<${inner || '?'}>`;
  }
  if (x.root_type) {
    const params = x.generic_parameter_defs
      ? Object.values(x.generic_parameter_defs).map(typeOf)
      : (x.generic_parameters || []).map(typeOf);
    return `${x.root_type}<${params.join(', ')}>`;
  }
  if (x.type_def) return typeOf(x.type_def);
  if (x.type) return typeOf(x.type);
  return '';
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const identsOf = (t) => (t.match(IDENT) || []);

function multiplicity(p) {
  if (p._type === 'P_BMM_CONTAINER_PROPERTY') {
    const c = p.cardinality || {};
    const lo = c.lower ?? 0;
    const hi = c.upper_unbounded || c.upper == null ? '*' : c.upper;
    return `${lo}..${hi}`;
  }
  return p.is_mandatory ? '1..1' : '0..1';
}

const warned = new Set();
function propOut(p, owner) {
  if (owner && p._type === 'P_BMM_CONTAINER_PROPERTY' && !p.type_def?.type && !p.type_def?.type_def && !warned.has(owner + p.name)) {
    warned.add(owner + p.name);
    log(`WARN ${owner}.${p.name}: container property without element type (shown as ?)`);
  }
  const o = {
    name: p.name,
    type: typeOf(p.type_def ? p.type_def : p.type),
    mult: multiplicity(p),
    doc: p.documentation || '',
  };
  if (p.default !== undefined) o.default = typeof p.default === 'string' ? p.default : JSON.stringify(p.default);
  if (p.is_im_runtime) o.runtime = true;
  return o;
}

function condList(x) {
  if (!x) return [];
  return Object.entries(x).map(([k, v]) => ({ name: k, expr: typeof v === 'string' ? v : JSON.stringify(v) }));
}

function classKind(c) {
  if (/ENUMERATION/.test(c._type || '')) return 'enum';
  if (c._primitive) return 'primitive';
  if (c.is_abstract) return 'abstract';
  return 'class';
}

// ---------------------------------------------------------------- packages
function packageTree(raw) {
  const out = [];
  const walk = (pkg, parentPath) => {
    const name = pkg.name;
    const p = parentPath ? `${parentPath}.${name}` : name;
    const node = { name, path: p, classes: [...(pkg.classes || [])], packages: [] };
    for (const sub of Object.values(pkg.packages || {})) node.packages.push(walk(sub, p));
    return node;
  };
  for (const top of Object.values(raw.packages || {})) out.push(walk(top, ''));
  return out;
}

function packageOfIndex(tree) {
  const m = new Map();
  const walk = (n) => { for (const c of n.classes) m.set(c, n.path); n.packages.forEach(walk); };
  tree.forEach(walk);
  return m;
}

// ---------------------------------------------------------------- diagrams (bmm-publisher PlantUML SVGs)
// classes/<prefix.>name.svg -> class; diagrams/<COMP>-<package>.svg -> package. <base>.dark.svg = dark variant.
function indexDiagrams(id) {
  const dir = path.join(DIAGRAM_DIR, id, 'images', 'uml');
  const res = { classes: new Map(), packages: new Map(), dir, count: 0, dark: 0 };
  for (const [kind, map, keyOf] of [
    ['classes', res.classes, (b) => b.split('.').pop()],
    ['diagrams', res.packages, (b) => b.replace(/^[A-Za-z0-9]+-/, '')],
  ]) {
    const d = path.join(dir, kind);
    if (!fs.existsSync(d)) continue;
    const files = new Set(fs.readdirSync(d));
    for (const f of files) {
      if (!f.endsWith('.svg') || f.endsWith('.dark.svg')) continue;
      const base = f.replace(/.svg$/, '');
      const dark = files.has(`${base}.dark.svg`) ? `diagrams/${id}/${kind}/${base}.dark.svg` : null;
      map.set(keyOf(base).toLowerCase(), { src: `diagrams/${id}/${kind}/${f}`, dark });
      res.count++;
      if (dark) res.dark++;
    }
  }
  return res;
}

// ---------------------------------------------------------------- cross-schema reverse indexes
// descendants[sid][name] = [{schema, name}], usedBy[sid][name] = [{schema, cls, member}]
const descendants = new Map();
const usedBy = new Map();
const push = (map, sid, name, v) => {
  if (!map.has(sid)) map.set(sid, new Map());
  const m = map.get(sid);
  if (!m.has(name)) m.set(name, []);
  m.get(name).push(v);
};

for (const s of schemas.values()) {
  for (const c of s.classes.values()) {
    const gparams = new Set(Object.keys(c.generic_parameter_defs || {}));
    for (const a of c.ancestors || []) {
      const f = findClass(s, a.replace(/<.*$/, ''));
      if (f && s.explicit.has(f.sid)) push(descendants, f.sid, a.replace(/<.*$/, ''), { schema: s.id, name: c.name });
    }
    const refs = [];
    for (const p of Object.values(c.properties || {})) refs.push([p.name, propOut(p).type]);
    for (const fn of Object.values(c.functions || {})) {
      refs.push([`${fn.name}()`, typeOf(fn.result)]);
      for (const pa of Object.values(fn.parameters || {})) refs.push([`${fn.name}()`, typeOf(pa.type_def || pa.type)]);
    }
    for (const [member, t] of refs) {
      const seen = new Set();
      for (const id of identsOf(t)) {
        if (gparams.has(id) || seen.has(id) || id === c.name) continue;
        seen.add(id);
        const f = findClass(s, id);
        if (f && s.explicit.has(f.sid)) push(usedBy, f.sid, id, { schema: s.id, cls: c.name, member });
      }
    }
  }
}

// ---------------------------------------------------------------- per-schema output
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data', 'schemas'), { recursive: true });

function effectiveProps(s, c) {
  // inherited properties, nearest ancestor first, deduplicated by name (own props win)
  const own = new Set(Object.keys(c.properties || {}));
  const out = [];
  const visited = new Set();
  const walk = (cls, schema) => {
    for (const a of cls.ancestors || []) {
      const an = a.replace(/<.*$/, '');
      if (visited.has(an)) continue;
      visited.add(an);
      const f = findClass(schema, an);
      if (!f) continue;
      const as = schemas.get(f.sid);
      for (const p of Object.values(f.cls.properties || {})) {
        if (own.has(p.name)) continue;
        own.add(p.name);
        out.push({ ...propOut(p), from: an, fromSchema: f.sid });
      }
      walk(f.cls, as);
    }
  };
  walk(c, s);
  return out;
}

function allAncestors(s, c) {
  const out = [];
  const seen = new Set();
  const walk = (cls, schema) => {
    for (const a of cls.ancestors || []) {
      const an = a.replace(/<.*$/, '');
      if (seen.has(an)) continue;
      seen.add(an);
      const f = findClass(schema, an);
      out.push({ name: a, schema: f ? f.sid : null });
      if (f) walk(f.cls, schemas.get(f.sid));
    }
  };
  walk(c, s);
  return out;
}

const diagramTotals = { count: 0, dark: 0 };
const index = { generated: new Date().toISOString(), schemas: {}, components: [], search: [] };

for (const s of schemas.values()) {
  const tree = packageTree(s.raw);
  const pkgOf = packageOfIndex(tree);

  const dia = indexDiagrams(s.id);
  diagramTotals.count += dia.count;
  diagramTotals.dark += dia.dark;
  for (const kind of ['classes', 'diagrams']) {
    const from = path.join(dia.dir, kind);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(OUT, 'diagrams', s.id, kind), { recursive: true });
  }

  const classes = {};
  for (const c of s.classes.values()) {
    const gdefs = Object.values(c.generic_parameter_defs || {}).map((g) => ({ name: g.name, conformsTo: g.conforms_to_type || null }));
    const out = {
      name: c.name,
      kind: classKind(c),
      generics: gdefs,
      doc: c.documentation || '',
      package: pkgOf.get(c.name) || null,
      ancestors: (c.ancestors || []).map((a) => ({ name: a, schema: s.scope.get(a.replace(/<.*$/, '')) || null })),
      allAncestors: allAncestors(s, c),
      properties: Object.values(c.properties || {}).map((p) => propOut(p, `${s.id}:${c.name}`)),
      inherited: effectiveProps(s, c),
      functions: Object.values(c.functions || {}).map((fn) => ({
        name: fn.name,
        doc: fn.documentation || '',
        params: Object.values(fn.parameters || {}).map((pa) => ({ name: pa.name, type: typeOf(pa.type_def || pa.type), nullable: !!pa.is_nullable })),
        result: typeOf(fn.result),
        abstract: !!fn.is_abstract,
        aliases: fn.aliases || [],
        pre: condList(fn.pre_conditions),
        post: condList(fn.post_conditions),
      })),
      invariants: condList(c.invariants),
      constants: Object.values(c.constants || {}).map((k) => ({ name: k.name, type: typeOf(k.type), value: k.value ?? '', doc: k.documentation || '' })),
      items: (c.item_names || []).map((n, i) => ({ name: n, value: c.item_values ? c.item_values[i] : i, doc: (c.item_documentations || [])[i] || '' })),
      descendants: descendants.get(s.id)?.get(c.name) || [],
      usedBy: usedBy.get(s.id)?.get(c.name) || [],
      diagram: dia.classes.get(c.name.toLowerCase()) || null,
    };
    classes[c.name] = out;
  }

  const decoratePkg = (n) => {
    const d = dia.packages.get(n.name.toLowerCase());
    if (d) n.diagram = d;
    n.packages.forEach(decoratePkg);
  };
  tree.forEach(decoratePkg);

  const r = s.raw;
  const schemaOut = {
    id: s.id,
    component: s.component,
    release: s.release,
    meta: {
      schema_name: r.schema_name,
      rm_publisher: r.rm_publisher,
      rm_release: r.rm_release,
      schema_revision: r.schema_revision,
      lifecycle: r.schema_lifecycle_state,
      description: r.schema_description,
      author: r.schema_author,
      bmm_version: r.bmm_version,
      includes: Object.keys(r.includes || {}),
      implicitBase: s.implicitBase,
    },
    scope: Object.fromEntries([...s.scope].filter(([, sid]) => sid !== s.id)),
    packages: tree,
    classes,
  };
  fs.writeFileSync(path.join(OUT, 'data', 'schemas', `${s.id}.json`), JSON.stringify(schemaOut));

  // index entry: tree with class kinds for nav
  const kinds = Object.fromEntries(Object.values(classes).map((c) => [c.name, c.kind[0]]));
  index.schemas[s.id] = {
    id: s.id,
    component: s.component,
    release: s.release,
    lifecycle: r.schema_lifecycle_state || '',
    description: r.schema_description || '',
    includes: Object.keys(r.includes || {}),
    classCount: s.classes.size,
    kinds,
    packages: tree,
  };

  for (const c of Object.values(classes)) {
    index.search.push([c.name, c.kind === 'enum' ? 'enum' : 'class', s.id, '']);
    for (const p of c.properties) index.search.push([p.name, 'property', s.id, c.name]);
    for (const f of c.functions) index.search.push([f.name, 'function', s.id, c.name]);
  }
  const walkPkg = (n) => { index.search.push([n.name, 'package', s.id, n.path]); n.packages.forEach(walkPkg); };
  tree.forEach(walkPkg);
}

// components and latest release
const semverKey = (rel) => {
  const [num, suffix] = rel.split('-');
  const parts = num.split('.').map((x) => parseInt(x, 10) || 0);
  return { parts, suffix: suffix || '' };
};
const cmp = (a, b) => {
  const A = semverKey(a), B = semverKey(b);
  for (let i = 0; i < 3; i++) if ((A.parts[i] || 0) !== (B.parts[i] || 0)) return (A.parts[i] || 0) - (B.parts[i] || 0);
  if (A.suffix === B.suffix) return 0;
  return A.suffix ? 1 : -1; // suffixed variant sorts after plain release, but is not "latest"
};
const byComp = new Map();
for (const s of schemas.values()) {
  if (!byComp.has(s.component)) byComp.set(s.component, []);
  byComp.get(s.component).push(s);
}
// Published releases come from each spec repo's manifest.json: a release with a date is published.
//   development = newest BMM schema (plain version, no suffix)
//   latest      = newest BMM schema whose version is a published release (falls back to development)
function publishedReleases(component) {
  const file = path.join(SPECS_DIR, `specifications-${component}`, 'manifest.json');
  if (!fs.existsSync(file)) { log(`WARN no ${file}; latest = development for ${component}`); return null; }
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const norm = (v) => String(v).split('.').concat(['0', '0']).slice(0, 3).join('.'); // "1.4" -> "1.4.0"
  return new Set((m.releases || []).filter((r) => r.date).map((r) => norm(r.id)));
}
for (const [component, list] of byComp) {
  list.sort((a, b) => cmp(b.release, a.release));
  const dev = list.find((s) => !s.release.includes('-')) || list[0];
  const published = publishedReleases(component);
  const latest = (published && list.find((s) => !s.release.includes('-') && published.has(s.release))) || dev;
  const rest = list.filter((s) => s !== dev && s !== latest);
  index.components.push({
    name: component,
    development: dev.id,
    latest: latest.id,
    // switcher order: development, latest, then older versions (newest first)
    releases: [dev, ...(latest !== dev ? [latest] : []), ...rest].map((s) => ({ id: s.id, release: s.release, published: !!published?.has(s.release) })),
  });
  log(`${component}: development ${dev.release}, latest ${latest.release}${rest.length ? `, older ${rest.map((s) => s.release).join(' ')}` : ''}`);
}
const ORDER = ['RM', 'AM', 'BASE', 'LANG', 'TERM'];
index.components.sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name));

fs.writeFileSync(path.join(OUT, 'data', 'index.json'), JSON.stringify(index));

// static app
for (const f of fs.readdirSync(SRC)) fs.cpSync(path.join(SRC, f), path.join(OUT, f), { recursive: true });

log(`wrote ${OUT}: ${schemas.size} schemas, ${index.search.length} search entries, ${diagramTotals.count} diagrams (${diagramTotals.dark} with dark variant)${diagramTotals.count ? '' : ` — none found in ${DIAGRAM_DIR}`}`);
