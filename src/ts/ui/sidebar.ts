// ui/sidebar.js — Left sidebar metrics, action filters, types checklist & diagnostics
import { escapeHtml, $ } from "../core/util.js";
import { REG, CAT, CAT_LABEL } from "../providers/registry.js";
import { schemaFit } from "../core/schema.js";
import { state, onRender, setMode } from "../core/state.js";
import { ACTION_COLOR, render, select, icoSvg, changedKeys } from "./diagram.js";

function renderSidebar(){
  if (!state.model) return;
  /* one broken panel should not blank the others */
  [panelModeCounts, panelChanges, panelPlanSummary,
   panelCoverage, panelTypes, panelDiagnostics].forEach(function(panel){
    try { panel(); }
    catch(e){ console.error("panel failed:", panel.name, e); }
  });
}

/* The tabs are a mode switch, not a readout: counts live in the sidebar.
   Changes is disabled when the plan alters nothing. */
function panelModeCounts(){
  var model = state.model;
  if (!model) return;
  var nChg = model.resources.filter(function(r){
    return r.action !== "no-op" && r.action !== "read";
  }).length;
  var chg = $("modeChg") as HTMLButtonElement;
  if (chg) {
    chg.disabled = nChg === 0;
    chg.title = nChg
      ? "Mark what this plan changes on top of the current view"
      : "This plan changes nothing";
  }
  if (!nChg && state.opts.mode === "changes") setMode("all");
}

/* Destructive first: a destroy or a replacement is what needs reviewing,
   an in-place update rarely is. Alphabetical within each group so the
   order is stable between runs. */
var ACTION_RISK: Record<string, number> = {"delete":0, replace:1, update:2, create:3, read:4, "no-op":5};

function panelChanges(): void {
  var model = state.model;
  if (!model) return;
  var opts = state.opts;
  var changed = model.resources.filter(function(r: any){
    if (opts.action) return r.action === opts.action;
    return r.action !== "no-op" && r.action !== "read";
  }).sort(function(a: any, b: any){
    var d = (ACTION_RISK[a.action] ?? 99) - (ACTION_RISK[b.action] ?? 99);
    return d !== 0 ? d : a.addr.localeCompare(b.addr);
  });
  const list = $("chgList");
  if (!list) return;
  list.innerHTML = "";
  if (!changed.length) return;        /* the summary line already says it */

  changed.forEach(function(r: any){
    var forced = (r.replacePaths || []).map(function(pp: any){
      return Array.isArray(pp) ? pp[0] : pp;
    });
    var keys = changedKeys(r);
    var what = keys.slice(0, 3).map(function(k: string){
      return forced.indexOf(k) >= 0 ? '<i>' + escapeHtml(k) + '</i>' : escapeHtml(k);
    }).join(", ") + (keys.length > 3 ? " +" + (keys.length - 3) : "");

    var a = document.createElement("a");
    a.className = "chg";
    a.innerHTML =
      '<span class="a" style="color:' + (ACTION_COLOR as any)[r.action] +
        '; background:color-mix(in srgb, ' + (ACTION_COLOR as any)[r.action] + ' 15%, transparent)">' +
        escapeHtml(r.action) + '</span>' +
      '<span class="ad">' + escapeHtml(r.addr) + '</span>' +
      (what ? '<span class="wh">' + what + '</span>' : '');
    var aSpan = a.querySelector<HTMLElement>(".a");
    if (aSpan) aSpan.addEventListener("click", function(e: MouseEvent){
      e.stopPropagation();
      opts.action = (opts.action === r.action) ? null : r.action;
      render();
    });
    a.addEventListener("click", function(){ select(r.addr); });
    list.appendChild(a);
  });
}

/* The list below names every change, so a proportional bar would only
   restate it. The header carries the totals. */
/* The bar is the filter: click a segment to narrow to that action, click it
   again to clear. No separate control, and nothing that can wrap. */
function panelPlanSummary(): void {
  var model = state.model;
  if (!model) return;
  var opts = state.opts;
  var S = model.summary || ({} as any);
  var order = [["create","to add"],["update","to change"],
               ["replace","to replace"],["delete","to destroy"]];
  var shown = order.filter(function(o){ return S[o[0]]; });
  var total = shown.reduce(function(n, o){ return n + (S[o[0]] || 0); }, 0);

  var planSumEl = $("planSum");
  if (!planSumEl) return;
  planSumEl.innerHTML = shown.length
    ? '<div class="statbar filterable' + (opts.action ? " filtered" : "") + '">' +
      shown.map(function(o){
        var n = S[o[0]] || 0, pct = total ? (n / total * 100) : 0;
        return '<span role="button" tabindex="0" data-action="' + o[0] + '"' +
               ' title="' + n + ' ' + o[1] +
               (opts.action === o[0] ? " \u2014 click to clear" : " \u2014 click to show only these") + '"' +
               ' style="flex:' + n + ';background:' + (ACTION_COLOR as any)[o[0]] +
               ';--seg:' + (ACTION_COLOR as any)[o[0]] + '"' +
               ' class="' + (pct < 9 ? "tiny " : "") +
               (opts.action === o[0] ? "on" : "") + '">' + n + '</span>';
      }).join("") + '</div>'
    : '<span class="no-changes">no changes</span>';

  Array.prototype.slice.call(planSumEl.querySelectorAll("[data-action]")).forEach(function(seg: HTMLElement){
    function toggle(): void {
      opts.action = (opts.action === seg.dataset.action) ? null : (seg.dataset.action || null);
      render();
    }
    seg.addEventListener("click", toggle);
    seg.addEventListener("keydown", function(e: KeyboardEvent){
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
    });
  });

  var outs = model.outputs ? Object.keys(model.outputs).length : 0;
  var metaEl = $("planMeta");
  if (metaEl) metaEl.textContent = outs ? (outs + " outputs") : "";
}

function panelCoverage(){
  var model = state.model;
  if (!model) return;
  var opts = state.opts;
  var total = model.resources.length;
  var sup = model.resources.filter(function(r){ return r.supported; }).length;
  var assoc = model.resources.filter(function(r){ return r.supported && r.kind === "assoc"; }).length;
  var un = total - sup;
  var hiddenAssoc = opts.showAssoc ? 0 : assoc;
  var missing = un + hiddenAssoc;

  var block = $("covBlock");
  if (!block) return;
  if (!missing){ block.hidden = true; return; }

  block.hidden = false;
  var countEl = $("covCount");
  if (countEl) countEl.textContent = missing + " of " + total;

  const bar = $("covBar");
  if (bar) {
    bar.innerHTML = "";
    var segs: [number, string, string][] = [
      [total - missing, "var(--create)", "drawn"],
      [hiddenAssoc, "var(--aws-net)", "associations hidden"],
      [un, "var(--warn)", "type not implemented"]
    ];
    segs.forEach(function(seg){
      if (!seg[0] || !total) return;
      var s = document.createElement("span");
      s.style.flex = String(seg[0]);
      s.style.background = seg[1];
      s.title = seg[0] + " " + seg[2];
      s.textContent = String(seg[0]);
      if (seg[0] / total * 100 < 9) s.className = "tiny";
      bar.appendChild(s);
    });
  }

  var parts = [];
  if (un) parts.push('<span><i class="sw" style="background:var(--warn)"></i>' +
    'type not implemented <b>' + un + '</b></span>');
  if (hiddenAssoc) parts.push('<span><i class="sw" style="background:var(--aws-net)"></i>' +
    'associations hidden <b>' + hiddenAssoc + '</b></span>');
  var leg = $("covLegend");
  if (leg) leg.innerHTML = parts.join("");
}

function setTypes(types: string[], on: boolean): void {
  var model = state.model;
  if (!model) return;
  model.resources.forEach(function(r: any){
    if (types.indexOf(r.type) >= 0) r.enabledType = on;
  });
  render();
}

function panelTypes(): void {
  const model = state.model;
  if (!model) return;
  var types = Object.keys(model.typeCounts).sort();
  var tc = $("typeCount");
  if (tc) tc.textContent = String(types.length);

  var buckets: Record<string, string[]> = {};
  types.forEach(function(t: string){
    var spec = REG[t];
    var cat = spec ? (spec.cat || "other") : "other";
    (buckets[cat] = buckets[cat] || []).push(t);
  });

  const f = $("filters");
  if (!f) return;
  f.innerHTML = "";

  CAT_LABEL.forEach(function(c: [string, string]){
    var list = buckets[c[0]];
    if (!list || !list.length) return;

    var n = list.reduce(function(sum: number, t: string){ return sum + model.typeCounts[t]; }, 0);
    var allOn = list.every(function(t: string){
      return model.resources.some(function(r: any){ return r.type === t && r.enabledType !== false; });
    });

    var head = document.createElement("button");
    head.className = "cat" + (allOn ? "" : " off");
    head.innerHTML = '<span class="dot" style="background:' +
        (c[0] === "other" ? "var(--warn)" : (CAT as any)[c[0]]) + '"></span>' +
      escapeHtml(c[1]) + '<span class="ct">' + n + '</span>';
    head.title = (allOn ? "Hide" : "Show") + " every " + c[1].toLowerCase() + " resource";
    head.addEventListener("click", function(){ setTypes(list, !allOn); });
    f.appendChild(head);

    list.forEach(function(t: string){
      var spec = REG[t];
      var on = model.resources.some(function(r: any){ return r.type === t && r.enabledType !== false; });
      var row = document.createElement("label");
      row.className = "flt" + (spec ? "" : " unsup");
      row.title = t;
      row.innerHTML = '<input type="checkbox"' + (on ? " checked" : "") + '>' +
        icoSvg(spec, 18) +
        '<span class="nm">' + escapeHtml(t.replace(/^aws_/, "")) + '</span>' +
        '<span class="ct">' + model.typeCounts[t] + '</span>';
      var inp = row.querySelector("input");
      if (inp) {
        inp.addEventListener("change", function(e: Event){
          setTypes([t], (e.target as HTMLInputElement).checked);
        });
      }
      f.appendChild(row);
    });
  });
}

function panelDiagnostics(): void {
  const model = state.model;
  if (!model) return;
  /* these are recomputed every render, so drop the previous round first */
  model.diagnostics = (model.diagnostics || []).filter(function(g: any){
    return g.code.indexOf("schema-") !== 0;
  });
  var fit = schemaFit();
  if (fit.usingLoaded){
    if (model.diag) model.diag("ok", "schema-loaded",
      "Using the provider schema you loaded.");
  } else if (fit.mismatch){
    if (model.diag) model.diag("warn", "schema-version",
      '<span title="set/list/map can differ between major provider versions. ' +
      'Drop terraform providers schema -json output to be exact.">' +
      'plan targets <b>' + escapeHtml(fit.constraint) + '</b>, bundled schema is <b>' +
      escapeHtml(fit.bundled) + '</b></span>');
  }
  if (fit.unknown.length){
    if (model.diag) model.diag("info", "schema-unknown",
      "<b>" + fit.unknown.length + "</b> unknown type" +
      (fit.unknown.length > 1 ? "s" : ""), fit.unknown);
  }

  const d = $("diag");
  if (!d) return;
  d.innerHTML = "";
  if (!model.diagnostics.length){
    d.innerHTML = '<div class="dg-empty">No issues.</div>';
    return;
  }
  var ICON: Record<string, string> = {err:"\u2715", warn:"!", ok:"\u2713", info:"i"};
  model.diagnostics.forEach(function(g: any){
    var icon = '<span class="ic">' + (ICON[g.level] || "i") + '</span>';

    if (!g.detail || !g.detail.length){
      var el = document.createElement("div");
      el.className = "dg " + g.level;
      el.innerHTML = icon + '<span>' + g.msg + '</span>';
      d.appendChild(el);
      return;
    }

    var detList: string[] = Array.isArray(g.detail) ? g.detail : [String(g.detail)];
    var det = document.createElement("details");
    det.className = "dg " + g.level + " has-detail";
    det.innerHTML =
      '<summary>' + icon + '<span>' + g.msg + '</span>' +
        '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true">' +
          '<path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</summary>' +
      '<ul class="dg-list">' + detList.map(function(x: string){
        var known = model.byAddr[x];
        return '<li' + (known ? ' data-goto="' + escapeHtml(x) + '"' : '') + '>' +
               escapeHtml(x) + '</li>';
      }).join("") + '</ul>';

    Array.prototype.slice.call(det.querySelectorAll("[data-goto]")).forEach(function(li: HTMLElement){
      li.addEventListener("click", function(){ if (li.dataset.goto) select(li.dataset.goto); });
    });
    d.appendChild(det);
  });
}

onRender(renderSidebar);

export {
  renderSidebar, panelModeCounts, panelChanges,
  panelPlanSummary, panelCoverage, setTypes, panelTypes, panelDiagnostics
};
