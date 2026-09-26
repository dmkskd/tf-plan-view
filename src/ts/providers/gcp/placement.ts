// providers/gcp/placement.ts — GCP container hierarchy
import { mkGroup } from "../../core/tree.js";
import { LayoutContext, LayoutGroup, PlanResource } from "../../types/index.js";

function placeGcpNetworks(ctx: LayoutContext): void {
  ctx.vis.forEach(function(r: PlanResource) {
    if (r.type !== "google_compute_network") return;
    var g = mkGroup("vpc", "VPC " + r.name, "", 1200);
    g.res = r;
    ctx.vpcGroups[r.addr] = g;
    ctx.region.children.push(g);
  });
}

function placeGcpSubnetworks(ctx: LayoutContext): void {
  ctx.vis.forEach(function(r: PlanResource) {
    if (r.type !== "google_compute_subnetwork") return;
    var g = mkGroup("subnet", "Subnet " + r.name, (r.attrs && r.attrs.ip_cidr_range) || "", 620);
    g.res = r;
    ctx.subnetGroups[r.addr] = g;
    ctx.region.children.push(g);
  });
}

function placeGcpContainers(ctx: LayoutContext): void {
  placeGcpNetworks(ctx);
  placeGcpSubnetworks(ctx);
}

function containerOfGcp(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  for (var i = 0; i < (r.refs || []).length; i++) {
    var ref = r.refs[i];
    if (ctx.subnetGroups && ctx.subnetGroups[ref]) return ctx.subnetGroups[ref];
    if (ctx.vpcGroups && ctx.vpcGroups[ref]) return ctx.vpcGroups[ref];
  }
  return null;
}

export {
  placeGcpNetworks,
  placeGcpSubnetworks,
  placeGcpContainers,
  containerOfGcp
};

