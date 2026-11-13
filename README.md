# openEHR BMM Portal

A static portal for browsing the openEHR models (RM, AM, BASE, LANG, TERM), generated directly
from the published [BMM schemas](https://github.com/openEHR/specifications-ITS-BMM). The
requirements are in [SPEC.md](SPEC.md).

## Run

```bash
npm run build     # BMM JSON -> ./site
npm run serve     # http://127.0.0.1:47913/
```

You need Node ≥ 18. There are no dependencies.

| Env var       | Default                                   | Purpose                                   |
|---------------|-------------------------------------------|-------------------------------------------|
| `BMM_DIR`     | `../specifications-ITS-BMM/components`    | P_BMM JSON (`<COMP>/json/*.bmm.json`)     |
| `SPECS_DIR`   | `..`                                      | Folder with `specifications-<COMP>` checkouts; their `manifest.json` decides which version is *latest* |
| `DIAGRAM_DIR` | `../bmm-publisher/output/Adoc`            | Pre-rendered SVGs (optional)              |
| `OUT_DIR`     | `./site`                                  | Output                                    |

## Layout

```
build/build.mjs   generator: reads BMM, resolves includes, computes inheritance / used-by, writes JSON
build/serve.mjs   local preview server
src/              static app (index.html, app.js, style.css), copied into site/
site/             generated output (git-ignored)
  data/index.json             nav tree + search index (~600 KB)
  data/schemas/<id>.json      one file per schema, loaded on demand
  diagrams/<id>/...           SVGs copied from bmm-publisher
```

## URLs

- `#/RM/development`: the overview of a specification (`#/RM` opens development)
- `#/RM/latest/class/OBSERVATION`: a class in the latest published version
- `#/RM/1.0.4/class/OBSERVATION`: a class in an older version
- `#/RM/development/class/ELEMENT/null_flavour`: jumps to a member and highlights it
- `#/RM/development/package/org.openehr.rm.common.archetyped`: a package

## Versions

Each specification has three kinds of version, switched in the bottom-left corner. The default is
always **development**.

- **development:** the newest BMM schema.
- **latest:** the newest BMM schema whose version is a published release, meaning it has a date in
  `specifications-<COMP>/manifest.json`.
- **older versions:** every other BMM schema.

The build log prints the result, e.g. `RM: development 1.2.0, latest 1.1.0, older 1.0.4 1.0.3 1.0.2`.
The tree shows the packages of the selected version only.

## Known limitations

- **Diagrams** are the PlantUML SVGs from `bmm-publisher`'s output, matched to classes and packages by
  file name. The SVG is inlined so each class box links to its page.
  - **Dark mode:** a dark variant `<name>.dark.svg` next to a diagram is used when it exists.
    Otherwise the light diagram is colour-inverted.
  - **Missing:** BASE 1.0.4, LANG 1.1.0-bmm3 and RM 1.0.2/1.0.3 have no diagrams.
- **Older schemas without `includes`** (RM 1.0.2/1.0.3, LANG 1.0.0, TERM) resolve BASE types such as
  `String` and `Any` against the latest BASE release, for linking only. This fallback is left out of
  "Specialised by" and "Used by".
- **Inherited attributes** are shown as they are declared, so generic parameters are not substituted.
- **Gaps in the source data**, reported by the build or visible as unlinked types:
  - `P_ARCHETYPE_SLOT.includes/excludes` (AM 2.x) is a `List` with no element type.
  - `STATEMENT`, `ASSERTION` and `STATEMENT_SET` (AM 2.2/2.3), `EL_BOOLEAN_EXPRESSION` (AM 2.4),
    `C_OBJECT` (LANG) and `Byte` (RM 1.0.x) are referenced but not defined.
- There are **no links to the specification HTML pages** yet (SPEC open question 3).

## License

Apache License 2.0, see [LICENSE](LICENSE).
