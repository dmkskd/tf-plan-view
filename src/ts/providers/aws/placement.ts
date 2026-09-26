// providers/aws/placement.ts — AWS VPC, Subnet, and Security Group container hierarchy
import { mkGroup } from "../../core/tree.js";
import { LayoutContext, LayoutGroup, PlanResource } from "../../types/index.js";

function vpcOf(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  for (var i = 0; i < r.refs.length; i++){
    if (ctx.vpcGroups[r.refs[i]]) return ctx.vpcGroups[r.refs[i]];
  }
  return null;
}

function subnetOf(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  for (var i = 0; i < r.refs.length; i++){
    if (ctx.subnetGroups[r.refs[i]]) return ctx.subnetGroups[r.refs[i]];
  }
  return null;
}

function placeVpcs(ctx: LayoutContext): void {
  ctx.vis.forEach(function(r: PlanResource){
    if (r.type !== "aws_vpc") return;
    var g = mkGroup("vpc", "VPC " + r.name, (r.attrs && r.attrs.cidr_block) || "cidr unknown", 1200);
    g.res = r;
    ctx.vpcGroups[r.addr] = g;
    ctx.region.children.push(g);
  });
}

/* Subnets nest in an availability-zone group inside their VPC. */
function placeSubnets(ctx: LayoutContext): void {
  ctx.vis.forEach(function(r: PlanResource){
    if (r.type !== "aws_subnet") return;
    var parentVpc = vpcOf(ctx, r) || ctx.region;
    var az = (r.attrs && r.attrs.availability_zone) || "availability zone unresolved";
    var key = (parentVpc.label || "") + "|" + az;
    if (!ctx.azGroups[key]){
      ctx.azGroups[key] = mkGroup("az", "Availability Zone", az, 1100);
      parentVpc.children.push(ctx.azGroups[key]);
    }
    var isPublic = !!(r.attrs && r.attrs.map_public_ip_on_launch === true);
    var g = mkGroup("subnet", (isPublic ? "Public subnet " : "Subnet ") + r.name,
                    (r.attrs && r.attrs.cidr_block) || "cidr unknown", 620);
    if (!isPublic) g.cls = "subnet private";
    g.res = r;
    ctx.subnetGroups[r.addr] = g;
    ctx.azGroups[key].children.push(g);
  });
}

/* A security group is drawn as a dashed boundary around the resources
   that reference it. Another SG referencing it is a rule source, not a
   member, so security groups never nest in each other. */
function placeSecurityGroups(ctx: LayoutContext): void {
  var sgRes: Record<string, PlanResource> = {}, members: Record<string, PlanResource[]> = {};
  ctx.vis.forEach(function(r: PlanResource){ if (r.type === "aws_security_group") sgRes[r.addr] = r; });
  ctx.vis.forEach(function(r: PlanResource){
    if (r.type === "aws_security_group") return;
    r.refs.forEach(function(a: string){
      if (!sgRes[a]) return;
      (members[a] = members[a] || []).push(r);
      if (!ctx.ownerOf[r.addr]) ctx.ownerOf[r.addr] = a;
    });
  });

  Object.keys(sgRes).forEach(function(a: string){
    var mem = members[a] || [];
    if (!mem.length) return;                       /* empty SG stays a tile */
    var r = sgRes[a];
    var g = mkGroup("sg", "Security group " + r.name, "", 620);
    g.res = r;
    ctx.sgGroups[a] = g;
    var host = subnetOf(ctx, mem[0]) || vpcOf(ctx, mem[0]) || vpcOf(ctx, r);
    (host || ctx.region).children.push(g);
  });
}

function placeAwsContainers(ctx: LayoutContext): void {
  placeVpcs(ctx);
  placeSubnets(ctx);
  placeSecurityGroups(ctx);
}

function containerOfAws(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  var own = ctx.ownerOf[r.addr];
  if (own && ctx.sgGroups[own]) return ctx.sgGroups[own];
  var scope = r.spec && r.spec.scope;
  var sg = (scope === "vpc") ? null : subnetOf(ctx, r);
  if (sg) return sg;
  var vg = vpcOf(ctx, r);
  if (vg) return vg;
  return null;
}

function isBoundaryAws(ctx: LayoutContext, r: PlanResource): boolean {
  return r.type === "aws_security_group" && !!ctx.sgGroups[r.addr];
}

export {
  vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups,
  placeAwsContainers, containerOfAws, isBoundaryAws
};

