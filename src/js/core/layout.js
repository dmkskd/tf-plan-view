// core/layout.js — Nested box containment tree & measure/layout engine
import {
  placeAllContainers, containerOfResource, isContainerBoundary,
  getCloudRootLabel
} from "../providers/registry.js";
import { mkGroup } from "./tree.js";

var TW = 178, GAP = 10, PAD = 14, HEAD = 26;
var TH_FLAT = 66, TH_CHANGES = 88;      /* the Changes tile carries a diff line */
var TH = TH_FLAT;

function setTileHeight(h){ TH = h; }

/* The taller tile only earns its space when there are diffs to print. */
function tileHeight(mode, hasEdits){
  return (mode === "changes" && hasEdits) ? TH_CHANGES : TH_FLAT;
}

function measure(g){
  if (!g.box){ g.w = TW; g.h = TH; return g; }
  g.children.forEach(measure);
  var kids = g.children.slice().sort(function(a,b){
    if (a.box !== b.box) return a.box ? -1 : 1;
    return 0;
  });
  /* a group of plain tiles packs to a near-square grid so rows do not end
     half empty; mixed or stacked groups wrap on width. */
  var allLeaves = kids.length > 0 && kids.every(function(k){ return !k.box; });
  var perRow = Infinity;
  if (g.stack) perRow = 1;
  else if (allLeaves){
    var fit = Math.max(1, Math.floor((g.maxW + GAP) / (TW + GAP)));
    perRow = Math.min(fit, Math.ceil(Math.sqrt(kids.length)));
  }

  var rows = [], cur = [], curW = 0;
  function flush(){ if (cur.length){ rows.push({items:cur, w:curW}); cur = []; curW = 0; } }
  kids.forEach(function(k){
    if (k.box){ flush(); rows.push({items:[k], w:k.w}); return; }  /* boxes get their own row */
    var add = (cur.length ? GAP : 0) + k.w;
    if (cur.length >= perRow || (cur.length && curW + add > g.maxW)) flush();
    cur.push(k); curW += (cur.length > 1 ? GAP : 0) + k.w;
  });
  flush();
  g._rows = rows;

  var innerW = 0, innerH = 0;
  rows.forEach(function(r, i){
    innerW = Math.max(innerW, r.w);
    var rh = 0; r.items.forEach(function(k){ rh = Math.max(rh, k.h); });
    r.h = rh;
    innerH += rh + (i ? GAP : 0);
  });
  var labelW = (g.label.length * 7.4) + (g.meta ? g.meta.length * 6.2 + 8 : 0) + 30;
  /* whole pixels: fractional widths give sub-pixel borders and blurry edges */
  g.w = Math.ceil(Math.max(innerW, labelW, 120)) + PAD*2;
  g.h = innerH + HEAD + PAD;
  if (!kids.length) g.h = HEAD + 22;
  return g;
}

function place(g, x, y){
  g.x = x; g.y = y;
  if (!g.box) return;
  var cy = y + HEAD;
  (g._rows || []).forEach(function(r){
    var cx = x + PAD;
    r.items.forEach(function(k){
      place(k, cx, cy);
      cx += k.w + GAP;
    });
    cy += r.h + GAP;
  });
}

/* ------------------------------------------------------------------
   Containment tree.

   Placement runs in passes, outermost first, because each pass needs
   the groups the previous one created. To support a new container
   type, add a pass here and mark the type kind:"group" in REG.
   ------------------------------------------------------------------ */

function buildTree(model, opts){
  var ctx = {
    vis: visibleResources(model, opts),
    opts: opts,
    vpcGroups: {}, azGroups: {}, subnetGroups: {}, sgGroups: {}, ownerOf: {},
    referrers: {}, byAddr: {}
  };

  /* reverse index of expressions[*].references, for resources that name no
     container themselves — aws_eip is referenced by aws_nat_gateway, never
     the other way round */
  ctx.vis.forEach(function(r){
    ctx.byAddr[r.addr] = r;
    (r.refs || []).forEach(function(ref){
      (ctx.referrers[ref] || (ctx.referrers[ref] = [])).push(r);
    });
  });

  /* reverse index of expressions[*].references, for resources that name no
     container themselves — aws_eip is referenced by aws_nat_gateway, never
     the other way round */
  ctx.vis.forEach(function(r){
    (r.refs || []).forEach(function(ref){
      (ctx.referrers[ref] || (ctx.referrers[ref] = [])).push(r);
    });
  });

  ctx.cloud  = mkGroup("cloud", getCloudRootLabel(model), "", 1500, true);
  ctx.region = mkGroup("region", "Region", model.region || "region not resolved", 1420);
  ctx.global = mkGroup("loose", "Global", "account-level", 760);
  ctx.unplaced = mkGroup("loose", "Unplaced", "no vpc or subnet reference", 760);
  ctx.cloud.children.push(ctx.region);

  placeAllContainers(ctx);
  placeRemaining(ctx);

  if (ctx.global.children.length) ctx.cloud.children.push(ctx.global);
  if (ctx.unplaced.children.length) ctx.cloud.children.push(ctx.unplaced);

  pruneEmpty(ctx.cloud, ctx.cloud, opts);
  measure(ctx.cloud);
  place(ctx.cloud, 0, 0);
  model.anc = ancestorChains(ctx.cloud);
  return ctx.cloud;
}

function visibleResources(model, opts){
  return model.resources.filter(function(r){
    if (r.hidden) return false;
    if (!r.enabledType) return false;
    if (r.kind === "assoc" && !opts.showAssoc) return false;
    if (!r.supported && !opts.showUnsup) return false;
    /* Changes shows the same diagram as Topology, with the plan marked on
       it. Hiding unchanged resources removed the context that makes the
       picture useful. Only an explicit action filter narrows it. */
    if (opts.action && r.kind !== "group" && r.action !== opts.action) return false;
    return true;
  });
}

function containerOf(ctx, r){
  var scope = r.spec && r.spec.scope;
  if (scope === "global") return ctx.global;
  if (scope === "region") return ctx.region;

  var c = containerOfResource(ctx, r);
  if (c) return c;

  if (scope === "vpc") return ctx.region;
  return null;
}

/* One hop along a reference edge, either direction: a resource naming no
   container of its own takes the container of a neighbour. aws_eip is
   reached from aws_nat_gateway, which references it;
   aws_iam_role_policy_attachment reaches aws_iam_role, which it references. */
function containerOfNeighbour(ctx, r){
  var hop = (r.refs || []).concat(
    (ctx.referrers[r.addr] || []).map(function(n){ return n.addr; }));
  for (var i = 0; i < hop.length; i++){
    var n = ctx.byAddr[hop[i]];
    if (!n || n === r) continue;
    var g = containerOf(ctx, n);
    if (g) return g;
  }
  return null;
}

function placeRemaining(ctx){
  ctx.vis.forEach(function(r){
    if (r.kind === "group" || r.type === "aws_vpc" || r.type === "aws_subnet") return;
    if (isContainerBoundary(ctx, r) || (r.type === "aws_security_group" && ctx.sgGroups[r.addr])) return;
    /* it did not become a boundary, so it is just a tile and the action
       filter applies to it like any other */
    if (ctx.opts.action && r.action !== ctx.opts.action) return;

    var leaf = {box:false, res:r};
    var g = containerOf(ctx, r) || containerOfNeighbour(ctx, r);
    (g || ctx.unplaced).children.push(leaf);
  });
}

/* A container kept only to host filtered-out children is noise. */
function pruneEmpty(g, root, opts){
  if (!g.box) return true;                         /* a tile is always kept */
  g.children = g.children.filter(function(k){ return pruneEmpty(k, root, opts); });
  if (g === root) return true;
  return g.children.length > 0 ||
         (g.res && g.res.action !== "no-op") ||
         opts.mode !== "changes";
}

/* An edge between a resource and something that already encloses it is
   redundant: the nesting says it. */
function ancestorChains(root){
  var anc = {};
  (function walk(g, chain){
    var next = chain;
    if (g.res){ anc[g.res.addr] = chain; next = chain.concat([g.res.addr]); }
    if (g.box) g.children.forEach(function(k){ walk(k, next); });
  })(root, []);
  return anc;
}

export {
  TW, GAP, PAD, HEAD, TH_FLAT, TH_CHANGES, TH, setTileHeight,
  tileHeight, mkGroup, measure, place, buildTree,
  visibleResources, containerOf, containerOfNeighbour,
  placeRemaining, pruneEmpty, ancestorChains
};
