// providers/aws/placement.ts — AWS VPC, Subnet, and Security Group container hierarchy
import { mkGroup } from "../../core/tree.js";
import { LayoutContext, LayoutGroup, PlanResource } from "../../types/index.js";

/* A splat reference (aws_subnet.private[*].id) collapses to the base
   address ("aws_subnet.private") with no [N] — but the group map is keyed
   per-instance ("aws_subnet.private[0]"). Match every instance sharing that
   base address, not just the first: a resource that genuinely spans more
   than one (an ASG's vpc_zone_identifier across two AZs, say) has no single
   correct subnet to sit in, and should say so rather than pick one
   arbitrarily — the caller nests it only when exactly one match is found.

   Terraform's own references list is not this clean, though: a single,
   specific reference like aws_subnet.public[0].id comes with the base
   address ("aws_subnet.public") ALSO listed alongside the specific one
   ("aws_subnet.public[0]") in the same references array — not because it
   spans every instance, just because Terraform lists a referenced object at
   several levels of specificity. Treating that bare base form as a genuine
   splat would make an ordinary single-instance reference look ambiguous
   across every instance sharing its base address. So: a specific reference
   always wins, and its base form is ignored as the redundant, coarser
   mention it is — only a base address with no accompanying specific one is
   treated as a real splat. */
function resolveMatches(map: Record<string, LayoutGroup>, refs: string[]): LayoutGroup[] {
  var found: LayoutGroup[] = [];
  function add(g: LayoutGroup){ if (found.indexOf(g) < 0) found.push(g); }
  var specificBases: Record<string, boolean> = {};
  refs.forEach(function(ref: string){
    if (map[ref] && /\[[^\]]*\]$/.test(ref)) specificBases[ref.replace(/\[[^\]]*\]$/, "")] = true;
  });
  refs.forEach(function(ref: string){
    if (map[ref]){ add(map[ref]); return; }
    if (specificBases[ref]) return;
    var prefix = ref + "[";
    for (var k in map){ if (k.indexOf(prefix) === 0) add(map[k]); }
  });
  return found;
}

function resolveUnambiguous(map: Record<string, LayoutGroup>, refs: string[]): LayoutGroup | null {
  var found = resolveMatches(map, refs);
  return found.length === 1 ? found[0] : null;
}

function vpcOf(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  var direct = resolveUnambiguous(ctx.vpcGroups, r.refs);
  if (direct) return direct;
  var subnetVpcs = ctx.subnetVpcGroups || {};
  var matches = resolveMatches(ctx.subnetGroups, r.refs);
  if (!matches.length) return null;
  var vpc = matches[0].res && subnetVpcs[matches[0].res.addr];
  return vpc && matches.every(function(g: LayoutGroup){
    return !!g.res && subnetVpcs[g.res.addr] === vpc;
  }) ? vpc : null;
}

function subnetOf(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  return resolveUnambiguous(ctx.subnetGroups, r.refs);
}

/* AZs are location boxes; resources spanning AZs belong in a separate row
   within their VPC, not beside the AZs as if they were another location. */
function vpcWideOf(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  var vpc = vpcOf(ctx, r);
  if (!vpc || !vpc.res) return null;
  var sections = ctx.vpcWideGroups || (ctx.vpcWideGroups = {});
  var section = sections[vpc.res.addr];
  if (!section){
    section = mkGroup("vpc-wide", "VPC-wide", "spans or sits outside AZs", 2600);
    section.breakBefore = true;
    sections[vpc.res.addr] = section;
    vpc.children.push(section);
  }
  return section;
}

function placeVpcs(ctx: LayoutContext): void {
  ctx.vis.forEach(function(r: PlanResource){
    if (r.type !== "aws_vpc") return;
    /* Wide enough that multiple AZ columns actually sit side by side (the
       real convention in AWS's own diagrams) instead of only fitting one
       per row and stacking regardless. A single VPC box on an otherwise
       empty row is never clipped even if it exceeds this. */
    var g = mkGroup("vpc", "VPC " + r.name, (r.attrs && r.attrs.cidr_block) || "cidr unknown", 2600);
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
      /* stack:true — an AZ's subnets stack vertically in a fixed order,
         deliberately, not to save space: the same subnet role then lands
         on the same row in every AZ column, so columns stay comparable. */
      ctx.azGroups[key] = mkGroup("az", "Availability Zone", az, 1100, true);
      parentVpc.children.push(ctx.azGroups[key]);
    }
    var isPublic = !!(r.attrs && r.attrs.map_public_ip_on_launch === true);
    var g = mkGroup("subnet", (isPublic ? "Public subnet " : "Subnet ") + r.name,
                    (r.attrs && r.attrs.cidr_block) || "cidr unknown", 620);
    if (!isPublic) g.cls = "subnet private";
    g.res = r;
    ctx.subnetGroups[r.addr] = g;
    (ctx.subnetVpcGroups || (ctx.subnetVpcGroups = {}))[r.addr] = parentVpc;
    ctx.azGroups[key].children.push(g);
  });
}

/* Where a resource would sit if security-group membership didn't exist:
   its own subnet, or VPC, or nothing. Security-group placement is built on
   top of this, never the other way round — a member's real location always
   comes from its own reference, never from a sibling it happens to share
   an SG with. */
function networkContainerAws(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  var scope = r.spec && r.spec.scope;
  if (scope === "vpc") return vpcWideOf(ctx, r);
  return subnetOf(ctx, r) || vpcWideOf(ctx, r);
}

/* A security group is drawn as a dashed boundary — but it has no location
   of its own, only whatever its members' real locations are, and members
   can genuinely be scattered (an instance in a subnet, a launch template
   with no subnet at all). So the boundary is drawn once per distinct
   container its members actually landed in, not once for the whole group:
   two members in the same subnet share one boundary there; a member with
   no resolvable location of its own gets its own boundary at the VPC level
   rather than borrowing a sibling's. An SG with no members at all is left
   as a plain tile (containerOfAws places it by its own vpc_id). Another SG
   referencing it is a rule source, not a member, so SGs never nest in
   each other. */
function placeSecurityGroups(ctx: LayoutContext): void {
  var sgRes: Record<string, PlanResource> = {};
  ctx.vis.forEach(function(r: PlanResource){ if (r.type === "aws_security_group") sgRes[r.addr] = r; });

  /* sgAddr -> container -> members in that container */
  var byContainer: Record<string, Map<LayoutGroup, PlanResource[]>> = {};
  /* ctx.ownerOf isn't written until the second pass below, so it reads as
     unset for every resource throughout this whole pass — checking it here
     was never actually excluding anything. This pass's own claimed-by
     tracker is what makes "first SG referenced wins" real. */
  var claimed: Record<string, boolean> = {};
  ctx.vis.forEach(function(r: PlanResource){
    /* A launch template or subnet group can refer to an SG in configuration,
       but the SG protects the resulting network interfaces, not that object. */
    if (r.type !== "aws_instance" && r.type !== "aws_lb" &&
        r.type !== "aws_alb" && r.type !== "aws_db_instance" &&
        r.type !== "aws_rds_cluster" && r.type !== "aws_vpc_endpoint" &&
        r.type !== "aws_lambda_function") return;
    r.refs.forEach(function(a: string){
      if (!sgRes[a] || claimed[r.addr]) return;   /* first SG referenced wins */
      claimed[r.addr] = true;
      /* A member ambiguous even on its own (an ALB spanning two subnets, say)
         still falls back to the SG's own VPC, never all the way out to
         Region — it's genuinely still somewhere inside this VPC. */
      var container = networkContainerAws(ctx, r) || vpcWideOf(ctx, sgRes[a]) || ctx.region;
      var forSg = byContainer[a] || (byContainer[a] = new Map());
      (forSg.get(container) || forSg.set(container, []).get(container)!).push(r);
    });
  });

  Object.keys(sgRes).forEach(function(a: string){
    var byC = byContainer[a];
    if (!byC || !byC.size) return;                  /* empty SG stays a tile */
    var r = sgRes[a];
    var boxes: LayoutGroup[] = [];
    ctx.sgGroups[a] = boxes;
    byC.forEach(function(mem: PlanResource[], container: LayoutGroup){
      var g = mkGroup("sg", "Security group " + r.name, "", 620);
      g.res = r;
      boxes.push(g);
      container.children.push(g);
      mem.forEach(function(m: PlanResource){ ctx.ownerOf[m.addr] = g; });
    });
  });
}

/* An EKS cluster with managed node groups is drawn as a container around its
   node groups. If a cluster has no node groups (e.g. Fargate only or unmanaged),
   it stays as an ordinary tile. */
function placeEksClusters(ctx: LayoutContext): void {
  var clusterRes: Record<string, PlanResource> = {};
  var clusterByName: Record<string, PlanResource> = {};
  ctx.vis.forEach(function(r: PlanResource){
    if (r.type === "aws_eks_cluster") {
      clusterRes[r.addr] = r;
      if (r.attrs && r.attrs.name) clusterByName[r.attrs.name] = r;
      clusterByName[r.name] = r;
    }
  });

  var clusterGroups: Record<string, LayoutGroup> = (ctx as any).clusterGroups || ((ctx as any).clusterGroups = {});

  Object.keys(clusterRes).forEach(function(addr: string){
    var cRes = clusterRes[addr];
    var nodeGroups: PlanResource[] = [];

    ctx.vis.forEach(function(r: PlanResource){
      if (r.type !== "aws_eks_node_group") return;
      var cName = (r.attrs && r.attrs.cluster_name) || "";
      var match = (cName && clusterByName[cName] === cRes) ||
                  r.refs.indexOf(cRes.addr) >= 0 ||
                  r.refs.indexOf(cRes.type + "." + cRes.name) >= 0;
      if (match) nodeGroups.push(r);
    });

    if (!nodeGroups.length) return; /* empty cluster stays a tile */

    var version = (cRes.attrs && cRes.attrs.version) || "";
    var sub = version ? "k8s " + version : "";
    var g = mkGroup("cluster eks", "EKS Cluster " + cRes.name, sub, 760);
    g.res = cRes;
    clusterGroups[addr] = g;

    var parent = networkContainerAws(ctx, cRes) || vpcWideOf(ctx, cRes) || ctx.region;
    parent.children.push(g);

    nodeGroups.forEach(function(ng: PlanResource){
      ctx.ownerOf[ng.addr] = g;
    });
  });
}

function placeAwsContainers(ctx: LayoutContext): void {
  placeVpcs(ctx);
  placeSubnets(ctx);
  placeSecurityGroups(ctx);
  placeEksClusters(ctx);
}

function containerOfAws(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
  var own = ctx.ownerOf[r.addr];
  if (own) return own;
  return networkContainerAws(ctx, r);
}

function isBoundaryAws(ctx: LayoutContext, r: PlanResource): boolean {
  var boxes = ctx.sgGroups[r.addr];
  if (r.type === "aws_security_group" && !!boxes && boxes.length > 0) return true;
  var clusterGroups = (ctx as any).clusterGroups;
  if (r.type === "aws_eks_cluster" && clusterGroups && clusterGroups[r.addr]) return true;
  return false;
}

export {
  vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups,
  placeAwsContainers, containerOfAws, isBoundaryAws
};
