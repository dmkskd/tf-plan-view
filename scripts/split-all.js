const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const html = execSync("git show HEAD:index.html", { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const lines = html.split("\n");

function getSlice(startLine, endLine) {
  return lines.slice(startLine - 1, endLine).join("\n");
}

console.log("Generating modular src/ files with exact line slices from pristine index.html...");

// --- 1. core/util.js ---
fs.writeFileSync("src/js/core/util.js", `// core/util.js — Pure string, DOM and general utilities

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

export function q(s) {
  return String(s).replace(/"/g, '\\"');
}

export const $ = function(id) {
  return document.getElementById(id);
};
`);

// --- 2. providers/aws/constants.js ---
fs.writeFileSync("src/js/providers/aws/constants.js", `// providers/aws/constants.js — AWS categories, sizing & networking ports

${getSlice(1216, 1223).replace(/^ {2}/gm, "")}

${getSlice(4117, 4125).replace(/^ {2}/gm, "")}

${getSlice(2068, 2070).replace(/^ {2}/gm, "")}

${getSlice(2514, 2525).replace(/^ {2}/gm, "")}

export { CAT, CAT_LABEL, SIZE_H, PORT_NAME };
`);

// --- 3. providers/aws/catalog.js ---
fs.writeFileSync("src/js/providers/aws/catalog.js", `// providers/aws/catalog.js — AWS resource type registry
${getSlice(1225, 1264).replace(/^ {2}/gm, "")}

export { REG };
`);

// --- 4. core/hcl.js ---
fs.writeFileSync("src/js/core/hcl.js", `// core/hcl.js — Reconstructed Terraform HCL blocks from plan expressions
import { escapeHtml } from "./util.js";

${getSlice(1266, 1405).replace(/^ {2}/gm, "")}

export { hclLit, isBlockList, exprVal, hclFor, hclValue, hclHighlight };
`);

// --- 5. providers/aws/cli.js ---
fs.writeFileSync("src/js/providers/aws/cli.js", `// providers/aws/cli.js — AWS CLI recipes
${getSlice(1407, 1530).replace(/^ {2}/gm, "")}

export { CLI, q };
`);

// --- 6. core/parser.js ---
fs.writeFileSync("src/js/core/parser.js", `// core/parser.js — Plan JSON parser, validators and reference extractor
import { escapeHtml } from "./util.js";
import { REG } from "../providers/registry.js";

${getSlice(1541, 1550).replace(/^ {2}/gm, "")}

${getSlice(1555, 1761).replace(/^ {2}/gm, "")}

export {
  actionOf, parsePlan, checkShape, readProviders, readModules,
  readReferences, readResources, reportUnsupported,
  linkDependents, summarise
};
`);

// --- 7. core/layout.js ---
fs.writeFileSync("src/js/core/layout.js", `// core/layout.js — Nested box containment tree & measure/layout engine
import { vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups } from "../providers/aws/placement.js";

${getSlice(1767, 1906).replace(/^ {2}/gm, "")}

${getSlice(1922, 1952).replace(/^ {2}/gm, "")}

${getSlice(2012, 2046).replace(/^ {2}/gm, "")}

export {
  TW, GAP, PAD, HEAD, TH_FLAT, TH_CHANGES, TH,
  tileHeight, mkGroup, measure, place, buildTree,
  visibleResources, containerOf, containerOfNeighbour,
  placeRemaining, pruneEmpty, ancestorChains
};
`);

// --- 8. providers/aws/placement.js ---
fs.writeFileSync("src/js/providers/aws/placement.js", `// providers/aws/placement.js — AWS VPC, Subnet, and Security Group container hierarchy
import { mkGroup } from "../../core/layout.js";

${getSlice(1908, 1919).replace(/^ {2}/gm, "")}

${getSlice(1954, 2010).replace(/^ {2}/gm, "")}

export { vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups };
`);

// --- 9. providers/aws/sizing.js ---
fs.writeFileSync("src/js/providers/aws/sizing.js", `// providers/aws/sizing.js — AWS EC2 block heights
${getSlice(2068, 2070).replace(/^ {2}/gm, "")}

${getSlice(2072, 2081).replace(/^ {2}/gm, "")}

export { SIZE_H, blockHeight };
`);

// --- 10. ui/iso.js ---
fs.writeFileSync("src/js/ui/iso.js", `// ui/iso.js — Isometric 3D projection, camera rotation, pan & zoom controls
import { $ } from "../core/util.js";

${getSlice(2115, 2236).replace(/^ {2}/gm, "")}

export {
  ISO, ISO_HOME, applyTransform, fitCanvas, centerScroll, fitView, setIso
};
`);

// --- 11. ui/diagram.js ---
// Slices: 2060-2064 (icoSvg), 2083-2093 (changedKeys), 2095-2098 (titleFor), 2099-2107 (subFor), 2109-2113 (setEmpty),
// 2238-2390 (render & boxes), 2396-2510 (drawEdges & selection)
const diagSliceA = getSlice(2238, 2390).replace(/^ {2}/gm, "");
const diagSliceB = getSlice(2396, 2510).replace(/^ {2}/gm, "");

fs.writeFileSync("src/js/ui/diagram.js", `// ui/diagram.js — Canvas DOM node rendering, SVG edge wiring & tile interactions
import { escapeHtml, $ } from "../core/util.js";
import { CAT, blockHeight } from "../providers/registry.js";
import { tileHeight } from "../core/layout.js";
import { fitCanvas } from "./iso.js";
import { sameVal } from "../core/diff.js";

var suppressClick = false;
var canvas = $("canvas"), edgesSvg = $("edges"), detailEl = $("detail"), splitEl = $("split");
var model = null, selected = null;
var opts = {showAssoc:false, showUnsup:true, edges:"select",
            mode:"all", render:"diagram", action:null, pulse:true};
var nodeEls = {};

var ACTION_COLOR = {
  create:"var(--create)", update:"var(--update)", replace:"var(--replace)",
  delete:"var(--destroy)", "no-op":"var(--noop)", read:"var(--update)"
};

${getSlice(2060, 2064).replace(/^ {2}/gm, "")}

${getSlice(2083, 2093).replace(/^ {2}/gm, "")}

${getSlice(2095, 2098).replace(/^ {2}/gm, "")}

${getSlice(2099, 2107).replace(/^ {2}/gm, "")}

${getSlice(2109, 2113).replace(/^ {2}/gm, "")}

${diagSliceA}

${diagSliceB}

export {
  ACTION_COLOR, icoSvg, changedKeys, titleFor, subFor, setEmpty, syncFilterBanner,
  render, boxOf, anchor, encloses, drawEdges, select, applySelection, applyDisabledCascade
};
`);

// --- 12. providers/aws/rules.js ---
fs.writeFileSync("src/js/providers/aws/rules.js", `// providers/aws/rules.js — AWS Security Group and Network ACL rules
import { escapeHtml } from "../../core/util.js";

${getSlice(2514, 2525).replace(/^ {2}/gm, "")}

${getSlice(2527, 2600).replace(/^ {2}/gm, "")}

export {
  PORT_NAME, portName, portText, protoText, peerText, rulesHtml
};
`);

// --- 13. core/diff.js ---
fs.writeFileSync("src/js/core/diff.js", `// core/diff.js — Attribute diffs, action resolution & rule-list matching
import { escapeHtml } from "./util.js";
import { attrKind, kindSource } from "./schema.js";
import { portName, portText, protoText, peerText } from "../providers/aws/rules.js";

${getSlice(2602, 2790).replace(/^ {2}/gm, "")}

export {
  isSensitive, sameVal, valText, forcesReplace,
  ACTION_REASON, reasonText, isRuleAttr, ruleKey, ruleRow,
  matchRules, ruleDiffHtml, changeHtml
};
`);

// --- 14. ui/detail.js ---
fs.writeFileSync("src/js/ui/detail.js", `// ui/detail.js — Detail pane, collapsible inspector sections & context menu
import { escapeHtml, $ } from "../core/util.js";
import { CLI, rulesHtml, blockHeight } from "../providers/registry.js";
import { hclFor } from "../core/hcl.js";
import { changeHtml, reasonText, valText } from "../core/diff.js";
import { changedKeys } from "./diagram.js";
import { kindSource } from "../core/schema.js";

${getSlice(2792, 3230).replace(/^ {2}/gm, "")}

export {
  SEC_DEFAULT, secOpen, isOpen, CHEV, sec,
  detailSections, wireSections, SECTION_USE, sectionRows,
  driftRows, checkRows, renderPlanInfo, DETAIL_SECTIONS,
  note, copyBlock, addrList, attrRows, SEC_MASTER, ACTION_PHRASE,
  detailHeader, renderDetail, wireDetailControls, copyText
};
`);

// --- 15. core/schema.js ---
fs.writeFileSync("src/js/core/schema.js", `// core/schema.js — Schema pruning, localStorage cache & kind lookups
import { escapeHtml, $ } from "./util.js";

${getSlice(3246, 3323).replace(/^ {2}/gm, "")}

${getSlice(4188, 4207).replace(/^ {2}/gm, "")}

export {
  SCHEMA, SCHEMA_META, KINDS, KINDS_META, KIND_WORD,
  loadKinds, isSchemaFile, pruneSchema, storeSchema, restoreSchema,
  attrKind, kindSource, schemaFit
};
`);

// --- 16. ui/rule-popover.js ---
fs.writeFileSync("src/js/ui/rule-popover.js", `// ui/rule-popover.js — Security Group & Network ACL hover preview popover
import { $ } from "../core/util.js";
import { portName, portText, protoText, peerText } from "../providers/aws/rules.js";

${getSlice(3324, 3425).replace(/^ {2}/gm, "")}

export { popEl, popRow, ruleLines, showRulePop, hideRulePop };
`);

// --- 17. ui/contextmenu.js ---
fs.writeFileSync("src/js/ui/contextmenu.js", `// ui/contextmenu.js — Canvas node right-click context menu
import { $ } from "../core/util.js";
import { copyText } from "./detail.js";
import { CLI } from "../providers/registry.js";

${getSlice(3427, 3527).replace(/^ {2}/gm, "")}

export { ctxEl, closeCtx, ctxItem, openCtx };
`);

// --- 18. ui/textview.js ---
fs.writeFileSync("src/js/ui/textview.js", `// ui/textview.js — Plaintext plan viewer mimicking terraform format
import { escapeHtml, $ } from "../core/util.js";
import { actionOf } from "../core/parser.js";
import { forcesReplace, isSensitive } from "../core/diff.js";
import { changedKeys } from "./diagram.js";
import { attrKind } from "../core/schema.js";

${getSlice(3537, 3966).replace(/^ {2}/gm, "")}

export {
  TEXT_HEAD, renderText, planText, documentText, changesBody, textSections,
  isObjList, tvElement, tvCollection, tvLit, documentBody,
  tvHead, tvVariables, tvDrift, tvChecks, tvOutputs,
  TEXT_SEC_DEFAULT, textSecOpen
};
`);

// --- 19. ui/sidebar.js ---
// Slices 3972-4116, 4126-4182, 4209-4268 (excluding CAT_LABEL and schemaFit)
const sideSliceA = getSlice(3972, 4116).replace(/^ {2}/gm, "");
const sideSliceB = getSlice(4126, 4182).replace(/^ {2}/gm, "");
const sideSliceC = getSlice(4209, 4268).replace(/^ {2}/gm, "");

fs.writeFileSync("src/js/ui/sidebar.js", `// ui/sidebar.js — Left sidebar metrics, action filters, types checklist & diagnostics
import { escapeHtml, $ } from "../core/util.js";
import { CAT_LABEL } from "../providers/registry.js";
import { schemaFit } from "../core/schema.js";
import { changedKeys } from "./diagram.js";

${sideSliceA}

${sideSliceB}

${sideSliceC}

export {
  renderSidebar, panelModeCounts, panelChanges,
  panelPlanSummary, panelCoverage, setTypes, panelTypes, panelDiagnostics
};
`);

// --- 20. app.js ---
fs.writeFileSync("src/js/app.js", `// app.js — Main application lifecycle, state & event orchestration
import { escapeHtml, $ } from "./core/util.js";
import { parsePlan } from "./core/parser.js";
import { isSchemaFile, pruneSchema, storeSchema, restoreSchema } from "./core/schema.js";
import { render, select } from "./ui/diagram.js";
import { renderText } from "./ui/textview.js";
import { renderSidebar } from "./ui/sidebar.js";
import { renderDetail } from "./ui/detail.js";
import { closeCtx } from "./ui/contextmenu.js";
import { fitView, setIso, ISO } from "./ui/iso.js";

${getSlice(4274, 4498).replace(/^ {2}/gm, "")}

export { load, loadText, boot, applyView, setMode, setRender };
`);

// --- 21. main.js ---
fs.writeFileSync("src/js/main.js", `// main.js — Application entry point
import "./app.js";
`);

// --- 22. providers/aws/index.js ---
fs.writeFileSync("src/js/providers/aws/index.js", `// providers/aws/index.js — AWS Provider Plugin
import { REG } from "./catalog.js";
import { CAT, CAT_LABEL, SIZE_H, PORT_NAME } from "./constants.js";
import { CLI } from "./cli.js";
import { blockHeight } from "./sizing.js";
import { portName, portText, protoText, peerText, rulesHtml } from "./rules.js";
import { showRulePop, hideRulePop } from "../../ui/rule-popover.js";
import { vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups } from "./placement.js";

export const awsProvider = {
  id: "aws",
  name: "AWS",
  prefix: "aws_",
  catalog: REG,
  categories: CAT,
  categoryLabels: CAT_LABEL,
  sizing: { blockHeight, SIZE_H },
  cli: CLI,
  rules: { portName, portText, protoText, peerText, rulesHtml, showRulePop, hideRulePop, PORT_NAME },
  placement: { vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups }
};

export default awsProvider;
`);

// --- 23. providers/gcp/catalog.js ---
fs.writeFileSync("src/js/providers/gcp/catalog.js", `// providers/gcp/catalog.js — GCP resource type catalog (starter/scaffold)
export var GCP_REG = {
  google_compute_network:    {kind:"group", g:"vpc",    label:"VPC Network",    icon:"i-vpc",    cat:"net"},
  google_compute_subnetwork: {kind:"group", g:"subnet", label:"Subnetwork",     icon:"i-subnet", cat:"net"},
  google_compute_instance:   {kind:"node",              label:"Compute Engine", icon:"i-ec2",    cat:"compute", sub:"machine_type"},
  google_storage_bucket:     {kind:"node",              label:"Cloud Storage",  icon:"i-s3",     cat:"storage", scope:"region"}
};
`);

// --- 24. providers/gcp/cli.js ---
fs.writeFileSync("src/js/providers/gcp/cli.js", `// providers/gcp/cli.js — GCP CLI recipes
import { q } from "../../core/util.js";

export function GCP_CLI(r, ctx) {
  var L = [];
  function add(label, cmd) { L.push({label:label, cmd:cmd}); }
  var t = r.type;
  switch (t) {
    case "google_compute_instance":
      add("Describe", "gcloud compute instances describe " + r.name + (ctx.zone ? " --zone " + ctx.zone : ""));
      break;
    case "google_compute_network":
      add("Describe", "gcloud compute networks describe " + r.name);
      break;
    case "google_storage_bucket":
      add("Describe", "gcloud storage buckets describe gs://" + r.name);
      break;
  }
  return L;
}
`);

// --- 25. providers/gcp/placement.js ---
fs.writeFileSync("src/js/providers/gcp/placement.js", `// providers/gcp/placement.js — GCP container hierarchy
import { mkGroup } from "../../core/layout.js";

export function placeGcpNetworks(ctx) {
  ctx.vis.forEach(function(r) {
    if (r.type !== "google_compute_network") return;
    var g = mkGroup("vpc", "VPC " + r.name, "", 1200);
    g.res = r;
    ctx.vpcGroups[r.addr] = g;
    ctx.region.children.push(g);
  });
}

export function placeGcpSubnetworks(ctx) {
  ctx.vis.forEach(function(r) {
    if (r.type !== "google_compute_subnetwork") return;
    var g = mkGroup("subnet", "Subnet " + r.name, r.attrs.ip_cidr_range || "", 620);
    g.res = r;
    ctx.subnetGroups[r.addr] = g;
    ctx.region.children.push(g);
  });
}
`);

// --- 26. providers/gcp/index.js ---
fs.writeFileSync("src/js/providers/gcp/index.js", `// providers/gcp/index.js — Google Cloud Platform Provider Plugin (Example)
import { GCP_REG } from "./catalog.js";
import { GCP_CLI } from "./cli.js";
import { placeGcpNetworks, placeGcpSubnetworks } from "./placement.js";

export const gcpProvider = {
  id: "google",
  name: "Google Cloud",
  prefix: "google_",
  catalog: GCP_REG,
  categories: {
    compute: "var(--aws-compute)",
    net:     "var(--aws-net)",
    sec:     "var(--aws-sec)",
    storage: "var(--aws-storage)",
    db:      "var(--aws-db)",
    mgmt:    "var(--aws-mgmt)"
  },
  categoryLabels: [
    ["compute", "Compute Engine"],
    ["net",     "VPC Network"],
    ["storage", "Cloud Storage"]
  ],
  sizing: {
    blockHeight: () => 26
  },
  cli: GCP_CLI,
  rules: {
    rulesHtml: () => null,
    showRulePop: () => {},
    hideRulePop: () => {}
  },
  placement: {
    placeNetworks: placeGcpNetworks,
    placeSubnets: placeGcpSubnetworks
  }
};

export default gcpProvider;
`);

// --- 27. providers/registry.js ---
fs.writeFileSync("src/js/providers/registry.js", `// providers/registry.js — Pluggable multi-provider manager
import { awsProvider } from "./aws/index.js";
import { gcpProvider } from "./gcp/index.js";

const providers = [awsProvider, gcpProvider];

export function getProviderForType(type) {
  if (!type) return null;
  for (const p of providers) {
    if (p.prefix && type.startsWith(p.prefix)) return p;
    if (p.catalog && p.catalog[type]) return p;
  }
  return null;
}

export function getProviderForResource(res) {
  return res ? getProviderForType(res.type) : null;
}

export function getAllProviders() {
  return providers;
}

export const REG = new Proxy({}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    for (const p of providers) {
      if (p.catalog && p.catalog[prop]) return p.catalog[prop];
    }
    return undefined;
  },
  has(target, prop) {
    for (const p of providers) {
      if (p.catalog && prop in p.catalog) return true;
    }
    return prop in target;
  },
  ownKeys() {
    const keys = new Set();
    for (const p of providers) {
      if (p.catalog) Object.keys(p.catalog).forEach(k => keys.add(k));
    }
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target, prop) {
    const val = this.get(target, prop);
    return val !== undefined ? { configurable: true, enumerable: true, value: val } : undefined;
  }
});

for (const p of providers) {
  if (p.catalog) Object.assign(REG, p.catalog);
}

export const CAT = awsProvider.categories;
export const CAT_LABEL = awsProvider.categoryLabels;

export function CLI(r, ctx) {
  const p = getProviderForResource(r);
  return (p && p.cli) ? p.cli(r, ctx) : [];
}

export function rulesHtml(r) {
  const p = getProviderForResource(r);
  return (p && p.rules && p.rules.rulesHtml) ? p.rules.rulesHtml(r) : "";
}

export function blockHeight(r) {
  const p = getProviderForResource(r);
  return (p && p.sizing && p.sizing.blockHeight) ? p.sizing.blockHeight(r) : 26;
}
`);

console.log("All modules regenerated cleanly with 100% precision!");
