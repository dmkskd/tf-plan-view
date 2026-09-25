// Regression harness for the layout engine: builds the containment tree
// headlessly and prints its shape and geometry.
const fs = require("fs");
const h = fs.readFileSync(process.argv[2] || __dirname + "/../index.html", "utf8");
const js = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const slice = (a, b) => js.slice(js.indexOf(a), js.indexOf(b));
global.escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

eval(slice("var REG = {", "var ACTION_COLOR"));
eval(slice("function actionOf", "/* ============================================================\n     3. LAYOUT"));
eval(slice("/* ============================================================\n     3. LAYOUT", "/* ============================================================\n     4. RENDER"));

const plans = {
  sample: JSON.parse(h.match(/id="embedded-plan">([\s\S]*?)<\/script>/)[1]),
};
const modes = [
  {mode:"all", showAssoc:false, showUnsup:true, edges:"select"},
  {mode:"all", showAssoc:true,  showUnsup:true, edges:"select"},
  {mode:"changes", showAssoc:false, showUnsup:true, edges:"select"}
];

const out = [];
for (const [name, plan] of Object.entries(plans)) {
  for (const opts of modes) {
    const model = parsePlan(plan, name);
    model.resources.forEach(r => { r.enabledType = true; });  // what load() does
    TH = (typeof tileHeight === "function")
      ? tileHeight(opts.mode)
      : (opts.mode === "changes" ? 88 : 66);   // pre-refactor builds
    const tree = buildTree(model, opts);
    out.push(`### ${name} mode=${opts.mode} assoc=${opts.showAssoc} -> ${tree.w}x${tree.h}`);
    (function walk(g, d) {
      const pad = "  ".repeat(d + 1);
      const id = g.box ? `[${g.cls}] ${g.label} ${g.meta}` : `. ${g.res.addr}`;
      out.push(`${pad}${id}  @${g.x},${g.y} ${g.w}x${g.h}`);
      if (g.box) g.children.forEach(k => walk(k, d + 1));
    })(tree, 0);
    out.push("  anc=" + JSON.stringify(model.anc));
  }
}
console.log(out.join("\n"));
