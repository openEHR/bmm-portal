# openEHR BMM Portal

A static portal for the openEHR models (RM, AM, BASE, LANG, TERM), generated from the
[BMM schemas](https://github.com/openEHR/specifications-ITS-BMM). Requirements: [SPEC.md](SPEC.md).

## Run

```bash
npm run build     # BMM JSON -> ./site (Node >= 18, no dependencies)
npm run serve     # http://127.0.0.1:47913/
```

`site/` is plain static files and can be hosted anywhere. Inputs are set with `BMM_DIR`, `SPECS_DIR`
(spec repos whose `manifest.json` decides *latest*), `DIAGRAM_DIR` (bmm-publisher SVGs) and `OUT_DIR`.

## Deploy

`.github/workflows/pages.yml` builds from the public openEHR repos on every push to `main`, nightly
and on demand, and deploys to GitHub Pages (Settings > Pages > Source: **GitHub Actions**).

## URLs and versions

- `#/RM/development/class/OBSERVATION`, `#/RM/latest/...`, `#/RM/1.0.4/...`
- `#/RM/development/class/ELEMENT/null_flavour` highlights a member
- `#/RM/development/package/org.openehr.rm.common.archetyped`

*development* is the newest BMM schema (the default), *latest* the newest one released in the
spec's `manifest.json`. The bottom-left switcher changes the version of the open specification.

## Known limitations

- Diagrams are bmm-publisher's PlantUML SVGs, made clickable. Dark mode inverts them unless a
  `<name>.dark.svg` exists. BASE 1.0.4, LANG 1.1.0-bmm3 and RM 1.0.2/1.0.3 have none.
- Schemas without `includes` resolve BASE types against the latest BASE, for links only.
- Generic parameters of inherited attributes are not substituted.
- Some types are referenced but undefined in the source BMM (the build prints them).
- No links to the specification HTML pages yet.

## License

Apache License 2.0, see [LICENSE](LICENSE).
