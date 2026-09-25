// lib/app.js — loads the functions out of index.html so Node can call them.
//
// WHAT IT DOES
//   Reads index.html as text, cuts the inline <script> on landmark strings and
//   evals the DOM-free sections into the global scope. The shims below stand in
//   for the two DOM reads those sections perform (escapeHtml is defined next to
//   the render code, and the collection-kinds table is read from a <script> tag).
//
// USED BY
//   tools/test.js, and available to the check-*.js harnesses.
//
// LIMITS
//   Slicing on landmark strings means renaming a function or moving a section
//   breaks the load. It throws rather than returning a partial app.

const fs = require("fs");

function load(htmlPath) {
  const h = fs.readFileSync(htmlPath || __dirname + "/../../index.html", "utf8");
  const js = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
  const slice = (from, to) => {
    const a = js.indexOf(from), b = js.indexOf(to);
    if (a < 0 || b < 0 || b <= a) throw new Error("slice failed: " + from);
    return js.slice(a, b);
  };

  global.escapeHtml = s => String(s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  global.document = {
    getElementById: () => ({
      textContent: h.match(/id="collection-kinds">([\s\S]*?)<\/script>/)[1]
    })
  };

  eval.call(null, slice("var REG = {", "var ACTION_COLOR"));
  eval.call(null, slice("var ACTION_COLOR", "function actionOf"));
  eval.call(null, slice("function actionOf", "/* ============================================================\n     3. LAYOUT"));
  eval.call(null, slice("/* ============================================================\n     3. LAYOUT", "/* ============================================================\n     4. RENDER"));
  eval.call(null, slice("var SCHEMA = null;", "/* ------------------------------------------------------------------\n     Rule preview."));
  eval.call(null, slice("var PORT_NAME", "/* --- collapsible sections"));

  return {
    html: h,
    samplePlan: () => JSON.parse(h.match(/id="embedded-plan">([\s\S]*?)<\/script>/)[1]),
    fn: name => {
      const f = global[name] || eval(name);
      if (typeof f !== "function") throw new Error("not loaded: " + name);
      return f;
    }
  };
}

module.exports = { load };
