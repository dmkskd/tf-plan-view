// check-parse.js — regression check for the plan parser and its validation.
//
// WHAT IT CHECKS
//   For several inputs: the resolved region and versions, the resource list
//   with each one's action, support status, references and dependents, the
//   plan summary counts, and every validation message produced.
//
//   Inputs are the bundled sample plus deliberately awkward ones: a state file
//   passed instead of a plan, a JSON object that is not a plan at all, and a
//   plan using a non-AWS provider with a nested module. Those cover the paths
//   where the parser is supposed to warn rather than guess.
//
// HOW TO USE IT
//   node tools/check-parse.js | diff tools/baseline/check-parse.txt -
//   node tools/check-parse.js > tools/baseline/check-parse.txt   (to re-record)

const fs = require("fs");
// a harness that throws must not be mistaken for valid output
process.on("uncaughtException", e => { console.error(e); process.exit(1); });
const h = fs.readFileSync(process.argv[2] || __dirname + "/../index.html", "utf8");
const js = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const slice = (a, b) => js.slice(js.indexOf(a), js.indexOf(b));
global.escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
eval(slice("var REG = {", "var ACTION_COLOR"));
eval(slice("function actionOf", "/* ============================================================\n     3. LAYOUT"));

const plans = {
  sample: JSON.parse(h.match(/id="embedded-plan">([\s\S]*?)<\/script>/)[1]),
  statefile: {format_version:"1.0", values:{root_module:{resources:[]}}},
  garbage: {hello:"world"},
  foreignprov: {format_version:"1.2", resource_changes:[
      {address:"google_compute_instance.x", type:"google_compute_instance", name:"x", mode:"managed",
       change:{actions:["create"], after:{}, after_unknown:{}}},
      {address:"aws_quantum_thing.y", type:"aws_quantum_thing", name:"y", mode:"managed",
       change:{actions:["create"], after:{}, after_unknown:{}}}],
    configuration:{provider_config:{google:{name:"google"}}, root_module:{module_calls:{vpc:{}}}}}
};

const out = [];
for (const [name, plan] of Object.entries(plans)) {
  const m = parsePlan(plan, name);
  out.push("### " + name);
  out.push("  region=" + m.region + " tf=" + m.tfVersion + " fmt=" + m.formatVersion);
  out.push("  resources=" + m.resources.length + " types=" + Object.keys(m.typeCounts).length);
  out.push("  summary=" + JSON.stringify(m.summary || null));
  out.push("  outputs=" + (m.outputs ? Object.keys(m.outputs).length : 0) + " drift=" + JSON.stringify(m.drift || null));
  for (const d of m.diagnostics) out.push("  [" + d.level + "/" + d.code + "] " + d.msg);
  for (const r of m.resources)
    out.push("  " + r.addr + " act=" + r.action + " sup=" + r.supported +
             " kind=" + r.kind + " refs=[" + r.refs.join(",") + "] deps=[" + (r.dependents||[]).join(",") + "]");
}
console.log(out.join("\n"));
