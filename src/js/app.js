// app.js — Main application lifecycle, state & event orchestration
import { escapeHtml, $ } from "./core/util.js";
import { parsePlan } from "./core/parser.js";
import { isSchemaFile, pruneSchema, storeSchema, restoreSchema } from "./core/schema.js";
import { state, setModel, setSelected, onMode } from "./core/state.js";
import {
  canvas, edgesSvg, render, select, setEmpty, applySelection,
  drawEdges, ACTION_COLOR
} from "./ui/diagram.js";
import { renderText, planText } from "./ui/textview.js";
import { renderSidebar, setTypes } from "./ui/sidebar.js";
import { renderDetail, renderPlanInfo, copyText } from "./ui/detail.js";
import { closeCtx } from "./ui/contextmenu.js";
import { fitView, setIso, ISO } from "./ui/iso.js";
import "./ui/rule-popover.js";

function load(plan, name, rawText){
  var model = parsePlan(plan, name);
  model.raw = plan;
  model.rawText = rawText || JSON.stringify(plan, null, 2);
  model.rawBytes = (rawText || model.rawText).length;
  model.timestamp = plan.timestamp || null;
  setModel(model);
  setSelected(null);
  $("srcName").innerHTML = '<b>' + escapeHtml(name) + '</b> \u00b7 ' + model.resources.length + ' res';
  $("tfver").textContent = model.tfVersion ? ("terraform " + model.tfVersion) : "";
  model.resources.forEach(function(r){ r.enabledType = true; });
  render();
  requestAnimationFrame(fitView);      /* after the pane has its real size */
  renderDetail();
}

function loadText(text, name){
  var plan;
  try { plan = JSON.parse(text); }
  catch (e){
    var errModel = {resources:[], byAddr:{}, typeCounts:{}, diagnostics:[
      {level:"err", code:"parse", msg:"Could not parse this file as JSON — <b>" + escapeHtml(e.message) + "</b>"}
    ]};
    setModel(errModel);
    $("srcName").textContent = name;
    if (canvas) Array.prototype.slice.call(canvas.querySelectorAll(".grp,.node")).forEach(function(n){ n.remove(); });
    if (edgesSvg) edgesSvg.innerHTML = "";
    renderSidebar();
    return;
  }
  if (isSchemaFile(plan)){
    var model = state.model;
    if (!model){
      $("diag").innerHTML =
        '<div class="dg warn"><span class="ic">!</span><span>That is a provider ' +
        'schema. Load a plan first, then drop it again so it can be pruned to ' +
        'the types the plan uses.</span></div>';
      return;
    }
    var pr = pruneSchema(plan, Object.keys(model.typeCounts));
    if (!pr.meta.types){
      model.diag("warn", "schema-empty",
        "That schema covers no type in this plan. Diffs stay inferred.");
    } else {
      storeSchema(pr.schema, pr.meta);
      model.diag("ok", "schema",
        "Provider schema loaded for <b>" + pr.meta.types + "</b> of this plan\u2019s types. " +
        "Collection diffs are now schema-verified.");
    }
    render();
    if (state.selected) renderDetail();
    return;
  }
  load(plan, name, text);
}

$("srcName").addEventListener("click", function(){ if (state.model) renderPlanInfo(); });
$("loadBtn").addEventListener("click", function(){ $("fileInput").click(); });
$("fileInput").addEventListener("change", function(e){
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function(){ loadText(String(fr.result), file.name); };
  fr.readAsText(file);
});

["dragenter","dragover"].forEach(function(ev){
  document.addEventListener(ev, function(e){ e.preventDefault(); document.body.classList.add("dragging"); });
});
["dragleave","drop"].forEach(function(ev){
  document.addEventListener(ev, function(e){ e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) document.body.classList.remove("dragging"); });
});
document.addEventListener("drop", function(e){
  var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function(){ loadText(String(fr.result), file.name); };
  fr.readAsText(file);
});

$("canvasWrap").addEventListener("click", function(){
  if (state.suppressClick) return;
  if (state.selected){ setSelected(null); applySelection(); drawEdges(); renderDetail(); }
});

$("actLegend").innerHTML = ["create","update","replace","delete"].map(function(a){
  return '<span><i class="sw" style="border-radius:50%;background:' + ACTION_COLOR[a] + '"></i>' + a + '</span>';
}).join("");

$("optActions").addEventListener("change", function(e){
  if (canvas) canvas.classList.toggle("no-actions", !e.target.checked);
});

$("isoFit").addEventListener("click", function(e){ e.stopPropagation(); fitView(); });

function applyView(){
  var opts = state.opts;
  $("modeChg").setAttribute("aria-pressed", opts.mode === "changes" ? "true" : "false");
  $("renderFlat").classList.toggle("on", opts.render === "diagram" && !ISO.on);
  $("renderIso").classList.toggle("on", opts.render === "diagram" && ISO.on);
  $("renderText").classList.toggle("on", opts.render === "text");

  var isText = opts.render === "text";
  $("textView").hidden = !isText;
  $("canvasPane").hidden = isText;

  if (isText) {
    renderText();
    renderSidebar();
  } else {
    render();
    fitView();
  }
}
function applyMode(m){ state.opts.mode = m; applyView(); }
function setRender(r){ state.opts.render = r; applyView(); }
onMode(function(){ applyView(); });

$("modeChg").addEventListener("click", function(){
  applyMode(state.opts.mode === "changes" ? "all" : "changes");
});
$("renderText").addEventListener("click", function(){ setRender("text"); });

$("tvCopy").addEventListener("click", function(){
  var el = document.createElement("div");
  el.innerHTML = planText();
  copyText(el.textContent, $("tvCopy"));
});

$("typesAll").addEventListener("click", function(){
  if (state.model) setTypes(Object.keys(state.model.typeCounts), true);
});
$("typesNone").addEventListener("click", function(){
  if (state.model) setTypes(Object.keys(state.model.typeCounts), false);
});

$("optPulse").addEventListener("change", function(e){
  state.opts.pulse = e.target.checked;
  var model = state.model;
  if (canvas) canvas.classList.toggle("pulse", state.opts.pulse && state.opts.mode === "changes" && model && model.hasEdits);
});
$("optAssoc").addEventListener("change", function(e){ state.opts.showAssoc = e.target.checked; render(); });
$("optUnsup").addEventListener("change", function(e){ state.opts.showUnsup = e.target.checked; render(); });
$("optEdges").addEventListener("change", function(e){ state.opts.edges = e.target.value; drawEdges(); });


/* ---------- theme (standalone only; the page is themed by tokens) ---------- */
(function(){
  var btn = $("themeBtn");
  if (!btn) return;
  var modes = ["auto","light","dark"], cur = "auto";
  try { cur = localStorage.getItem("tfplanview-theme") || "auto"; } catch(e){}
  var ICONS = {
    auto:  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" ' +
           'fill="none" stroke="currentColor" stroke-width="1.6"/>' +
           '<path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" ' +
           'fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" ' +
           'stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15' +
           'M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"/></g></svg>',
    dark:  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" ' +
           'd="M13.3 9.8A5.8 5.8 0 0 1 6.2 2.7a5.8 5.8 0 1 0 7.1 7.1z"/></svg>'
  };

  function apply(){
    if (cur === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", cur);
    btn.innerHTML = ICONS[cur] || ICONS.auto;
    btn.title = "Theme: " + cur;
    try { localStorage.setItem("tfplanview-theme", cur); } catch(e){}
  }
  btn.addEventListener("click", function(){
    cur = modes[(modes.indexOf(cur) + 1) % modes.length];
    apply();
  });
  apply();
})();

$("renderFlat").addEventListener("click", function(){ setRender("diagram"); setIso(false); });
$("renderIso").addEventListener("click", function(){ setRender("diagram"); setIso(true); });
(function(){
  var want = "0";
  try { want = localStorage.getItem("tfplanview-iso") || "0"; } catch(e){}
  setIso(want === "1");
})();

/* The sample plan is a large JSON blob parked at the end of the file, so it
   does not sit in the middle of the source. That puts it after this script,
   so it is read on demand and the boot waits for the document to finish
   parsing. */
function sampleText(){
  var el = document.getElementById("embedded-plan");
  var t = el ? el.textContent.trim() : "";
  return t.length > 2 ? t : "";
}

$("sampleBtn").addEventListener("click", function(){
  var t = sampleText();
  if (!t) return;
  try { load(JSON.parse(t), "bundled sample", t); }
  catch(e){ loadText(t, "bundled sample"); }
});

function boot(){
  restoreSchema();
  var has = !!sampleText();
  setEmpty(true);
  $("sampleBtn").disabled = !has;
  $("diag").innerHTML = has
    ? '<div class="dg info"><span class="ic">i</span><span>No plan loaded. Drop a <b>terraform show -json</b> file anywhere on this page, or click <b>Sample plan</b>.</span></div>'
    : '<div class="dg info"><span class="ic">i</span><span>No plan loaded and no sample bundled. Drop a <b>terraform show -json</b> file anywhere on this page.</span></div>';
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { load, loadText, boot, applyView, applyMode, setRender };
