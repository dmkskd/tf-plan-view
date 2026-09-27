// ui/textview.js — Plaintext plan viewer mimicking terraform format
import { escapeHtml, $ } from "../core/util.js";
import { actionOf } from "../core/parser.js";
import { isSensitive, sameVal, matchRules } from "../core/diff.js";
import { hclValue } from "../core/hcl.js";
import { changedKeys } from "./diagram.js";
import { attrKind } from "../core/schema.js";
import { state, onRender } from "../core/state.js";
import type { PlanModel, PlanResource, RenderOptions } from "../types/index.js";

/* ------------------------------------------------------------------
   Text view.

   The plan written the way terraform writes it, which is the form most
   people already read it in — in a terminal, or posted into a pull
   request by Atlantis. Selectable and copyable.
   ------------------------------------------------------------------ */

var TEXT_HEAD: Record<string, [string, string, string]> = {
  create:  ["+",   "will be created",                 "add"],
  update:  ["~",   "will be updated in place",        "upd"],
  replace: ["-/+", "must be replaced",                "rep"],
  "delete":["-",   "will be destroyed",               "del"],
  "no-op": ["",    "no changes",                      "upd"],
  read:    ["<=",  "will be read during apply",       "upd"]
};

/* A collection printed as one JSON blob is unreadable, which is why
   terraform expands its elements. Reuse the schema-aware matcher so only
   the entries that moved are spelled out. */
function isObjList(v: any): boolean {
  return Array.isArray(v) && v.length > 0 && v.every(function(x: any){
    return x && typeof x === "object" && !Array.isArray(x);
  });
}

function tvElement(entry: any, mark: string, cls: string): string[] {
  var keys = Object.keys(entry).filter(function(k: string){
    var v = entry[k];
    return !(v === null || v === undefined || v === "" ||
             (Array.isArray(v) && !v.length));
  }).sort();
  var pad = keys.reduce(function(n: number, k: string){ return Math.max(n, k.length); }, 0);
  var out = ['          <span class="' + cls + '">' + mark + '</span> {'];
  keys.forEach(function(k: string){
    out.push('              <span class="' + cls + '">' + mark + '</span> ' +
             '<span class="a">' + escapeHtml(k) + '</span>' +
             new Array(pad - k.length + 1).join(" ") +
             ' = ' + hclValue(tvLit(entry[k])));
  });
  out.push("            },");
  return out;
}

function tvCollection(name: string, pad: number, before: any, after: any, type: string): string[] {
  var matched = matchRules(before, after, attrKind(type, name));
  var kept = matched.filter(function(m: any){ return m.mark === ""; }).length;
  var out = ['      <span class="upd">~</span> ' +
             escapeHtml(name) + new Array(pad - name.length + 1).join(" ") + ' = ['];
  matched.forEach(function(m: any){
    if (m.mark === "+") out = out.concat(tvElement(m.rule, "+", "add"));
    else if (m.mark === "-") out = out.concat(tvElement(m.rule, "-", "del"));
  });
  if (kept) out.push('            <span class="c"># (' + kept + ' unchanged element' +
                     (kept === 1 ? "" : "s") + ' hidden)</span>');
  out.push("        ]");
  return out;
}

function tvLit(v: any): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* Topology + Text is the whole document: every resource with its planned
   values, the way `terraform show` writes it. No markers, because nothing
   is being compared. */
function documentBody(): string {
  var model = state.model, opts = state.opts;
  if (!model) return "";
  var list = model.resources.filter(function(r: any){
    if (opts.action && r.action !== opts.action) return false;
    return true;
  }).sort(function(a: any, b: any){ return a.addr.localeCompare(b.addr); });

  var out: string[] = ['<span class="c"># ' + escapeHtml(model.source) + '</span>', ""];
  out = out.concat(tvVariables());
  out = out.concat(tvDrift());
  out = out.concat(tvHead("Resources", list.length));

  list.forEach(function(r: any){
    var vals = r.attrs || {};
    var keys = Object.keys(vals).filter(function(k: string){
      var v = vals[k];
      return !(v === null || v === undefined || v === "" ||
               (Array.isArray(v) && !v.length));
    }).sort();
    var unknown = Object.keys(r.unknown || {}).filter(function(k: string){
      return (r.unknown as any)[k] === true && keys.indexOf(k) < 0;
    }).sort();

    out.push('<span class="c"># ' + escapeHtml(r.addr) +
             (r.action === "delete" ? '   <span class="del">will not exist after apply</span>' : '') +
             '</span>');
    out.push('<span class="k">resource</span> <span class="t">"' + escapeHtml(r.type) +
             '"</span> <span class="s">"' + escapeHtml(r.name) + '"</span> {');

    var pad = keys.concat(unknown).reduce(function(n: number, k: string){
      return Math.max(n, k.length);
    }, 0);

    keys.forEach(function(k: string){
      var name = '<span class="a">' + escapeHtml(k) + '</span>' +
                 new Array(pad - k.length + 1).join(" ");
      if (isSensitive(r.sensitive && (r.sensitive as any)[k])){
        out.push('    ' + name + ' = <span class="unk">(sensitive value)</span>');
      } else if (isObjList(vals[k])){
        out.push('    ' + name + ' = [');
        vals[k].forEach(function(e: any){
          out = out.concat(tvElement(e, " ", "c"));
        });
        out.push("    ]");
      } else {
        out.push('    ' + name + ' = ' + hclValue(tvLit(vals[k])));
      }
    });
    unknown.forEach(function(k: string){
      out.push('    <span class="a">' + escapeHtml(k) + '</span>' +
               new Array(pad - k.length + 1).join(" ") +
               ' = <span class="unk">(known after apply)</span>');
    });

    if (!keys.length && !unknown.length){
      out.push('    <span class="c"># no values are known yet</span>');
    }
    out.push("}");
    out.push("");
  });

  out = out.concat(tvOutputs(false));
  out = out.concat(tvChecks());
  return out.join("\n");
}

function tvHead(title?: string, count?: number): string[] { return []; }        /* headings are the <summary> now */

function tvVariables(): string[] {
  var model = state.model;
  if (!model) return [];
  var v = (model.raw && model.raw.variables) || null;
  if (!v) return [];
  var names = Object.keys(v).sort();
  if (!names.length) return [];
  var pad = names.reduce(function(n: number, k: string){ return Math.max(n, k.length); }, 0);
  var out = tvHead("Variables", names.length);
  names.forEach(function(n: string){
    out.push('    <span class="a">' + escapeHtml(n) + '</span>' +
             new Array(pad - n.length + 1).join(" ") + ' = ' +
             hclValue(tvLit(v[n] && v[n].value)));
  });
  out.push("");
  return out;
}

function tvDrift(): string[] {
  var model = state.model;
  if (!model) return [];
  var d = (model.raw && model.raw.resource_drift) || [];
  if (!d.length) return [];
  var out = tvHead("Drift", d.length);
  d.forEach(function(x: any){
    var before = (x.change && x.change.before) || {};
    var after  = (x.change && x.change.after) || {};
    var keys = Object.keys(before).concat(Object.keys(after)).filter(function(k: string, i: number, a: string[]){
      return a.indexOf(k) === i && !sameVal(before[k], after[k]);
    }).sort();
    out.push('  <span class="c"># ' + escapeHtml(x.address) + ' has changed</span>');
    out.push('  <span class="upd">~</span> <span class="k">resource</span> <span class="t">"' +
             escapeHtml(x.type) + '"</span> <span class="s">"' + escapeHtml(x.name) + '"</span> {');
    var pad = keys.reduce(function(n: number, k: string){ return Math.max(n, k.length); }, 0);
    keys.forEach(function(k: string){
      out.push('      <span class="upd">~</span> <span class="a">' + escapeHtml(k) + '</span>' +
               new Array(pad - k.length + 1).join(" ") + ' = ' +
               '<span class="old">' + escapeHtml(tvLit(before[k])) + '</span> -> ' +
               '<span class="new">' + escapeHtml(tvLit(after[k])) + '</span>');
    });
    out.push("    }");
    out.push("");
  });
  return out;
}

function tvChecks(): string[] {
  var model = state.model;
  if (!model) return [];
  var c = (model.raw && model.raw.checks) || [];
  if (!c.length) return [];
  var out = tvHead("Checks", c.length);
  c.forEach(function(x: any){
    var addr = (x.address && (x.address.to_display || x.address.kind)) || "check";
    var cls = x.status === "fail" || x.status === "error" ? "del" : "add";
    out.push('  <span class="' + cls + '">' + escapeHtml(x.status || "?") + '</span>  ' +
             escapeHtml(addr));
    (x.instances || []).forEach(function(i: any){
      (i.problems || []).forEach(function(pr: any){
        out.push('      <span class="c">' + escapeHtml(pr.message || "") + '</span>');
      });
    });
  });
  out.push("");
  return out;
}

function tvOutputs(changesOnly: boolean): string[] {
  var model = state.model;
  if (!model) return [];
  var o = (model.raw && model.raw.output_changes) || null;
  if (!o) return [];
  var names = Object.keys(o).sort();
  if (!names.length) return [];

  var shown = changesOnly
    ? names.filter(function(n: string){ return (o[n].actions || []).join(",") !== "no-op"; })
    : names;
  if (!shown.length) return [];

  var pad = shown.reduce(function(n: number, k: string){ return Math.max(n, k.length); }, 0);
  var out = tvHead(changesOnly ? "Changes to outputs" : "Outputs", shown.length);
  shown.forEach(function(n: string){
    var ch = o[n];
    var act = actionOf(ch.actions);
    var head = TEXT_HEAD[act] || ["~", "", "upd"];
    var val = ch.after_unknown === true
      ? '<span class="unk">(known after apply)</span>'
      : (ch.after_sensitive === true
          ? '<span class="unk">(sensitive value)</span>'
          : hclValue(tvLit(ch.after)));
    out.push('  ' + (changesOnly
              ? '<span class="' + head[2] + '">' + head[0] + '</span> '
              : '  ') +
             '<span class="a">' + escapeHtml(n) + '</span>' +
             new Array(pad - n.length + 1).join(" ") + ' = ' + val);
  });
  out.push("");
  return out;
}

interface TextSection {
  key: string;
  label: string;
  count: number | null;
  body: string;
  note?: string;
}

/* Each section is produced separately so the view can collapse them. */
function textSections(): TextSection[] {
  var model = state.model, opts = state.opts;
  if (!model || !model.resources.length) return [];
  var out: TextSection[] = [];

  function add(key: string, label: string, lines: string[], note?: string): void {
    var body = (lines || []).join("\n").replace(/\n+$/, "");
    if (!body) return;
    out.push({key:key, label:label, count:null, body:body, note:note});
  }

  if (opts.mode === "changes"){
    var d = tvDrift();
    if (d.length) out.push({key:"drift", label:"Drift",
      count:(model.raw.resource_drift || []).length,
      body:d.join("\n").replace(/\n+$/, ""),
      note:"changed outside terraform since the last apply"});

    out.push({key:"plan", label:"Planned changes",
      count:model.resources.filter(function(r: PlanResource){
        return r.action !== "no-op" && r.action !== "read" &&
               (!opts.action || r.action === opts.action);
      }).length,
      body:changesBody(), note:"what terraform will do"});

    var oc = tvOutputs(true);
    if (oc.length) out.push({key:"outputs", label:"Changes to outputs",
      count:null, body:oc.join("\n").replace(/\n+$/, "")});
  } else {
    var v = tvVariables();
    if (v.length) out.push({key:"variables", label:"Variables",
      count:Object.keys(model.raw.variables || {}).length,
      body:v.join("\n").replace(/\n+$/, ""), note:"inputs used for this plan"});

    var dd = tvDrift();
    if (dd.length) out.push({key:"drift", label:"Drift",
      count:(model.raw.resource_drift || []).length,
      body:dd.join("\n").replace(/\n+$/, ""),
      note:"changed outside terraform since the last apply"});

    out.push({key:"plan", label:"Planned changes",
      count:model.resources.filter(function(r: PlanResource){
        return r.action !== "no-op" && r.action !== "read" &&
               (!opts.action || r.action === opts.action);
      }).length,
      body:changesBody(), note:"what terraform will do"});

    out.push({key:"resources", label:"Resources", count:null,
      body:documentBody(), note:"as they will be after apply"});

    var oo = tvOutputs(false);
    if (oo.length) out.push({key:"outputs", label:"Outputs", count:null,
      body:oo.join("\n").replace(/\n+$/, "")});
  }

  var c = tvChecks();
  if (c.length) out.push({key:"checks", label:"Checks",
    count:(model.raw.checks || []).length, body:c.join("\n").replace(/\n+$/, "")});

  return out;
}

function planText(): string {
  return textSections().map(function(s){ return s.body; }).join("\n\n");
}

function documentText(): string { return documentBody(); }

/* the execution plan itself: drift is a separate section now */
function changesBody(): string {
  var model = state.model, opts = state.opts;
  if (!model) return "";
  var list = model.resources.filter(function(r: PlanResource){
    if (r.action === "no-op" || r.action === "read") return false;
    if (opts.action && r.action !== opts.action) return false;
    return true;
  }).sort(function(a: PlanResource, b: PlanResource){ return a.addr.localeCompare(b.addr); });

  var out: string[] = [];
  out.push('<span class="c">Terraform used the selected providers to generate the ' +
           'following execution plan.</span>');
  out.push('<span class="c">Resource actions are indicated with the following symbols:</span>');
  var seen: Record<string, number> = {};
  list.forEach(function(r: PlanResource){ seen[r.action] = 1; });
  Object.keys(TEXT_HEAD).forEach(function(a: string){
    if (seen[a]) out.push('  <span class="' + TEXT_HEAD[a][2] + '">' + TEXT_HEAD[a][0] +
                          '</span> ' + '<span class="c">' + a + '</span>');
  });
  out.push("");
  out.push('<span class="c">Terraform will perform the following actions:</span>');
  out.push("");

  list.forEach(function(r: PlanResource){
    var head = TEXT_HEAD[r.action] || ["~", r.action, "upd"];
    var cls = head[2], sym = head[0];
    out.push('  <span class="c"># ' + escapeHtml(r.addr) + ' ' + head[1] + '</span>');

    var open = '<span class="' + cls + '">' + sym + '</span> ' +
               '<span class="k">resource</span> <span class="t">"' + escapeHtml(r.type) +
               '"</span> <span class="s">"' + escapeHtml(r.name) + '"</span> {';
    out.push(sym.length === 3 ? open : "  " + open);

    var before: Record<string, any> = r.before || {}, after: Record<string, any> = r.attrs || {};
    var keys: string[], mode: "new" | "old" | "diff";
    if (r.action === "create"){ keys = Object.keys(after).sort(); mode = "new"; }
    else if (r.action === "delete"){ keys = Object.keys(before).sort(); mode = "old"; }
    else { keys = changedKeys(r); mode = "diff"; }

    keys = keys.filter(function(k: string){
      var v = mode === "old" ? before[k] : after[k];
      if (mode === "diff") return true;
      return !(v === null || v === undefined || v === "" ||
               (Array.isArray(v) && !v.length));
    });

    var pad = keys.reduce(function(n: number, k: string){ return Math.max(n, k.length); }, 0);
    var forced = (r.replacePaths || []).map(function(pp: any){
      return Array.isArray(pp) ? pp[0] : pp;
    });

    keys.forEach(function(k: string){
      var name = '<span class="a">' + escapeHtml(k) + '</span>' +
                 new Array(pad - k.length + 1).join(" ");
      var sens = isSensitive(r.sensitive && (r.sensitive as any)[k]);
      var unknown = r.unknown && (r.unknown as any)[k] === true;

      if (mode === "new"){
        out.push('      <span class="add">+</span> ' + name + ' = ' +
                 '<span class="new">' + escapeHtml(sens ? "(sensitive value)" : tvLit(after[k])) + '</span>');
      } else if (mode === "old"){
        out.push('      <span class="del">-</span> ' + name + ' = ' +
                 '<span class="old">' + escapeHtml(sens ? "(sensitive value)" : tvLit(before[k])) + '</span>');
      } else if (!unknown && !sens && (isObjList(before[k]) || isObjList(after[k]))){
        out = out.concat(tvCollection(k, pad, before[k], after[k], r.type));
      } else {
        var oldV = escapeHtml(sens ? "(sensitive value)" : tvLit(before[k]));
        var newV = unknown ? '<span class="unk">(known after apply)</span>'
                           : '<span class="new">' + escapeHtml(sens ? "(sensitive value)" : tvLit(after[k])) + '</span>';
        out.push('      <span class="upd">~</span> ' + name + ' = ' +
                 '<span class="old">' + oldV + '</span> -> ' + newV +
                 (forced.indexOf(k) >= 0 ? ' <span class="force"># forces replacement</span>' : ''));
      }
    });

    if (!keys.length) out.push('      <span class="c"># no attribute values are known yet</span>');
    out.push("    }");
    out.push("");
  });

  var S: any = model.summary || {};
  var addCount = (S.create || 0) + (S.replace || 0);
  var chg = (S.update || 0);
  var des = (S["delete"] || 0) + (S.replace || 0);
  out.push('<span class="sum">Plan: ' + addCount + ' to add, ' + chg + ' to change, ' +
           des + ' to destroy.</span>');
  if (S.replace) {
    out.push('<span class="c">(a replacement counts as both an add and a destroy, ' +
             'as terraform reports it)</span>');
  }

  var outs = tvOutputs(true);
  if (outs.length){ out.push(""); out = out.concat(outs); }
  out = out.concat(tvChecks());
  return out.join("\n");
}

var TEXT_SEC_DEFAULT: Record<string, boolean> = {resources:true, plan:true};
var textSecState: Record<string, boolean> = {};
try {
  var saved = localStorage.getItem("plan-atlas-sections");
  if (saved) textSecState = JSON.parse(saved) || {};
} catch(e){ textSecState = {}; }

function textSecOpen(key: string): boolean {
  var v = textSecState["text:" + key];
  return (v === undefined) ? !!TEXT_SEC_DEFAULT[key] : !!v;
}

function syncTextAll(): void {
  var plan = $("textPlan");
  if (!plan) return;
  var all = Array.prototype.slice.call(plan.querySelectorAll("details[data-tsec]"));
  var btn = $("tvAll");
  if (!btn) return;
  btn.hidden = !all.length;
  var anyClosed = all.some(function(d: HTMLDetailsElement){ return !d.open; });
  btn.textContent = anyClosed ? "Expand all" : "Collapse all";
  btn.dataset.want = anyClosed ? "open" : "close";
}

function renderText(): void {
  var model = state.model, opts = state.opts;
  var changesOnly = opts.mode === "changes";
  var sections = textSections();

  var textPlanEl = $("textPlan");
  if (textPlanEl) {
    textPlanEl.innerHTML = sections.length
      ? sections.map(function(s){
          return '<details class="tsec" data-tsec="' + s.key + '"' +
                   (textSecOpen(s.key) ? " open" : "") + '>' +
                   '<summary>' +
                     '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true">' +
                       '<path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" ' +
                       'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                     '<span class="lbl">' + escapeHtml(s.label) + '</span>' +
                     (s.count !== null && s.count !== undefined
                        ? '<span class="n">' + s.count + '</span>' : '') +
                     (s.note ? '<span class="note">' + escapeHtml(s.note) + '</span>' : '') +
                   '</summary>' +
                   '<pre>' + s.body + '</pre>' +
                 '</details>';
        }).join("")
      : '<span class="c">This plan changes nothing.</span>';

    Array.prototype.slice.call(textPlanEl.querySelectorAll("details[data-tsec]"))
      .forEach(function(d: HTMLDetailsElement){
        d.addEventListener("toggle", function(){
          if (d.dataset.tsec) textSecState["text:" + d.dataset.tsec] = d.open;
          try { localStorage.setItem("plan-atlas-sections", JSON.stringify(textSecState)); } catch(e){}
          syncTextAll();
        });
      });
  }
  syncTextAll();

  var n = model ? model.resources.filter(function(r: PlanResource){
    if (opts.action && r.action !== opts.action) return false;
    return changesOnly ? (r.action !== "no-op" && r.action !== "read") : true;
  }).length : 0;

  var tvMetaEl = $("tvMeta");
  if (tvMetaEl) {
    tvMetaEl.textContent =
      (changesOnly ? "planned changes \u00b7 " : "planned state \u00b7 ") +
      n + (n === 1 ? " resource" : " resources") +
      (opts.action ? "  \u00b7  " + opts.action + " only" : "");
  }
}

var tvAll = $("tvAll");
if (tvAll) {
  tvAll.addEventListener("click", function(){
    var wantOpen = (tvAll ? tvAll.dataset.want : "") !== "close";
    var textPlanEl = $("textPlan");
    if (textPlanEl) {
      Array.prototype.slice.call(textPlanEl.querySelectorAll("details[data-tsec]"))
        .forEach(function(d: HTMLDetailsElement){
          d.open = wantOpen;
          if (d.dataset.tsec) textSecState["text:" + d.dataset.tsec] = wantOpen;
        });
    }
    try { localStorage.setItem("plan-atlas-sections", JSON.stringify(textSecState)); } catch(e){}
    syncTextAll();
  });
}

onRender(function(model: PlanModel | null, opts: RenderOptions){
  if (opts && opts.render === "text") {
    renderText();
  }
});

function copyTvText(str: string, btn: HTMLElement): void {
  function ok(){
    var prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function(){ btn.textContent = prev; }, 1200);
  }
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(str).then(ok, fallback);
  } else fallback();
  function fallback(){
    var ta = document.createElement("textarea");
    ta.value = str;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); ok(); } catch(e){}
    document.body.removeChild(ta);
  }
}

export {
  renderText,
  documentBody,
  changesBody,
  planText,
  documentText
};
