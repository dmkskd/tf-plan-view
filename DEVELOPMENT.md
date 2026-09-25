# Development

Single file. No build step, no dependencies. `index.html` contains the markup,
the CSS, the application script, the bundled collection-kinds table, and the
sample plan.

## Verifying a change

```sh
node tools/test.js                                             # exits non-zero on a failed assertion
node tools/check-boot.js                                       # exits non-zero if it throws
node tools/check-pure.js   | diff tools/baseline/check-pure.txt -
node tools/check-parse.js  | diff tools/baseline/check-parse.txt -
node tools/check-layout.js | diff tools/baseline/check-layout.txt -
```

| Script | Covers |
| --- | --- |
| `test` | the parse, placement and rule-diff rules, as named assertions over hand-written plans |
| `check-boot` | runs the whole script against a shimmed DOM; reports thrown exceptions and missing element ids |
| `check-pure` | rebuilt Terraform block, CLI recipes, diffs, rule tables |
| `check-parse` | parser and validation messages, including malformed input |
| `check-layout` | position and size of every box, across three view configurations |

`tools/baseline/` holds each script's output recorded when correct. A diff is a
behaviour change. Re-record when intended:

```sh
node tools/check-layout.js > tools/baseline/check-layout.txt
```

`tools/test.js` takes an argument to run one suite: `node tools/test.js placement`.
It shares `tools/lib/app.js` with the check scripts, which is what cuts the
DOM-free functions out of `index.html`.

The other four call individual functions. An exception during setup leaves the
page rendering its markup with every control inert. Only `check-boot` catches
it.

The harnesses slice functions out of `index.html` by landmark strings. Renaming a
function or moving a section breaks them. They exit non-zero rather than emit
partial output.

## Extension points

Documented in the header comment at the top of the `<script>` block.

| Constant | Adds |
| --- | --- |
| `REG` | a resource type: icon, category, placement, tile or container |
| `CLI()` | AWS CLI recipes for a type |
| `DETAIL_SECTIONS` | a section in the detail pane |
| `SEC_DEFAULT` | whether a new section starts open |
| `SIZE_H` | isometric block height per instance size |

## Regenerating the schema table

Build-time only. The application never runs this.

```sh
terraform providers schema -json > schema.json
node tools/make-kinds.js schema.json --version 5.100.0 -o kinds.json
```

Paste the result into the `<script id="collection-kinds">` block in
`index.html`. Pass `--version` explicitly. The schema file does not record the
provider version. That value lives in `.terraform.lock.hcl`, and is used to warn
on a major-version mismatch.

The table records every resource type, storing `{}` for those without
collections. Absence means the provider version has no such type.

## Regenerating the sample plan

The bundled sample is a real plan with resources rewritten to cover every action.
Account identifiers are replaced with `example` values.
