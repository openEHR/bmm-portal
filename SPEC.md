# BMM Portal — Specification

A static web portal for browsing the openEHR models. Its **only source is the openEHR BMM
schemas**, so the portal always matches the published models and needs no separate modelling tool.

Status: draft, 2026-11-13. A first implementation is in this repository (see README.md). It covers
§3.1–3.6 except the specification links in §3.2. It shows development, latest and all older versions (OQ2), uses a separate Node
generator (OQ1), and leaves out components that have no BMM schema for now (OQ4).

## 1. Goal

Generate a static portal from the P_BMM JSON schemas that:

1. offers a package tree, class pages, package pages, diagrams and search,
2. uses BMM as its single source of truth, so the portal is rebuilt whenever the BMM files change,
3. shows everything BMM knows about a class: inheritance, generics, invariants, constants,
   effective (flattened) properties, and where the class is used,
4. loads fast and gives every page a stable, shareable URL.

## 2. Input

- **Source:** `openEHR/specifications-ITS-BMM`, `components/<COMP>/json/*.bmm.json`
  (local copy in `../specifications-ITS-BMM`).
- **Components available today:** AM (1.4.0, 2.2.0–2.4.0), BASE (1.0.4–1.3.0), LANG
  (1.0.0, 1.1.0, 1.1.0-bmm3), RM (1.0.2–1.2.0), TERM (3.0.0, 3.1.0).
- **Schema keys used:** `schema_name`, `rm_publisher`, `rm_release`, `schema_revision`,
  `schema_lifecycle_state`, `schema_description`, `includes`, `packages` (nested, with class
  name lists), and `class_definitions` (properties as `P_BMM_SINGLE_PROPERTY`, `P_BMM_CONTAINER_PROPERTY`,
  `P_BMM_GENERIC_PROPERTY` and so on, plus `documentation`, `is_mandatory`, `cardinality`,
  `ancestors`, `generic_parameter_defs`, `functions` and `invariants` where present).
- `includes` must be resolved, so that a type from BASE that RM uses links to the BASE page.
- **Diagrams (optional):** the SVG output of `bmm-publisher`
  (`output/Adoc/<schema>/images/uml/{classes,diagrams}/`).

## 3. Functional requirements

### 3.1 Navigation tree
- The root nodes are the components (AM, BASE, LANG, RM, TERM). Under each is the release, then
  the BMM package hierarchy (`org.openehr.rm.common` → `archetyped` → classes).
- The tree shows only the components with their packages, and no versions. A version switcher in
  the bottom-left corner changes the version of the specification currently open: **development**
  (default), **latest** (newest published release, taken from the spec repo's `manifest.json`) and
  the older versions. Switching keeps the current class or package open if the other version has it.
- The tree can be collapsed, can be used with the keyboard, and highlights the current page.

### 3.2 Class page
- **Header:** the class name with generic parameters (e.g. `DV_INTERVAL<T>`), a breadcrumb of the
  component, release and packages, and badges for abstract, generic and enumeration.
- **Characteristics:** documentation (rendered from the Markdown/AsciiDoc-ish inline syntax),
  ancestors (as links), descendants (computed), and a link to the class in the specification HTML.
- **Attributes:** # | Name | Type (linked, generics resolved) | Multiplicity (from `is_mandatory`
  and `cardinality`) | Default | Documentation. A toggle shows or hides inherited attributes, and
  each inherited row names the ancestor it comes from.
- **Functions**, **Constants** and **Invariants**, when the BMM schema has them.
- **Enumeration literals:** the name, the value and the documentation.
- **Used by:** the classes and properties whose type refers to this class (computed).

### 3.3 Package page
- The sub-packages, the package diagram, and the list of classes with a one-line summary.

### 3.4 Diagrams
- Class and package diagrams are generated from BMM. They are not drawn by hand.
- They come from the PlantUML/SVG output of `bmm-publisher`.
- Class boxes in a diagram are clickable and open the class page.
- In dark mode, a dark variant (`<name>.dark.svg`) is used if one exists. Otherwise the light diagram
  is colour-inverted.

### 3.5 Search
- Instant search by class, property, function and package name, with an optional type filter and
  a "latest releases only" switch. Searching documentation text is a nice-to-have.
- The search index is generated at build time and stays small. The full content is not loaded up front.

### 3.6 URLs
- Every page has a stable, shareable URL, for example
  `#/RM/development/class/ARCHETYPED` and `#/RM/latest/package/org.openehr.rm.common.archetyped`.
- `development` and `latest` stay in the URL, so a link always shows the current version of that
  kind. Older versions use their number, e.g. `#/RM/1.0.4/...`. `#/RM` opens development.
- `#/RM/development/class/ELEMENT/null_flavour` opens the class and highlights that member.

## 4. Non-functional requirements

- The output is a static site with no server. It is hosted under `specifications.openehr.org/releases/…`.
- The data is split into one JSON file per schema, loaded lazily. The first page appears without
  downloading the entire model.
- The build runs as one command in CI, triggered by a change in `specifications-ITS-BMM`.
- The layout has a header bar with search, a package tree on the left and a content pane on the
  right. The colours are openEHR's, and the site supports light and dark mode.
  It must work at tablet and phone width.
- Accessibility: the site can be used with the keyboard alone, the tree uses ARIA roles, and there
  is enough contrast.

## 5. Out of scope

- Components that have **no BMM schema** in `specifications-ITS-BMM` (e.g. CDS, PROC, SM) are not
  shown. They can be added once BMM schemas exist for them.

## 6. Open questions

1. Generator stack: extend `bmm-publisher` (PHP, which already parses BMM and renders the SVGs) or
   keep the separate small Node generator in this repository?
2. Should all older versions stay in the switcher, or only development and latest?
3. Should the specification links (the "Specification" link on each class) come from
   `bmm-publisher`'s per-type JSON, or from a mapping maintained separately?
4. Should the components without BMM (CDS, PROC, SM) get BMM schemas?
5. Should bmm-publisher write dark-mode SVGs, or Mermaid diagrams, instead of the inverted fallback?
