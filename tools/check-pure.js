// Regression harness for the pure builders: extracts the DOM-free functions from
// index.html and prints their output. Diff two runs to prove a refactor
// changed nothing:  node tools/check-pure.js > after.txt && diff before.txt after.txt
// Extracts the pure functions from index.html and runs them over both plans.
const fs = require("fs");
const h = fs.readFileSync(process.argv[2] || __dirname + "/../index.html", "utf8");
const js = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

function slice(from, to) {
  const a = js.indexOf(from), b = js.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error("slice failed: " + from);
  return js.slice(a, b);
}
global.escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

eval(slice("function hclLit", "/* ---- AWS CLI"));
eval(slice("function q(s)", "var ACTION_COLOR"));
eval(slice("var ACTION_COLOR", "function actionOf"));
eval(slice("function actionOf", "function parsePlan"));
eval(slice("function portText", "/* --- collapsible sections"));
eval(slice("function changedKeys", "function titleFor"));
eval(slice("var REG = {", "var ACTION_COLOR"));

const out = [];
{
  const f = "sample";
  const plan = JSON.parse(h.match(/id="embedded-plan">([\s\S]*?)<\/script>/)[1]);
  const cfg = {};
  for (const c of (plan.configuration?.root_module?.resources || [])) cfg[c.address] = c;

  for (const rc of plan.resource_changes) {
    const r = {
      addr: rc.address, type: rc.type, name: rc.name,
      action: actionOf(rc.change.actions),
      attrs: rc.change.after || {}, before: rc.change.before || null,
      unknown: rc.change.after_unknown || {}, sensitive: rc.change.after_sensitive || {},
      replacePaths: rc.change.replace_paths || [], actionReason: rc.action_reason || null,
      spec: REG[rc.type] || null, kind: (REG[rc.type] || {}).kind || "node"
    };
    out.push("### " + f + " " + rc.address);
    out.push("ACTION " + r.action);
    out.push("HCL " + (hclFor(r, cfg[rc.address]) || "(none)"));
    out.push("CLI " + JSON.stringify(CLI(r, { region: "us-east-1" })));
    out.push("CHANGED " + JSON.stringify(changedKeys(r)));
    const ch = changeHtml(r);
    out.push("DIFF " + (ch ? ch.count + "|" + ch.body : "(none)"));
    const rl = rulesHtml(r);
    out.push("RULES " + (rl ? rl.title + "|" + rl.body : "(none)"));
  }
}
console.log(out.join("\n"));
