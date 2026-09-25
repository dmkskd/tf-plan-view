#!/usr/bin/env node
// make-kinds.js — build-time only. Produces the collection-kind table that is
// bundled inside index.html; the app never runs this.
//
// WHY IT EXISTS
//   To diff a collection correctly you must know whether it is a set (order
//   is meaningless, match entries by content), a list (order matters, match by
//   position) or a map (match by key). Only the provider schema knows this.
//   The full AWS schema is ~13MB, which is too large to bundle — but the diff
//   needs one letter per attribute, and that is ~109KB for the whole provider.
//
// HOW TO USE IT
//   terraform providers schema -json > schema.json
//   node tools/make-kinds.js schema.json --version 5.100.0 -o kinds.json
//
//   Then paste the result into the <script id="collection-kinds"> block in
//   index.html. Pass --version explicitly: the schema file does not record
//   which provider version produced it (that lives in .terraform.lock.hcl),
//   and the app uses the recorded version to warn when a plan targets a
//   different major version.

const fs = require("fs");

const args = process.argv.slice(2);
const oi = args.indexOf("-o");
const vi = args.indexOf("--version");
if (oi < 0) {
  console.error("usage: node tools/make-kinds.js <schema.json> [--version X.Y.Z] -o <out.json>");
  process.exit(2);
}
const src = args.find((a, i) => i !== oi && i !== oi + 1 && i !== vi && i !== vi + 1);
const out = args[oi + 1];
const version = vi >= 0 ? args[vi + 1] : null;

const schema = JSON.parse(fs.readFileSync(src, "utf8"));
const result = { meta: { format: schema.format_version || null, providers: {} }, kinds: {} };

for (const [addr, ps] of Object.entries(schema.provider_schemas || {})) {
  const short = addr.split("/").pop();
  let types = 0;
  for (const [ty, spec] of Object.entries(ps.resource_schemas || {})) {
    const block = spec.block || {};
    const m = {};
    for (const [name, a] of Object.entries(block.attributes || {})) {
      const t = a.type;
      if (Array.isArray(t) && ["set", "list", "map"].includes(t[0])) m[name] = t[0][0];
    }
    for (const [name, bt] of Object.entries(block.block_types || {})) {
      if (["set", "list", "map"].includes(bt.nesting_mode)) m[name] = bt.nesting_mode[0];
    }
    // record every type, even with no collections: absence must mean "this
    // provider version has no such resource", not "it has nothing to record"
    result.kinds[ty] = m;
    types++;
  }
  result.meta.providers[short] = { address: addr, version: version, types };
}

fs.writeFileSync(out, JSON.stringify(result));
const n = Object.keys(result.kinds).length;
console.log(`wrote ${out}: ${n} types, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
