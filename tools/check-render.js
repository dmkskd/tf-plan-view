// check-render.js — does the page actually render when a plan is loaded?
//
// WHAT IT CHECKS
//   Loads index.html in a real DOM (jsdom), clicks through the toolbar and
//   asserts what reaches the document: tiles on the canvas, rows in the type
//   list, the detail pane on selection, and the text view. Any exception the
//   page throws — including one thrown inside an event handler, which leaves
//   the page half-rendered and the controls looking dead — fails the run.
//
//   check-boot.js runs the script against a stub DOM, so it catches a failure
//   during start-up only. Everything after the first click is this file.
//
// HOW TO USE IT
//   node tools/check-render.js          exits non-zero on an error
const fs = require("fs");
const { JSDOM } = require("jsdom");

const file = process.argv[2] || __dirname + "/../index.html";
const errs = [];
const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
  runScripts: "dangerously", pretendToBeVisual: true, url: "file:///app/index.html"
});
const { window } = dom;
const doc = window.document;
dom.virtualConsole.on("jsdomError", e => errs.push(e.stack || e.message));
window.addEventListener("error", e => errs.push(e.message));

const click = id => {
  const el = doc.getElementById(id);
  if (!el) return errs.push("no such element: " + id);
  try { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
  catch (e) { errs.push(`click ${id}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
};
const count = sel => doc.querySelectorAll(sel).length;

const checks = [];
const expect = (what, cond, saw) => checks.push({ what, ok: !!cond, saw });

setTimeout(() => {
  click("sampleBtn");
  expect("tiles drawn", count(".node") > 0, count(".node"));
  expect("containers drawn", count(".grp") > 0, count(".grp"));
  expect("type list filled", count(".flt") > 0, count(".flt"));
  expect("plan header filled", doc.getElementById("srcName").textContent !== "no plan loaded",
         doc.getElementById("srcName").textContent);

  const tile = doc.querySelector(".node");
  if (tile) tile.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  expect("detail pane filled", doc.getElementById("detail").innerHTML.length > 200,
         doc.getElementById("detail").innerHTML.length);

  click("modeChg");
  expect("changes mode keeps the tiles", count(".node") > 0, count(".node"));
  click("modeChg");

  click("renderIso");
  expect("isometric keeps the tiles", count(".node") > 0, count(".node"));
  click("renderText");
  expect("text view writes the plan", doc.getElementById("textPlan").textContent.length > 200,
         doc.getElementById("textPlan").textContent.length);
  click("renderFlat");

  const failed = checks.filter(c => !c.ok);
  for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.what}  (${c.saw})`);
  if (errs.length) {
    console.error("\nthe page threw:\n" + errs.map(e => "  " + String(e).split("\n").slice(0, 4).join("\n  ")).join("\n---\n"));
  }
  console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed, ${errs.length} errors`);
  process.exit(failed.length || errs.length ? 1 : 0);
}, 250);
