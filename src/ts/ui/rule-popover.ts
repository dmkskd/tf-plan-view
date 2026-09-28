import { $, html, raw, type SafeHtml } from "../core/util.js";
import { popRow } from "../providers/registry.js";
import { sameVal, matchRules } from "../core/diff.js";
import { attrKind } from "../core/schema.js";
import { icoSvg } from "./diagram.js";
import { state } from "../core/state.js";
import { PlanResource } from "../types/index.js";

/* ------------------------------------------------------------------
   Rule preview. Security groups and network ACLs are the two things you
   most often want to read without opening anything, so hovering one
   shows its rules as direction, port, protocol and peer.

   Every other resource gets a smaller preview: a curated handful of its
   attributes (REG[type].preview, per provider catalog), not a full dump
   — the detail pane already does the full dump on click. Sensitive
   attributes are never shown here. A resource with no preview list, or
   whose preview attributes are all empty, gets no popover at all.
   ------------------------------------------------------------------ */

var popEl: HTMLElement | null = $("rulePop"), popTimer: any = null, popAddr: string | null = null;

function popRuleLines(r: PlanResource, dir: string, isNacl?: boolean): string {
  var after = (r.attrs || {})[dir];
  var before = (r.before || {})[dir];
  /* Topology shows the rules as they will be; only Changes marks the diff,
     so the card matches whichever mode the diagram is in */
  var changed = state.opts.mode === "changes" &&
                r.action !== "create" && r.action !== "no-op" &&
                Array.isArray(before) && !sameVal(before, after);

  var out: string;
  if (changed){
    out = matchRules(before, after, attrKind(r.type, dir), r)
            .map(function(m: any){ return popRow(r, m.rule, dir, isNacl, m.mark); }).join("");
  } else {
    var entries = Array.isArray(after) ? after : [];
    if (!entries.length) return '<div class="rp-none">no ' + dir + ' rules</div>';
    var list = entries.slice();
    if (isNacl) list.sort(function(a: any, b: any){ return (a.rule_no || 0) - (b.rule_no || 0); });
    out = list.map(function(e: any){ return popRow(r, e, dir, isNacl, ""); }).join("");
  }
  if (!out) return '<div class="rp-none">no ' + dir + ' rules</div>';

  if (isNacl){
    out += popRow(r, {action:"deny", protocol:"-1", from_port:0, to_port:0,
                   cidr_block:"0.0.0.0/0"}, dir, false, "");
  }
  return out;
}

/* One row per key in spec.preview that resolves to something worth
   showing: a non-empty known value, or "known after apply" when the
   plan cannot resolve it yet. Sensitive attributes are dropped. A key
   already shown as the tile's subtitle (spec.sub, e.g. "postgres") is
   still repeated here — the hover card should be a self-contained
   summary, not rely on the tile's small print already being visible. */
function attrPreviewVal(v: any): string | null {
  if (Array.isArray(v)){
    if (!v.length) return null;
    var s = v.slice(0, 3).map(String).join(", ");
    return v.length > 3 ? s + " …" : s;
  }
  if (v && typeof v === "object") return null;
  var str = String(v);
  return str.length > 64 ? str.slice(0, 64) + "…" : str;
}

function attrPreviewRows(r: PlanResource): SafeHtml {
  var keys = (r.spec && r.spec.preview) || [];
  var rows = keys.map(function(k: string){
    if (r.sensitive && (r.sensitive as any)[k]) return null;
    var known = r.unknown && (r.unknown as any)[k] === true;
    var text = known ? "known after apply" : attrPreviewVal(r.attrs ? r.attrs[k] : undefined);
    if (text === null || text === undefined || text === "") return null;
    return html`
      <div class="rp-attr">
        <span class="rp-k">${k.replace(/_/g, " ")}</span>
        <span class="rp-v${known ? " unknown" : ""}">${text}</span>
      </div>
    `;
  });
  return html`${rows}`;
}

function hasPreview(r: PlanResource | null | undefined): boolean {
  if (!r) return false;
  if (r.type === "aws_security_group" || r.type === "aws_network_acl") return true;
  return !!attrPreviewRows(r).value;
}

function showRulePop(addr: string, x: number, y: number): void {
  if (!popEl) popEl = $("rulePop");
  if (!popEl) return;
  var r = state.model && state.model.byAddr[addr];
  if (!r) return;
  var isSg = r.type === "aws_security_group";
  var isNacl = r.type === "aws_network_acl";

  var body: SafeHtml;
  if (isSg || isNacl){
    body = html`
      <div class="rp-dir">inbound</div>
      ${raw(popRuleLines(r, "ingress", isNacl))}
      <div class="rp-dir">outbound</div>
      ${raw(popRuleLines(r, "egress", isNacl))}
      <div class="rp-foot">
        ${isSg
          ? "Stateful: replies to allowed traffic return without a matching rule."
          : "Stateless: each direction is evaluated on its own, first match wins."}
      </div>
    `;
  } else {
    var rows = attrPreviewRows(r);
    if (!rows.value) return;
    body = html`<div class="rp-attrs">${rows}</div>`;
  }

  popEl.innerHTML = html`
    <div class="rp-title">
      ${icoSvg(r.spec, 14)}
      ${isSg ? "security group" : isNacl ? "network acl" : ((r.spec && r.spec.label) || r.type)}
      <b>${r.name}</b>
    </div>
    ${body}
  `.toString();

  popEl.hidden = false;
  var w = popEl.offsetWidth, hh = popEl.offsetHeight;
  popEl.style.left = Math.min(x + 14, window.innerWidth  - w - 8) + "px";
  popEl.style.top  = Math.min(y + 14, window.innerHeight - hh - 8) + "px";
  popAddr = addr;
}

function hideRulePop(): void {
  clearTimeout(popTimer);
  if (!popEl) popEl = $("rulePop");
  if (popEl) popEl.hidden = true;
  popAddr = null;
}

(function wireRulePop(): void {
  var wrap = $("canvasWrap");
  if (!wrap) return;
  wrap.addEventListener("mousemove", function(e: MouseEvent){
    var target = e.target as HTMLElement | null;
    var el = target && target.closest ? (target.closest("[data-addr]") as HTMLElement) : null;
    var addr = el ? el.dataset.addr : null;
    var r = addr && state.model ? state.model.byAddr[addr] : null;
    var wants = hasPreview(r);

    if (!wants){ if (popAddr) hideRulePop(); clearTimeout(popTimer); return; }
    if (addr === popAddr) return;

    clearTimeout(popTimer);
    var x = e.clientX, y = e.clientY;
    popTimer = setTimeout(function(){ if (addr) showRulePop(addr, x, y); }, 280);
  });
  wrap.addEventListener("mouseleave", hideRulePop);
  wrap.addEventListener("pointerdown", hideRulePop);
  wrap.addEventListener("scroll", hideRulePop);
})();

export { popEl, popRow, popRuleLines, showRulePop, hideRulePop };

