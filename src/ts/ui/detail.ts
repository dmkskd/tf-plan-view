// ui/detail.js — Detail pane, collapsible inspector sections & context menu
import { escapeHtml, $ } from "../core/util.js";
import { CLI, rulesHtml, blockHeight } from "../providers/registry.js";
import { hclFor, hclHighlight } from "../core/hcl.js";
import { baseAddr } from "../core/parser.js";
import { changeHtml, reasonText, valText, sameVal } from "../core/diff.js";
import { changedKeys, select, applySelection, drawEdges, ACTION_COLOR, icoSvg } from "./diagram.js";
import { kindSource } from "../core/schema.js";
import { state, setSelected, onSelect } from "../core/state.js";
import type { PlanModel, PlanResource, CliCommand } from "../types/index.js";

var detailEl = $("detail"), splitEl = $("split");

var SEC_DEFAULT: Record<string, boolean> = {drift:true, checks:true, sections:false, diff:true, deps:true, refby:true, rules:true, hcl:false, cli:false, attrs:false};
var secOpen: Record<string, boolean> = {};
try {
  var saved = localStorage.getItem("tfplanview-sections");
  if (saved) secOpen = JSON.parse(saved) || {};
} catch(e){ secOpen = {}; }

function isOpen(key: string): boolean {
  return (secOpen[key] === undefined) ? !!SEC_DEFAULT[key] : !!secOpen[key];
}

var CHEV = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true">' +
           '<path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" ' +
           'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function sec(key: string, title: string, count: number | string | null | undefined, body: string): string {
  return '<details data-sec="' + key + '"' + (isOpen(key) ? " open" : "") + '>' +
           '<summary class="dsec">' + escapeHtml(title) +
             (count !== null && count !== undefined ? ' <span class="cnt">' + escapeHtml(String(count)) + '</span>' : '') +
             CHEV +
           '</summary>' + body +
         '</details>';
}

var detailSections: any[] = [], saveSections = function(): void {};

function wireSections(): void {
  if (!detailEl) detailEl = $("detail");
  if (!detailEl) return;
  var allSecs = Array.prototype.slice.call(detailEl.querySelectorAll<HTMLDetailsElement>("details[data-sec]"));
  var btn = $("secAll");
  function save(): void {
    try { localStorage.setItem("tfplanview-sections", JSON.stringify(secOpen)); } catch(e){}
  }
  function syncAll(): void {
    if (!btn) return;
    var anyClosed = allSecs.some(function(d: HTMLDetailsElement){ return !d.open; });
    btn.dataset.want = anyClosed ? "open" : "close";
    btn.classList.toggle("open", !anyClosed);
    var lbl = btn.querySelector(".lbl");
    if (lbl) lbl.textContent = anyClosed ? "expand all" : "collapse all";
  }
  allSecs.forEach(function(d: HTMLDetailsElement){
    d.addEventListener("toggle", function(){
      if (d.dataset.sec) secOpen[d.dataset.sec] = d.open;
      save();
      syncAll();
    });
  });
  syncAll();
  if (btn) btn.addEventListener("click", function(){
    if (!btn) return;
    var open = btn.dataset.want === "open";
    allSecs.forEach(function(d: HTMLDetailsElement){
      d.open = open;
      if (d.dataset.sec) secOpen[d.dataset.sec] = open;
    });
    save(); syncAll();
  });
  Array.prototype.slice.call(detailEl.querySelectorAll<HTMLElement>("[data-goto]")).forEach(function(a: HTMLElement){
    a.addEventListener("click", function(){ if (a.dataset.goto) select(a.dataset.goto); });
  });
}

/* Every top-level section of the plan, what this app does with it, and its
   contents. Sections the app reads are open; the rest are listed so nothing
   in the file is silently ignored. */
var SECTION_USE: Record<string, [string, string]> = {
  format_version:      ["read", "checked: only format 1.x is understood"],
  terraform_version:   ["read", "shown in the top bar"],
  timestamp:           ["read", "shown in this panel"],
  applyable:           ["read", "warns when the plan cannot be applied"],
  errored:             ["read", "warns when the plan errored"],
  complete:            ["ignored", "not used"],
  variables:           ["read", "resolves the region"],
  resource_changes:    ["read", "the diagram, the diffs and the text view"],
  configuration:       ["read", "containment, dependencies and the rebuilt HCL"],
  output_changes:      ["read", "listed below"],
  resource_drift:      ["read", "listed below"],
  checks:              ["read", "listed below"],
  planned_values:      ["partial", "only used when resource_changes is missing"],
  prior_state:         ["ignored", "not used"],
  relevant_attributes: ["ignored", "not used"]
};

function sectionRows(raw: any): string {
  var keys = Object.keys(raw || {});
  if (!keys.length) return '<div class="cli-note">nothing to list</div>';

  var rows = keys.map(function(k: string){
    var use = SECTION_USE[k] || ["unknown", "not recognised by this build"];
    var size = JSON.stringify(raw[k]).length;
    return {k:k, use:use, size:size};
  }).sort(function(a: any, b: any){ return b.size - a.size; });

  return '<div class="sections">' + rows.map(function(r: any){
    var body = JSON.stringify(raw[r.k], null, 1);
    if (body.length > 40000) body = body.slice(0, 40000) + "\n\u2026 truncated";
    return '<details class="sec-row">' +
             '<summary>' +
               '<span class="nm">' + escapeHtml(r.k) + '</span>' +
               '<span class="use ' + r.use[0] + '" title="' + escapeHtml(r.use[1]) + '">' +
                 r.use[0] + '</span>' +
               '<span class="sz">' + (r.size / 1024).toFixed(1) + ' KB</span>' +
             '</summary>' +
             '<pre class="rawjson">' + escapeHtml(body) + '</pre>' +
           '</details>';
  }).join("") + '</div>';
}

function driftRows(raw: any): string {
  var d = (raw && raw.resource_drift) || [];
  if (!d.length) return "";
  return '<div class="attrs">' + d.map(function(x: any){
    var before = (x.change && x.change.before) || {};
    var after  = (x.change && x.change.after) || {};
    var keys = Object.keys(before).concat(Object.keys(after)).filter(function(k: string, i: number, a: string[]){
      return a.indexOf(k) === i && !sameVal(before[k], after[k]);
    });
    return '<div class="attr"><span class="k">' + escapeHtml(x.address) + '</span>' +
           '<span class="v">' + (keys.length
             ? escapeHtml(keys.join(", ")) + ' changed outside terraform'
             : '<span class="unknown">changed outside terraform</span>') + '</span></div>';
  }).join("") + '</div>';
}

function checkRows(raw: any): string {
  var c = (raw && raw.checks) || [];
  if (!c.length) return "";
  return '<div class="attrs">' + c.map(function(x: any){
    var addr = (x.address && (x.address.to_display || x.address.kind)) || "check";
    var status = x.status || "unknown";
    var colour = status === "pass" ? "var(--create)"
               : status === "fail" ? "var(--destroy)"
               : status === "error" ? "var(--destroy)" : "var(--muted)";
    var msgs = (x.instances || []).reduce(function(acc: any[], i: any){
      return acc.concat(i.problems || []);
    }, []).map(function(pr: any){ return pr.message; });
    return '<div class="attr"><span class="k">' + escapeHtml(addr) + '</span>' +
           '<span class="v" style="color:' + colour + '">' + escapeHtml(status) +
           (msgs.length ? ' \u2014 ' + escapeHtml(msgs.join("; ")) : '') + '</span></div>';
  }).join("") + '</div>';
}

function renderPlanInfo(): void {
  const model = state.model;
  if (!model) return;
  setSelected(null);
  applySelection();
  drawEdges();
  if (!splitEl) splitEl = $("split");
  if (splitEl) splitEl.classList.add("has-detail");

  var S: any = model.summary || {};
  var rawBytes = model.rawBytes || 0;
  var rows: [string, string | number][] = [
    ["file", model.source || ""],
    ["size", (rawBytes/1024).toFixed(1) + " KB"],
    ["format_version", model.formatVersion || "\u2014"],
    ["terraform_version", model.tfVersion || "\u2014"],
    ["timestamp", model.timestamp || "\u2014"],
    ["region", model.region || "\u2014"],
    ["resources", model.resources.length],
    ["outputs", model.outputs ? Object.keys(model.outputs).length : 0]
  ];

  var html = '<div class="dhd">' +
    '<div class="dhd-top file-top"><div class="dhd-name">' +
      '<span class="type">loaded file</span>' +
      '<h3>' + escapeHtml(model.source || "") + '</h3></div>' +
      '</div>' +
    '<div class="dhd-foot"><div class="badges">';
  ["create","update","replace","delete"].forEach(function(a: string){
    if (S[a]) html += '<span class="badge" style="color:' + (ACTION_COLOR as any)[a] +
      '; background:color-mix(in srgb, ' + (ACTION_COLOR as any)[a] + ' 14%, transparent)">' +
      S[a] + " " + escapeHtml(a) + '</span>';
  });
  html += '</div></div></div>' + SEC_MASTER;

  var meta = '<div class="attrs">';
  rows.forEach(function(kv: [string, string | number]){
    meta += '<div class="attr"><span class="k">' + escapeHtml(kv[0]) + '</span>' +
            '<span class="v">' + escapeHtml(String(kv[1])) + '</span></div>';
  });
  html += sec("planmeta", "Plan metadata", null, meta + '</div>');

  const outputs = model.outputs;
  if (outputs){
    var ob = '<div class="attrs">';
    Object.keys(outputs).sort().forEach(function(k: string){
      var o = outputs[k];
      var unk = o.after_unknown === true;
      var v = unk ? "known after apply" : (o.after !== undefined ? JSON.stringify(o.after) : "\u2014");
      ob += '<div class="attr"><span class="k">' + escapeHtml(k) + '</span>' +
            '<span class="v' + (unk ? " unknown" : "") + '">' + escapeHtml(v) + '</span></div>';
    });
    html += sec("outputs", "Outputs", Object.keys(outputs).length, ob + '</div>');
  }

  var addrs = '<div class="reflist">';
  model.resources.forEach(function(r: PlanResource){
    addrs += '<a data-goto="' + escapeHtml(r.addr) + '">' + escapeHtml(r.addr) +
             ' <span style="color:' + ((ACTION_COLOR as any)[r.action] || "var(--noop)") + '">' +
             escapeHtml(r.action) + '</span></a>';
  });
  html += sec("addrs", "Resources", model.resources.length, addrs + '</div>');

  var drift = driftRows(model.raw);
  if (drift){
    html += sec("drift", "Drift", (model.raw.resource_drift || []).length, drift);
  }
  var checks = checkRows(model.raw);
  if (checks){
    html += sec("checks", "Checks", (model.raw.checks || []).length, checks);
  }

  html += sec("sections", "Plan sections",
              Object.keys(model.raw || {}).length, sectionRows(model.raw));

  var raw = model.raw ? JSON.stringify(model.raw, null, 2) : (model.rawText || "");
  var shown = raw.length > 200000 ? raw.slice(0, 200000) + "\n\u2026 truncated" : raw;
  html += sec("raw", "Raw JSON", (rawBytes/1024).toFixed(1) + " KB",
              '<pre class="rawjson">' + escapeHtml(shown) + '</pre>');

  if (!detailEl) detailEl = $("detail");
  if (detailEl) detailEl.innerHTML = html;
  wireSections();
}

/* --- detail pane --- */
/* ------------------------------------------------------------------
   Detail pane.

   Sections are data: add an entry to DETAIL_SECTIONS and it appears,
   collapses, remembers its state and joins "expand all" with no other
   change. Each builder returns null to omit its section, or
   {title, count, body}. Give every new key a default in SEC_DEFAULT.
   ------------------------------------------------------------------ */

interface DetailSectionBuilderResult {
  title: string;
  count: number | string | null | undefined;
  body: string;
}

interface DetailSectionDef {
  key: string;
  build: (r: PlanResource, ctx: any) => DetailSectionBuilderResult | null | undefined;
}

var DETAIL_SECTIONS: DetailSectionDef[] = [
  {key:"diff", build: function(r: PlanResource){
    var ch = changeHtml(r);
    return ch && {title:"What changes", count:ch.count, body:ch.body};
  }},

  {key:"deps", build: function(r: PlanResource){
    if (!r.refs.length) return null;
    return {title:"Depends on", count:r.refs.length, body:addrList(r.refs)};
  }},

  {key:"refby", build: function(r: PlanResource){
    if (!r.dependents || !r.dependents.length) return null;
    return {title:"Referenced by", count:r.dependents.length, body:addrList(r.dependents)};
  }},

  {key:"hcl", build: function(r: PlanResource, ctx: any){
    var model = state.model;
    var hcl = hclFor(r, model && model.cfgByAddr && model.cfgByAddr[baseAddr(r.addr)]);
    if (!hcl) return null;
    ctx.hcl = hcl;
    return {title:"Terraform block", count:null, body:
      '<div class="cli">' + copyBlock("reconstructed", 'data-hcl="1"',
          '<pre class="hcl">' + hclHighlight(hcl) + '</pre>') + '</div>' +
      note("Rebuilt from the plan\u2019s configuration block. Comments and exact " +
           "interpolation are not in the plan, so values computed from variables are " +
           "shown resolved with their reference noted.")};
  }},

  {key:"rules", build: function(r: PlanResource){
    var rl = rulesHtml(r);
    return rl && {title:rl.title, count:null, body:rl.body};
  }},

  {key:"cli", build: function(r: PlanResource, ctx: any){
    var model = state.model;
    var cmds = CLI(r, {region: model && model.region});
    ctx.cmds = cmds;
    if (!cmds.length){
      return {title:"Inspect with the AWS CLI", count:0,
              body: note('No CLI recipe for <code>' + escapeHtml(r.type) + '</code> yet.')};
    }
    var b = '<div class="cli">';
    cmds.forEach(function(c: CliCommand, i: number){
      b += copyBlock(c.label, 'data-cli="' + i + '"',
        '<pre class="cli-cmd">' +
        escapeHtml(c.cmd).replace(/(\s)(--[a-z-]+)/g, '$1<span class="fl">$2</span>') +
        '</pre>');
    });
    return {title:"Inspect with the AWS CLI", count:cmds.length,
            body: b + '</div>' +
                  note("Placeholders in angle brackets are ids that only exist after apply.")};
  }},

  {key:"attrs", build: function(r: PlanResource){
    var a = attrRows(r);
    return {title:"Planned attributes", count:a.count, body:a.body};
  }}
];

function note(html: string): string { return '<div class="cli-note">' + html + '</div>'; }

function copyBlock(label: string, attr: string, inner: string): string {
  return '<div class="cli-item"><div class="cli-lbl"><span>' + escapeHtml(label) + '</span>' +
         '<button class="cli-copy" ' + attr + '>copy</button></div>' + inner + '</div>';
}

function addrList(addrs: string[]): string {
  return '<div class="reflist">' + addrs.map(function(a: string){
    return '<a data-goto="' + escapeHtml(a) + '">' + escapeHtml(a) + '</a>';
  }).join("") + '</div>';
}

function attrRows(r: PlanResource): {count: number; body: string} {
  var known = Object.keys(r.attrs || {}).filter(function(k: string){
    var v = (r.attrs as any)[k];
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v) && !v.length) return false;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) return false;
    return true;
  }).sort();
  var unknown = Object.keys(r.unknown || {}).filter(function(k: string){
    return (r.unknown as any)[k] === true && known.indexOf(k) < 0;
  }).sort();
  var count = known.length + unknown.length;

  var b = "";
  if (count > 10){
    b += '<div class="attr-search"><input type="text" id="attrFilter" ' +
         'placeholder="filter attributes" autocomplete="off"></div>';
  }
  b += '<div class="attrs" id="attrList">';
  if (!count){
    b += '<div class="attr"><span class="k">\u2014</span>' +
         '<span class="v unknown">no planned values</span></div>';
  }
  known.forEach(function(k: string){
    var v = (r.attrs as any)[k];
    var s = (typeof v === "object") ? JSON.stringify(v, null, 2) : String(v);
    var long = s.length > 120;
    if (s.length > 1200) s = s.slice(0, 1200) + "\n\u2026";
    b += '<div class="attr" data-k="' + escapeHtml(k) + '"><span class="k">' + escapeHtml(k) +
         '</span><span class="v' + (long ? " long" : "") + '">' + escapeHtml(s) + '</span></div>';
  });
  unknown.forEach(function(k: string){
    b += '<div class="attr" data-k="' + escapeHtml(k) + '"><span class="k">' + escapeHtml(k) +
         '</span><span class="v unknown">known after apply</span></div>';
  });
  return {count:count, body:b + '</div>'};
}

/* Sits directly above the sections and right-aligns with their chevrons, so
   it reads as the master switch for the column it lines up with. */
var SEC_MASTER =
  '<div class="sec-master"><button id="secAll" type="button">' +
    '<span class="lbl"></span>' +
    '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true">' +
      '<path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>' +
  '</button></div>';

/* What terraform will do, said as an outcome and marked with the symbol its
   own plan output uses, so it cannot be mistaken for part of the name. */
var ACTION_PHRASE: Record<string, [string, string]> = {
  create:  ["+",   "will be created"],
  update:  ["~",   "will be updated in place"],
  replace: ["-/+", "will be destroyed, then created"],
  "delete":["-",   "will be destroyed"],
  read:    ["<=",  "will be read"],
  "no-op": ["",    "no changes"]
};

function detailHeader(r: PlanResource): string {
  var color = (ACTION_COLOR as any)[r.action] || "var(--noop)";
  var phrase = ACTION_PHRASE[r.action] || ["", r.action];

  var flags =
    (r.supported ? "" :
      '<span class="badge" style="color:var(--warn); background:var(--warn-soft)">not implemented</span>') +
    (r.enabled ? "" :
      '<span class="badge" style="color:var(--replace); background:var(--warn-soft)">impact source</span>');

  return '<div class="dhd">' +
           '<div class="dhd-top">' +
             icoSvg(r.spec, 34) +
             '<div class="dhd-name">' +
               '<span class="type">' + escapeHtml(r.type) + '</span>' +
               '<h3>' + escapeHtml(r.name) + '</h3>' +
             '</div>' +
             '<span class="act-badge" title="' + escapeHtml(phrase[1]) + '"' +
               ' style="color:' + color +
               '; background:color-mix(in srgb, ' + color + ' 13%, transparent)">' +
               escapeHtml(r.action) +
               (phrase[0] ? '<i>' + escapeHtml(phrase[0]) + '</i>' : '') +
             '</span>' +
           '</div>' +
           (flags ? '<div class="badges">' + flags + '</div>' : '') +
         '</div>';
}

function renderDetail(): void {
  if (!detailEl) detailEl = $("detail");
  if (!splitEl) splitEl = $("split");
  var selected = state.selected;
  var model = state.model;
  if (!selected || !model || !model.byAddr[selected]){
    if (splitEl) splitEl.classList.remove("has-detail");
    if (detailEl) detailEl.innerHTML = "";
    return;
  }
  if (splitEl) splitEl.classList.add("has-detail");

  var r = model.byAddr[selected];
  var ctx: any = {};                                  /* builders stash copy targets here */
  var html = detailHeader(r) + SEC_MASTER;

  DETAIL_SECTIONS.forEach(function(s: DetailSectionDef){
    var built = s.build(r, ctx);
    if (built) html += sec(s.key, built.title, built.count, built.body);
  });

  if (detailEl) detailEl.innerHTML = html;
  wireSections();
  wireDetailControls(r, ctx);
}

function wireDetailControls(r: PlanResource, ctx: any): void {
  var filt = $("attrFilter") as HTMLInputElement | null;
  if (filt) filt.addEventListener("input", function(){
    if (!filt || !detailEl) return;
    var q = filt.value.trim().toLowerCase();
    Array.prototype.slice.call(detailEl.querySelectorAll<HTMLElement>("#attrList .attr")).forEach(function(row: HTMLElement){
      row.hidden = !!(q && (row.dataset.k || "").toLowerCase().indexOf(q) < 0);
    });
  });

  if (detailEl) {
    Array.prototype.slice.call(detailEl.querySelectorAll<HTMLElement>(".cli-copy")).forEach(function(b: HTMLElement){
      b.addEventListener("click", function(){
        var text = b.dataset.hcl ? ctx.hcl : (ctx.cmds && b.dataset.cli ? ctx.cmds[parseInt(b.dataset.cli, 10)].cmd : "");
        copyText(text, b);
      });
    });
  }
}

function copyText(text: string, btn: HTMLElement): void {
  function done(): void {
    btn.textContent = "copied"; btn.classList.add("done");
    setTimeout(function(){ btn.textContent = "copy"; btn.classList.remove("done"); }, 1400);
  }
  function fallback(): void {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch(e){}
    ta.remove();
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  } catch(e){ fallback(); }
}

onSelect(renderDetail);

/* Closes whichever view is open in the right pane — a selected resource's
   detail, or the plan-info view from clicking the source name — since both
   just clear the selection and re-render to the same empty state. */
var detailCloseBtn = $("detailClose");
if (detailCloseBtn) detailCloseBtn.addEventListener("click", function(){
  setSelected(null);
  renderDetail();
});

export {
  SEC_DEFAULT, secOpen, isOpen, CHEV, sec,
  detailSections, wireSections, SECTION_USE, sectionRows,
  driftRows, checkRows, renderPlanInfo, DETAIL_SECTIONS,
  note, copyBlock, addrList, attrRows, SEC_MASTER, ACTION_PHRASE,
  detailHeader, renderDetail, wireDetailControls, copyText
};
