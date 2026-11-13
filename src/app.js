/* openEHR BMM Portal — client. No dependencies. Data is produced by build/build.mjs. */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND_LABEL = { class: 'Class', abstract: 'Abstract class', enum: 'Enumeration', primitive: 'Primitive type' };
  const KIND_ICON = { c: 'C', a: 'A', e: 'E', p: 'P' };

  let INDEX = null;
  const schemaCache = new Map();

  // ------------------------------------------------------------ data
  async function loadIndex() {
    const r = await fetch('data/index.json');
    if (!r.ok) throw new Error('Cannot load data/index.json — run the build first.');
    INDEX = await r.json();
  }
  function loadSchema(id) {
    if (!schemaCache.has(id)) {
      schemaCache.set(id, fetch(`data/schemas/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Cannot load schema ${id}`);
        return r.json();
      }));
    }
    return schemaCache.get(id);
  }
  const comp = (name) => INDEX.components.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
  const schemaIdFor = (component, release) => {
    const c = comp(component);
    if (!c) return null;
    const rel = release === 'latest' || !release ? c.latest : release;
    return c.releases.find((r) => r.release === rel)?.id || null;
  };
  const isLatest = (sid) => { const s = INDEX.schemas[sid]; return comp(s.component)?.latest === s.release; };

  // ------------------------------------------------------------ links
  const hrefSchema = (sid) => { const s = INDEX.schemas[sid]; return `#/${s.component}/${s.release}`; };
  const hrefClass = (sid, name, member) => `${hrefSchema(sid)}/class/${encodeURIComponent(name)}${member ? '/' + encodeURIComponent(member) : ''}`;
  const hrefPkg = (sid, p) => `${hrefSchema(sid)}/package/${encodeURIComponent(p)}`;
  const label = (sid) => { const s = INDEX.schemas[sid]; return `${s.component} ${s.release}`; };

  function classLink(sid, name, text) {
    return `<a href="${hrefClass(sid, name)}" class="cls">${esc(text ?? name)}</a>`;
  }

  // Link every identifier in a type string that names a class in scope.
  function typeHtml(t, schema) {
    if (!t) return '';
    return esc(t).replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
      const sid = schema.classes[id] ? schema.id : schema.scope[id];
      return sid ? classLink(sid, id) : id;
    });
  }

  // BMM documentation: Markdown-ish (`code`, `_em_`, **strong**, lists, paragraphs).
  function docHtml(text, schema) {
    if (!text) return '';
    const inline = (s) => {
      const parts = s.split(/(`[^`]+`)/g);
      return parts.map((p) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 1) {
          const inner = p.slice(1, -1);
          const bare = inner.replace(/^_|_$/g, '').replace(/\(\)$/, '').replace(/<.*$/, '');
          const sid = schema && (schema.classes[bare] ? schema.id : schema.scope[bare]);
          if (sid) return `<code>${classLink(sid, bare, inner.replace(/^_|_$/g, ''))}</code>`;
          return `<code>${esc(inner).replace(/^_(.+)_$/, '<em>$1</em>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')}</code>`;
        }
        return esc(p)
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
          .replace(/(https?:\/\/[^\s<[\]]+)\[([^\]]*)\]/g, (m, u, t) => `<a href="${u}" rel="noopener">${t || u}</a>`) // AsciiDoc url[text]
          .replace(/(^|[^"'>])(https?:\/\/[^\s<)\]]+)/g, '$1<a href="$2" rel="noopener">$2</a>');
      }).join('');
    };
    const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
    return blocks.map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[*-]\s+/.test(l) || !l.trim())) {
        return `<ul>${lines.filter((l) => l.trim()).map((l) => `<li>${inline(l.replace(/^\s*[*-]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }
  const firstSentence = (t) => { const s = (t || '').replace(/\s+/g, ' ').trim(); const m = s.match(/^(.+?[.!?])(\s|$)/); return m ? m[1] : s; };

  // ------------------------------------------------------------ tree
  const tree = $('#tree');

  function treeItem({ text, href, icon, kind, expandable, onExpand, title }) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    if (expandable) li.setAttribute('aria-expanded', 'false');
    li.innerHTML = `<div class="row">${expandable ? '<button class="twisty" tabindex="-1" aria-hidden="true"></button>' : '<span class="twisty-sp"></span>'}`
      + `${icon ? `<span class="ic ic-${kind || ''}" aria-hidden="true">${esc(icon)}</span>` : ''}`
      + `<a href="${href}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</a></div>`;
    if (expandable) {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      li.appendChild(ul);
      li._expand = (open = true) => {
        if (open && !li._filled) { li._filled = true; onExpand(ul); }
        li.setAttribute('aria-expanded', String(open));
      };
      li.querySelector('.twisty').addEventListener('click', () => li._expand(li.getAttribute('aria-expanded') !== 'true'));
    }
    return li;
  }

  function pkgItem(sid, node) {
    const count = countClasses(node);
    return Object.assign(treeItem({
      text: node.name, href: hrefPkg(sid, node.path), icon: '▣', kind: 'pkg', expandable: true, title: `${node.path} (${count} classes)`,
      onExpand: (ul) => {
        node.packages.forEach((p) => ul.appendChild(pkgItem(sid, p)));
        [...node.classes].sort().forEach((c) => {
          const k = INDEX.schemas[sid].kinds[c] || 'c';
          const li = treeItem({ text: c, href: hrefClass(sid, c), icon: KIND_ICON[k] || 'C', kind: k });
          li.dataset.key = `${sid}|class|${c}`;
          ul.appendChild(li);
        });
      },
    }), { _key: `${sid}|pkg|${node.path}` });
  }
  const countClasses = (n) => n.classes.length + n.packages.reduce((a, p) => a + countClasses(p), 0);

  function buildTree() {
    tree.innerHTML = '';
    for (const c of INDEX.components) {
      const li = treeItem({
        text: c.name, href: `#/${c.name}/${c.latest}`, icon: '◆', kind: 'comp', expandable: true,
        onExpand: (ul) => {
          for (const r of c.releases) {
            const s = INDEX.schemas[r.id];
            const rli = treeItem({
              text: r.release + (r.release === c.latest ? '  · latest' : ''), href: hrefSchema(r.id), icon: '⎇', kind: 'rel', expandable: true,
              title: `${s.classCount} classes${s.lifecycle ? ' · ' + s.lifecycle : ''}`,
              onExpand: (ul2) => s.packages.forEach((p) => ul2.appendChild(pkgItem(r.id, p))),
            });
            rli._key = `${r.id}|schema`;
            ul.appendChild(rli);
          }
        },
      });
      li._key = `comp|${c.name}`;
      tree.appendChild(li);
    }
    tree.querySelectorAll('li')[0]?.querySelector('a')?.setAttribute('tabindex', '0');
  }

  // Expand the path to the current page and mark it.
  function revealInTree(sid, pkgPath, className) {
    tree.querySelectorAll('[aria-current]').forEach((a) => a.removeAttribute('aria-current'));
    if (!sid) return;
    const s = INDEX.schemas[sid];
    const find = (ul, key) => [...ul.children].find((li) => li._key === key || li.dataset.key === key);
    const compLi = find(tree, `comp|${s.component}`);
    if (!compLi) return;
    compLi._expand(true);
    const relLi = find(compLi.querySelector('ul'), `${sid}|schema`);
    if (!relLi) return;
    relLi._expand(true);
    let cur = relLi;
    if (pkgPath) {
      for (const seg of splitPkg(sid, pkgPath)) {
        const li = find(cur.querySelector('ul'), `${sid}|pkg|${seg.path}`);
        if (!li) break;
        li._expand(true);
        cur = li;
      }
      if (className) {
        const cli = find(cur.querySelector('ul'), `${sid}|class|${className}`);
        if (cli) cur = cli;
      }
    }
    const a = cur.querySelector(':scope > .row > a');
    a.setAttribute('aria-current', 'page');
    a.scrollIntoView({ block: 'nearest' });
  }

  // Arrow-key navigation in the tree.
  tree.addEventListener('keydown', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const li = a.closest('li');
    const visible = [...tree.querySelectorAll('li')].filter((x) => x.offsetParent !== null).map((x) => x.querySelector(':scope > .row > a'));
    const i = visible.indexOf(a);
    const focus = (el) => { if (el) { visible.forEach((v) => v.setAttribute('tabindex', '-1')); el.setAttribute('tabindex', '0'); el.focus(); } };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focus(visible[i + 1]); break;
      case 'ArrowUp': e.preventDefault(); focus(visible[i - 1]); break;
      case 'ArrowRight':
        e.preventDefault();
        if (li._expand && li.getAttribute('aria-expanded') !== 'true') li._expand(true); else focus(visible[i + 1]);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (li._expand && li.getAttribute('aria-expanded') === 'true') li._expand(false);
        else focus(li.parentElement.closest('li')?.querySelector(':scope > .row > a'));
        break;
      default:
    }
  });

  // ------------------------------------------------------------ views
  const main = $('#main');

  function crumbs(sid, pkgPath, tail) {
    const s = INDEX.schemas[sid];
    const parts = [`<a href="#/">Home</a>`, `<a href="#/${s.component}/${c(s.component).latest}">${esc(s.component)}</a>`, `<a href="${hrefSchema(sid)}">${esc(s.release)}</a>`];
    if (pkgPath) {
      const segs = splitPkg(sid, pkgPath);
      segs.forEach((seg) => parts.push(`<a href="${hrefPkg(sid, seg.path)}">${esc(seg.name)}</a>`));
    }
    if (tail) parts.push(`<span>${esc(tail)}</span>`);
    return `<nav class="crumbs" aria-label="Breadcrumb">${parts.join('<span class="sep">/</span>')}</nav>`;
  }
  const c = comp;

  // Split a dotted package path into tree nodes (top-level names can contain dots).
  function splitPkg(sid, p) {
    const out = [];
    let nodes = INDEX.schemas[sid].packages;
    let rest = p;
    while (rest && nodes) {
      const n = nodes.find((x) => rest === x.name || rest.startsWith(x.name + '.'));
      if (!n) break;
      out.push(n);
      rest = rest === n.name ? '' : rest.slice(n.name.length + 1);
      nodes = n.packages;
    }
    return out;
  }
  const findPkg = (sid, p) => { const segs = splitPkg(sid, p); const last = segs[segs.length - 1]; return last && last.path === p ? last : null; };

  function releaseSwitcher(sid, className) {
    const s = INDEX.schemas[sid];
    const cc = c(s.component);
    const opts = cc.releases.map((r) => {
      const has = !className || INDEX.schemas[r.id].kinds[className];
      return `<option value="${r.id}"${r.id === sid ? ' selected' : ''}${has ? '' : ' disabled'}>${esc(r.release)}${r.release === cc.latest ? ' (latest)' : ''}${has ? '' : ' — not present'}</option>`;
    }).join('');
    return `<label class="relsw">Release <select data-relsw="${esc(className || '')}">${opts}</select></label>`;
  }
  main.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-relsw]');
    if (sel) location.hash = sel.dataset.relsw ? hrefClass(sel.value, sel.dataset.relsw) : hrefSchema(sel.value);
    const inh = e.target.closest('#showInherited');
    if (inh) {
      main.querySelectorAll('tr.inherited').forEach((tr) => { tr.hidden = !inh.checked; });
      try { localStorage.setItem('bmm-inherited', inh.checked ? '1' : '0'); } catch (err) { /* ignore */ }
    }
  });

  function viewHome() {
    document.title = 'openEHR BMM Portal';
    const cards = INDEX.components.map((cc) => {
      const s = INDEX.schemas[cc.releases.find((r) => r.release === cc.latest).id];
      return `<a class="card" href="#/${cc.name}/${cc.latest}">
        <div class="card-h"><span class="card-name">${esc(cc.name)}</span><span class="badge">${esc(cc.latest)}</span></div>
        <p>${esc(firstSentence(s.description) || '')}</p>
        <div class="card-f">${s.classCount} classes · ${cc.releases.length} release${cc.releases.length > 1 ? 's' : ''}</div></a>`;
    }).join('');
    main.innerHTML = `
      <section class="hero">
        <h1>openEHR BMM Portal</h1>
        <p>Browse the openEHR models (Reference Model, Archetype Model, BASE, LANG and TERM), generated directly from the published
        <a href="https://github.com/openEHR/specifications-ITS-BMM" rel="noopener">BMM schemas</a>.
        Pick a component below, browse the package tree on the left, or press <kbd>/</kbd> to search.</p>
      </section>
      <div class="cards">${cards}</div>
      <p class="muted small">Generated ${esc(new Date(INDEX.generated).toLocaleString())}.</p>`;
  }

  async function viewSchema(sid) {
    const schema = await loadSchema(sid);
    const m = schema.meta;
    document.title = `${label(sid)} — BMM Portal`;
    const rows = [
      ['Schema', m.schema_name], ['Publisher', m.rm_publisher], ['Release', m.rm_release], ['Revision', m.schema_revision],
      ['Lifecycle', m.lifecycle], ['BMM version', m.bmm_version], ['Author', m.author],
    ].filter(([, v]) => v).map(([k, v]) => `<tr><th scope="row">${k}</th><td>${esc(v)}</td></tr>`).join('');
    const inc = m.includes.map((i) => INDEX.schemas[i] ? `<a href="${hrefSchema(i)}">${esc(label(i))}</a>` : esc(i)).join(', ');
    const pkgRow = (n, depth) => `<tr><td style="padding-left:${0.75 + depth * 1.25}rem"><a href="${hrefPkg(sid, n.path)}">${esc(n.name)}</a></td><td class="num">${n.classes.length}</td></tr>`
      + n.packages.map((p) => pkgRow(p, depth + 1)).join('');
    main.innerHTML = `
      <header class="page-h">${crumbs(sid)}
        <div class="title-row"><h1>${esc(schema.component)} <span class="light">${esc(schema.release)}</span></h1>${releaseSwitcher(sid)}</div>
      </header>
      <div class="content">
        ${m.description ? `<section class="doc">${docHtml(m.description, schema)}</section>` : ''}
        <section><h2>Characteristics</h2><table class="kv">${rows}${inc ? `<tr><th scope="row">Includes</th><td>${inc}</td></tr>` : ''}
          <tr><th scope="row">Classes</th><td>${Object.keys(schema.classes).length}</td></tr></table></section>
        <section><h2>Packages</h2><table class="grid"><thead><tr><th>Package</th><th class="num">Classes</th></tr></thead>
          <tbody>${schema.packages.map((p) => pkgRow(p, 0)).join('')}</tbody></table></section>
      </div>`;
    revealInTree(sid);
  }

  async function viewPackage(sid, p) {
    const schema = await loadSchema(sid);
    currentSchema = schema;
    const node = findPkg(sid, p);
    if (!node) return notFound(`Package ${p} not found in ${label(sid)}.`);
    document.title = `${node.name} — ${label(sid)} — BMM Portal`;
    const classes = [...node.classes].sort().map((n) => schema.classes[n]).filter(Boolean);
    main.innerHTML = `
      <header class="page-h">${crumbs(sid, p)}
        <div class="title-row"><h1><span class="ic ic-pkg big" aria-hidden="true">▣</span>${esc(node.name)}</h1>${releaseSwitcher(sid)}</div>
        <div class="sub">Package <code>${esc(node.path)}</code></div>
      </header>
      <div class="content">
        ${node.packages.length ? `<section><h2>Sub-packages</h2><ul class="chips">${node.packages.map((s) => `<li><a href="${hrefPkg(sid, s.path)}">${esc(s.name)}</a> <span class="muted">${countClasses(s)}</span></li>`).join('')}</ul></section>` : ''}
        ${node.diagram ? diagramSection(node.diagram, 'Package diagram') : ''}
        ${classes.length ? `<section><h2>Classes</h2><table class="grid"><thead><tr><th>Name</th><th>Kind</th><th>Summary</th></tr></thead><tbody>
          ${classes.map((k) => `<tr><td>${classLink(sid, k.name, displayName(k))}</td><td>${esc(KIND_LABEL[k.kind])}</td><td>${docHtml(firstSentence(k.doc), schema)}</td></tr>`).join('')}
        </tbody></table></section>` : ''}
      </div>`;
    hydrateDiagrams(schema);
    revealInTree(sid, p);
  }

  const displayName = (k) => k.generics.length ? `${k.name}<${k.generics.map((g) => g.name).join(', ')}>` : k.name;

  // Diagrams: PlantUML SVGs from bmm-publisher. A dark variant is used in dark mode when bmm-publisher wrote one.
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  function diagramSection(d, title) {
    return `<section><h2>${esc(title)}</h2>
      <div class="diagram" data-src="${esc(d.src)}" data-dark="${esc(d.dark || '')}"><p class="muted">Loading diagram…</p></div>
      <p class="small"><a href="${esc(d.src)}" target="_blank" rel="noopener" class="dg-full">Open full size</a></p></section>`;
  }

  // Inline the SVG (so boxes can be clicked); strip anything executable.
  function hydrateDiagrams(schema) {
    return Promise.all([...main.querySelectorAll('.diagram[data-src]')].map(async (box) => {
      const src = isDark() && box.dataset.dark ? box.dataset.dark : box.dataset.src;
      if (box.dataset.shown === src) { box.classList.toggle('is-inverted', isDark() && src !== box.dataset.dark); return; }
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error(r.status);
        const svg = new DOMParser().parseFromString(await r.text(), 'image/svg+xml').documentElement;
        if (svg.nodeName !== 'svg') throw new Error('not svg');
        svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
        svg.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((at) => { if (/^on/i.test(at.name)) n.removeAttribute(at.name); }));
        svg.removeAttribute('style');
        svg.setAttribute('role', 'img');
        const live = document.importNode(svg, true); // attach everything to the imported copy, not the parsed one
        live.querySelectorAll('[data-entity]').forEach((g) => {
          const name = g.getAttribute('data-entity');
          const sid = schema.classes[name] ? schema.id : schema.scope[name];
          if (!sid) return;
          g.classList.add('linked');
          g.setAttribute('data-href', hrefClass(sid, name));
          g.setAttribute('tabindex', '0');
          g.setAttribute('role', 'link');
          g.setAttribute('aria-label', name);
        });
        box.replaceChildren(live);
        box.dataset.shown = src;
        box.classList.toggle('is-dark', src === box.dataset.dark);
        box.classList.toggle('is-inverted', isDark() && src !== box.dataset.dark); // no dark SVG: invert the light one
        const full = box.parentElement.querySelector('.dg-full');
        if (full) full.href = src;
      } catch (e) {
        box.innerHTML = '<p class="muted">Diagram not available.</p>';
      }
    }));
  }
  // One delegated handler for all diagram boxes.
  main.addEventListener('click', (e) => {
    const g = e.target.closest('.diagram [data-href]');
    if (g) location.hash = g.getAttribute('data-href');
  });
  main.addEventListener('keydown', (e) => {
    const g = e.target.closest('.diagram [data-href]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = g.getAttribute('data-href'); }
  });
  let currentSchema = null;
  const refreshDiagrams = () => { if (currentSchema) hydrateDiagrams(currentSchema); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshDiagrams);

  async function viewClass(sid, name, member) {
    const schema = await loadSchema(sid);
    currentSchema = schema;
    const k = schema.classes[name];
    if (!k) {
      const other = schema.scope[name];
      if (other) { location.replace(hrefClass(other, name, member)); return; }
      return notFound(`Class ${name} not found in ${label(sid)}.`);
    }
    document.title = `${k.name} — ${label(sid)} — BMM Portal`;
    let showInh = true;
    try { showInh = localStorage.getItem('bmm-inherited') !== '0'; } catch (e) { /* ignore */ }

    const ancestorChain = k.allAncestors.length
      ? k.allAncestors.map((a) => a.schema ? `<a href="${hrefClass(a.schema, a.name.replace(/<.*$/, ''))}">${esc(a.name)}</a>` : esc(a.name)).join(' <span class="muted">→</span> ')
      : '';
    const desc = k.descendants.map((d) => `<li>${classLink(d.schema, d.name)}${d.schema !== sid ? ` <span class="muted small">${esc(label(d.schema))}</span>` : ''}</li>`).join('');
    const chars = [
      ['Kind', esc(KIND_LABEL[k.kind])],
      ['Package', k.package ? `<a href="${hrefPkg(sid, k.package)}">${esc(k.package)}</a>` : ''],
      ['Generic parameters', k.generics.map((g) => `<code>${esc(g.name)}</code>${g.conformsTo ? ` : ${typeHtml(g.conformsTo, schema)}` : ''}`).join(', ')],
      ['Inherits from', ancestorChain],
      ['Specialised by', desc ? `<ul class="chips">${desc}</ul>` : ''],
    ].filter(([, v]) => v).map(([a, b]) => `<tr><th scope="row">${a}</th><td>${b}</td></tr>`).join('');

    const propRow = (p, i, inh) => `<tr id="m-${esc(p.name)}" class="${inh ? 'inherited' : ''}"${inh && !showInh ? ' hidden' : ''}>
      <td class="num">${i}</td><td><code class="mname">${esc(p.name)}</code>${p.runtime ? ' <span class="badge sm">runtime</span>' : ''}</td>
      <td>${typeHtml(p.type, schema)}</td><td class="mult">${esc(p.mult)}</td>
      <td>${p.default != null ? `<code>${esc(p.default)}</code>` : ''}</td>
      <td>${docHtml(p.doc, schema)}${inh ? `<div class="from">inherited from ${classLink(p.fromSchema, p.from)}</div>` : ''}</td></tr>`;
    let n = 0;
    const attrs = k.properties.length + k.inherited.length ? `
      <section><div class="sec-h"><h2>Attributes</h2>
        ${k.inherited.length ? `<label class="toggle"><input type="checkbox" id="showInherited"${showInh ? ' checked' : ''}> show ${k.inherited.length} inherited</label>` : ''}</div>
        <table class="grid"><thead><tr><th class="num">#</th><th>Name</th><th>Type</th><th>Multiplicity</th><th>Default</th><th>Documentation</th></tr></thead>
        <tbody>${k.properties.map((p) => propRow(p, ++n, false)).join('')}${k.inherited.map((p) => propRow(p, ++n, true)).join('')}</tbody></table></section>` : '';

    const cond = (label2, list) => list.length ? `<div class="cond"><b>${label2}</b>${list.map((x) => `<div><span class="muted">${esc(x.name)}:</span> <code>${esc(x.expr)}</code></div>`).join('')}</div>` : '';
    const funcs = k.functions.length ? `
      <section><h2>Functions</h2><table class="grid"><thead><tr><th class="num">#</th><th>Signature</th><th>Result</th><th>Documentation</th></tr></thead><tbody>
      ${k.functions.map((f, i) => `<tr id="m-${esc(f.name)}"><td class="num">${i + 1}</td>
        <td><code class="mname">${esc(f.name)}</code><span class="sig">(${f.params.map((p) => `${esc(p.name)}: ${typeHtml(p.type, schema)}${p.nullable ? '[0..1]' : ''}`).join(', ')})</span>
          ${f.abstract ? ' <span class="badge sm">abstract</span>' : ''}${f.aliases.length ? `<div class="muted small">alias ${esc(f.aliases.join(', '))}</div>` : ''}</td>
        <td>${typeHtml(f.result, schema)}</td><td>${docHtml(f.doc, schema)}${cond('Pre', f.pre)}${cond('Post', f.post)}</td></tr>`).join('')}
      </tbody></table></section>` : '';

    const consts = k.constants.length ? `
      <section><h2>Constants</h2><table class="grid"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Documentation</th></tr></thead><tbody>
      ${k.constants.map((x) => `<tr id="m-${esc(x.name)}"><td><code class="mname">${esc(x.name)}</code></td><td>${typeHtml(x.type, schema)}</td><td><code>${esc(x.value)}</code></td><td>${docHtml(x.doc, schema)}</td></tr>`).join('')}
      </tbody></table></section>` : '';

    const items = k.items.length ? `
      <section><h2>Enumeration literals</h2><table class="grid"><thead><tr><th class="num">#</th><th>Name</th><th>Value</th><th>Documentation</th></tr></thead><tbody>
      ${k.items.map((x, i) => `<tr id="m-${esc(x.name)}"><td class="num">${i + 1}</td><td><code class="mname">${esc(x.name)}</code></td><td><code>${esc(x.value)}</code></td><td>${docHtml(x.doc, schema)}</td></tr>`).join('')}
      </tbody></table></section>` : '';

    const invs = k.invariants.length ? `
      <section><h2>Invariants</h2><table class="grid"><thead><tr><th>Name</th><th>Expression</th></tr></thead><tbody>
      ${k.invariants.map((x) => `<tr><td>${esc(x.name)}</td><td><code>${esc(x.expr)}</code></td></tr>`).join('')}
      </tbody></table></section>` : '';

    const used = k.usedBy.length ? `
      <section><h2>Used by</h2><table class="grid"><thead><tr><th>Class</th><th>Member</th><th>Release</th></tr></thead><tbody>
      ${k.usedBy.slice().sort((a, b) => (a.schema === sid ? 0 : 1) - (b.schema === sid ? 0 : 1) || a.cls.localeCompare(b.cls)).map((u) =>
        `<tr><td>${classLink(u.schema, u.cls)}</td><td><a href="${hrefClass(u.schema, u.cls, u.member.replace(/\(\)$/, ''))}"><code>${esc(u.member)}</code></a></td><td class="muted">${esc(label(u.schema))}</td></tr>`).join('')}
      </tbody></table></section>` : '';

    main.innerHTML = `
      <header class="page-h">${crumbs(sid, k.package, null)}
        <div class="title-row"><h1><span class="ic ic-${k.kind[0]} big" aria-hidden="true">${KIND_ICON[k.kind[0]]}</span>${esc(displayName(k))}</h1>
          <div class="badges">${k.kind !== 'class' ? `<span class="badge">${esc(KIND_LABEL[k.kind])}</span>` : ''}${k.generics.length ? '<span class="badge">generic</span>' : ''}</div>
          ${releaseSwitcher(sid, k.name)}</div>
      </header>
      <div class="content">
        ${k.doc ? `<section class="doc">${docHtml(k.doc, schema)}</section>` : ''}
        <section><h2>Characteristics</h2><table class="kv">${chars}</table></section>
        ${k.diagram ? diagramSection(k.diagram, 'Class diagram') : ''}
        ${attrs}${funcs}${consts}${items}${invs}${used}
      </div>`;
    const diagramsDone = hydrateDiagrams(schema);
    revealInTree(sid, k.package, k.name);
    if (member) {
      const row = document.getElementById(`m-${member}`);
      if (row) {
        row.hidden = false;
        row.classList.add('hit');
        row.scrollIntoView({ block: 'center' });
        diagramsDone.then(() => row.scrollIntoView({ block: 'center' })); // layout shifts once the SVG arrives
      }
    }
  }

  function notFound(msg) {
    document.title = 'Not found — BMM Portal';
    main.innerHTML = `<div class="content"><h1>Not found</h1><p>${esc(msg)}</p><p><a href="#/">Back to home</a></p></div>`;
  }

  // ------------------------------------------------------------ router
  async function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (!parts.length) { viewHome(); revealInTree(null); }
      else {
        const [component, release, kind, ...rest] = parts;
        const cc = comp(component);
        if (!cc) return notFound(`Unknown component ${component}.`);
        if (!release || release === 'latest') {
          location.replace(`#/${cc.name}/${cc.latest}${kind ? '/' + [kind, ...rest].map(encodeURIComponent).join('/') : ''}`);
          return;
        }
        const sid = schemaIdFor(cc.name, release);
        if (!sid) return notFound(`Release ${release} of ${cc.name} not found.`);
        if (!kind) await viewSchema(sid);
        else if (kind === 'class') await viewClass(sid, rest[0], rest[1]);
        else if (kind === 'package') await viewPackage(sid, rest.join('/'));
        else notFound('Unknown page.');
      }
      if (!parts[4]) main.scrollTop = 0;
      main.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 800px)').matches) setNav(false);
    } catch (e) {
      main.innerHTML = `<div class="content"><h1>Error</h1><p>${esc(e.message)}</p></div>`;
    }
  }

  // ------------------------------------------------------------ search
  const input = $('#searchInput');
  const kindSel = $('#searchKind');
  const latestOnly = $('#searchLatest');
  const results = $('#searchResults');
  let active = -1;

  function runSearch() {
    const q = input.value.trim().toLowerCase();
    const kind = kindSel.value;
    if (q.length < 2) { closeResults(); return; }
    const scored = [];
    for (const e of INDEX.search) {
      const [name, k, sid] = e;
      if (kind && k !== kind) continue;
      if (latestOnly.checked && !isLatest(sid)) continue;
      const nl = name.toLowerCase();
      let s;
      if (nl === q) s = 0; else if (nl.startsWith(q)) s = 1; else if (nl.includes(q)) s = 2; else continue;
      s = s * 10 + ({ class: 0, enum: 0, package: 1, property: 2, function: 3 }[k] ?? 4);
      scored.push([s, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1][0].localeCompare(b[1][0]));
    const top = scored.slice(0, 60);
    results.innerHTML = top.length ? top.map(([, [name, k, sid, owner]], i) => {
      const href = k === 'package' ? hrefPkg(sid, owner) : k === 'class' || k === 'enum' ? hrefClass(sid, name) : hrefClass(sid, owner, name);
      const ctx = k === 'property' || k === 'function' ? `${owner}.${name}${k === 'function' ? '()' : ''}` : k === 'package' ? owner : name;
      return `<li role="option" id="sr-${i}"><a href="${href}" tabindex="-1"><span class="sk sk-${k}">${k}</span><span class="sn">${esc(ctx)}</span><span class="ss">${esc(label(sid))}</span></a></li>`;
    }).join('') + (scored.length > 60 ? `<li class="more">${scored.length - 60} more — refine the query</li>` : '')
      : '<li class="more">No matches</li>';
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }
  function closeResults() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function setActive(i) {
    const opts = results.querySelectorAll('[role=option]');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, j) => o.classList.toggle('active', j === active));
    input.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener('input', runSearch);
  kindSel.addEventListener('change', runSearch);
  latestOnly.addEventListener('change', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') {
      const a = results.querySelectorAll('[role=option] a')[Math.max(active, 0)];
      if (a) { location.hash = a.getAttribute('href'); closeResults(); input.blur(); }
    } else if (e.key === 'Escape') closeResults();
  });
  results.addEventListener('click', (e) => { if (e.target.closest('a')) closeResults(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) closeResults(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); input.select(); }
  });

  // ------------------------------------------------------------ chrome
  const navEl = $('#nav');
  const navBtn = $('#navToggle');
  function setNav(open) { document.body.classList.toggle('nav-closed', !open); navBtn.setAttribute('aria-expanded', String(open)); }
  navBtn.addEventListener('click', () => setNav(document.body.classList.contains('nav-closed')));
  if (window.matchMedia('(max-width: 800px)').matches) setNav(false);

  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('bmm-theme', root.dataset.theme); } catch (e) { /* ignore */ }
    refreshDiagrams();
  });
  void navEl;

  // ------------------------------------------------------------ start
  loadIndex().then(() => { buildTree(); window.addEventListener('hashchange', route); route(); })
    .catch((e) => { main.innerHTML = `<div class="content"><h1>Error</h1><p>${esc(e.message)}</p></div>`; });
})();
