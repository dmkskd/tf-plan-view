// test.js — unit tests for the parse and layout rules.
//
// WHAT IT CHECKS
//   Named assertions against hand-written minimal plans, so each rule is
//   pinned by intent rather than by recorded output. The check-*.js harnesses
//   stay as the regression net over the bundled plan; this file states what
//   the rules are supposed to do.
//
// HOW TO USE IT
//   node tools/test.js            all suites
//   node tools/test.js placement  only suites whose name contains "placement"
//   Exit code is non-zero on the first failing assertion count.

const { load } = require("./lib/app.js");
process.on("uncaughtException", e => { console.error(e); process.exit(1); });

const app = load();
const parsePlan = app.fn("parsePlan");
const buildTree = app.fn("buildTree");
const isSensitive = app.fn("isSensitive");
const baseAddr = app.fn("baseAddr");
const matchRules = app.fn("matchRules");

/* ---- runner ---------------------------------------------------------- */

const filter = process.argv[2] || "";
let pass = 0, fail = 0, suite = "";
const results = [];

function describe(name, fn) {
  if (filter && !name.includes(filter)) return;
  suite = name;
  fn();
}
function test(name, fn) {
  try { fn(); pass++; results.push(`  ok   ${name}`); }
  catch (e) { fail++; results.push(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what || "value"}: expected ${b}, got ${a}`);
}
function ok(cond, what) { if (!cond) throw new Error(what || "expected truthy"); }

/* ---- fixtures -------------------------------------------------------- */

// A plan is two parallel lists: resource_changes carries values and actions,
// configuration.root_module.resources carries the references. The helper
// keeps them in step so a fixture reads as one list of resources.
function plan(resources, extra) {
  const p = Object.assign({
    format_version: "1.2",
    terraform_version: "1.9.0",
    configuration: {
      provider_config: { aws: { name: "aws", expressions: { region: { constant_value: "eu-west-1" } } } },
      root_module: { resources: [] }
    },
    resource_changes: []
  }, extra || {});
  for (const r of resources) {
    const [type, name] = r.addr.split(".");
    p.resource_changes.push({
      address: r.addr, mode: "managed", type, name,
      change: {
        actions: r.actions || ["create"],
        before: r.before === undefined ? null : r.before,
        after: r.after || {},
        after_unknown: r.unknown || {},
        after_sensitive: r.sensitive || {}
      }
    });
    const expressions = {};
    for (const [k, refs] of Object.entries(r.refs || {})) expressions[k] = { references: refs };
    p.configuration.root_module.resources.push({
      address: r.addr, mode: "managed", type, name,
      expressions, depends_on: r.dependsOn || undefined
    });
  }
  return p;
}

const OPTS = { mode: "all", showAssoc: true, showUnsup: true, edges: "select" };

// Walks the built tree and returns addr -> label of the box holding the tile.
function placements(model, opts) {
  const tree = buildTree(model, Object.assign({}, OPTS, opts || {}));
  const where = {};
  (function walk(g, holder) {
    const label = g.box ? g.label + (g.meta ? " " + g.meta : "") : null;
    if (g.res) where[g.res.addr] = holder;
    if (g.box) g.children.forEach(k => walk(k, label));
  })(tree, "root");
  return where;
}
const built = (resources, opts) => placements(parsePlan(plan(resources), "t"), opts);

const VPC    = { addr: "aws_vpc.main", after: { cidr_block: "10.0.0.0/16" } };
const SUBNET = { addr: "aws_subnet.public", refs: { vpc_id: ["aws_vpc.main.id"] },
                 after: { availability_zone: "eu-west-1a", cidr_block: "10.0.1.0/24" } };

/* ---- suites ---------------------------------------------------------- */

describe("parse: shape and diagnostics", () => {
  test("a non-object is rejected with no resources", () => {
    const m = parsePlan("nope", "t");
    eq(m.resources.length, 0);
    eq(m.diagnostics[0].code, "not-json");
  });

  test("a state file falls back to planned_values", () => {
    const m = parsePlan({
      format_version: "1.0",
      values: { root_module: { resources: [] } },
      planned_values: { root_module: { resources: [
        { address: "aws_vpc.main", mode: "managed", type: "aws_vpc", name: "main", values: { cidr_block: "10.0.0.0/16" } }
      ] } }
    }, "t");
    eq(m.resources.length, 1);
    ok(m.diagnostics.some(d => d.code === "state-file"), "state-file diagnostic");
  });

  test("a non-aws provider is reported, not drawn", () => {
    const m = parsePlan(plan([{ addr: "google_compute_network.x" }]), "t");
    eq(m.resources[0].foreign, true);
    ok(m.diagnostics.some(d => d.code === "no-aws"), "no-aws diagnostic");
  });

  test("an unknown aws type is flagged unsupported, not dropped", () => {
    const m = parsePlan(plan([{ addr: "aws_quantum_thing.x" }]), "t");
    eq(m.resources[0].supported, false);
    ok(m.diagnostics.some(d => d.code === "unsupported"), "unsupported diagnostic");
  });
});

describe("parse: references", () => {
  test("a reference is truncated to type.name", () => {
    const m = parsePlan(plan([VPC, SUBNET]), "t");
    eq(m.byAddr["aws_subnet.public"].refs, ["aws_vpc.main"]);
  });

  test("var, local, each, count and data references are dropped", () => {
    const m = parsePlan(plan([{ addr: "aws_instance.web", refs: {
      tags: ["var.name_prefix"], ami: ["data.aws_ami.al2023.id"],
      count: ["count.index"], x: ["local.x"], y: ["each.key"]
    } }]), "t");
    eq(m.byAddr["aws_instance.web"].refs, []);
  });

  test("depends_on counts as a reference", () => {
    const m = parsePlan(plan([VPC, { addr: "aws_nat_gateway.n", dependsOn: ["aws_vpc.main"] }]), "t");
    eq(m.byAddr["aws_nat_gateway.n"].refs, ["aws_vpc.main"]);
  });

  test("a count/for_each instance resolves refs from its base config address", () => {
    // configuration.root_module.resources keys a counted resource by its base
    // address ("aws_subnet.public"); resource_changes carries the per-instance
    // address ("aws_subnet.public[0]"). The two must still line up.
    const p = plan([VPC]);
    p.resource_changes.push({
      address: "aws_subnet.public[0]", mode: "managed", type: "aws_subnet", name: "public",
      change: { actions: ["create"], before: null,
                after: { availability_zone: "eu-west-1a", cidr_block: "10.0.1.0/24" },
                after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_subnet.public", mode: "managed", type: "aws_subnet", name: "public",
      expressions: { vpc_id: { references: ["aws_vpc.main.id"] } }
    });
    const m = parsePlan(p, "t");
    eq(m.byAddr["aws_subnet.public[0]"].refs, ["aws_vpc.main"]);
  });

  test("a count/for_each instance's cfgByAddr lookup also uses the base address", () => {
    // ui/detail.js reconstructs the Terraform block from
    // model.cfgByAddr[baseAddr(r.addr)] — same base/instance mismatch as refs.
    const p = plan([VPC]);
    p.resource_changes.push({
      address: "aws_subnet.public[0]", mode: "managed", type: "aws_subnet", name: "public",
      change: { actions: ["create"], before: null,
                after: { availability_zone: "eu-west-1a", cidr_block: "10.0.1.0/24" },
                after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_subnet.public", mode: "managed", type: "aws_subnet", name: "public",
      expressions: { vpc_id: { references: ["aws_vpc.main.id"] } }
    });
    const m = parsePlan(p, "t");
    const r = m.byAddr["aws_subnet.public[0]"];
    ok(m.cfgByAddr[baseAddr(r.addr)], "cfgByAddr has an entry for the base address");
    eq(m.cfgByAddr[baseAddr(r.addr)].address, "aws_subnet.public");
  });
});

describe("parse: sensitive shape mirror", () => {
  test("a mirror masks when any leaf is true", () => {
    eq(isSensitive({ password: true }), true);
    eq(isSensitive([{ x: false }, { y: true }]), true);
    eq(isSensitive({ tags: { Name: false } }), false);
  });
});

describe("layout: placement", () => {

  test("a resource sits in the first subnet it references", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_instance.web", refs: { subnet_id: ["aws_subnet.public.id"] } }]);
    eq(where["aws_instance.web"], "Subnet public 10.0.1.0/24");
  });

  test("a resource referencing only the vpc sits in the VPC-wide section", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_internet_gateway.igw", refs: { vpc_id: ["aws_vpc.main.id"] } }]);
    eq(where["aws_internet_gateway.igw"], "VPC-wide spans or sits outside AZs");
  });

  test("a count/for_each subnet instance nests inside its vpc, not Unplaced", () => {
    const p = plan([VPC]);
    p.resource_changes.push({
      address: "aws_subnet.public[0]", mode: "managed", type: "aws_subnet", name: "public",
      change: { actions: ["create"], before: null,
                after: { availability_zone: "eu-west-1a", cidr_block: "10.0.1.0/24" },
                after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_subnet.public", mode: "managed", type: "aws_subnet", name: "public",
      expressions: { vpc_id: { references: ["aws_vpc.main.id"] } }
    });
    const where = placements(parsePlan(p, "t"));
    eq(where["aws_subnet.public[0]"], "Availability Zone eu-west-1a");
  });

  test("a splat reference to a counted subnet still resolves to an instance", () => {
    // aws_db_subnet_group.subnet_ids = aws_subnet.public[*].id collapses to
    // the base address ("aws_subnet.public") in expressions.references, with
    // no [N] — but subnetGroups is keyed per-instance ("aws_subnet.public[0]").
    const p = plan([VPC]);
    p.resource_changes.push({
      address: "aws_subnet.public[0]", mode: "managed", type: "aws_subnet", name: "public",
      change: { actions: ["create"], before: null,
                after: { availability_zone: "eu-west-1a", cidr_block: "10.0.1.0/24" },
                after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_subnet.public", mode: "managed", type: "aws_subnet", name: "public",
      expressions: { vpc_id: { references: ["aws_vpc.main.id"] } }
    });
    p.resource_changes.push({
      address: "aws_db_subnet_group.main", mode: "managed", type: "aws_db_subnet_group", name: "main",
      change: { actions: ["create"], before: null, after: {}, after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_db_subnet_group.main", mode: "managed", type: "aws_db_subnet_group", name: "main",
      expressions: { subnet_ids: { references: ["aws_subnet.public"] } }
    });
    const where = placements(parsePlan(p, "t"));
    eq(where["aws_db_subnet_group.main"], "Subnet public 10.0.1.0/24");
  });

  test("a specific instance reference isn't confused for a splat by its own redundant base form", () => {
    // Terraform's own references list for one ordinary reference like
    // aws_subnet.public[0].id includes BOTH the specific instance address
    // ("aws_subnet.public[0]") AND the bare base address ("aws_subnet.public")
    // in the same array — not because it spans every instance, just because
    // Terraform names the referenced object at several levels of
    // specificity. A second subnet instance existing elsewhere must not
    // make that base form look like a real splat across both.
    const p = plan([VPC]);
    ["aws_subnet.public[0]", "aws_subnet.public[1]"].forEach((addr, i) => {
      p.resource_changes.push({
        address: addr, mode: "managed", type: "aws_subnet", name: "public",
        change: { actions: ["create"], before: null,
                  after: { availability_zone: "eu-west-1" + (i ? "b" : "a"), cidr_block: "10.0." + i + ".0/24" },
                  after_unknown: {}, after_sensitive: {} }
      });
    });
    p.configuration.root_module.resources.push({
      address: "aws_subnet.public", mode: "managed", type: "aws_subnet", name: "public",
      expressions: { vpc_id: { references: ["aws_vpc.main.id"] } }
    });
    p.resource_changes.push({
      address: "aws_instance.web", mode: "managed", type: "aws_instance", name: "web",
      change: { actions: ["create"], before: null, after: {}, after_unknown: {}, after_sensitive: {} }
    });
    p.configuration.root_module.resources.push({
      address: "aws_instance.web", mode: "managed", type: "aws_instance", name: "web",
      expressions: { subnet_id: {
        references: ["aws_subnet.public[0].id", "aws_subnet.public[0]", "aws_subnet.public"] } }
    });
    const where = placements(parsePlan(p, "t"));
    eq(where["aws_instance.web"], "Subnet public 10.0.0.0/24");
  });

  test("an iam resource sits at account level whatever it references", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_iam_role.ssm", refs: { x: ["aws_subnet.public.id"] } }]);
    eq(where["aws_iam_role.ssm"], "Global account-level");
  });

  test("a resource referencing nothing placeable is drawn under Unplaced", () => {
    const where = built([VPC, SUBNET, { addr: "aws_eip.nat", after: { domain: "vpc" } }]);
    eq(where["aws_eip.nat"], "Unplaced no vpc or subnet reference");
  });

  test("one hop back along a reference places an otherwise unplaced resource", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_eip.nat", after: { domain: "vpc" } },
      { addr: "aws_nat_gateway.nat", refs: {
        allocation_id: ["aws_eip.nat.id"], subnet_id: ["aws_subnet.public.id"] } }]);
    eq(where["aws_eip.nat"], "Subnet public 10.0.1.0/24");
    eq(where["aws_nat_gateway.nat"], "Subnet public 10.0.1.0/24");
  });

  test("a security group becomes a boundary around what references it", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_security_group.web", refs: { vpc_id: ["aws_vpc.main.id"] } },
      { addr: "aws_instance.web", refs: {
        subnet_id: ["aws_subnet.public.id"], vpc_security_group_ids: ["aws_security_group.web.id"] } }]);
    eq(where["aws_instance.web"], "Security group web");
  });

  test("one security group shared across two subnets draws two boundaries, not one", () => {
    const SUBNET2 = { addr: "aws_subnet.private", refs: { vpc_id: ["aws_vpc.main.id"] },
                       after: { availability_zone: "eu-west-1b", cidr_block: "10.0.2.0/24" } };
    const model = parsePlan(plan([VPC, SUBNET, SUBNET2,
      { addr: "aws_security_group.web", refs: { vpc_id: ["aws_vpc.main.id"] } },
      { addr: "aws_instance.a", refs: {
        subnet_id: ["aws_subnet.public.id"], vpc_security_group_ids: ["aws_security_group.web.id"] } },
      { addr: "aws_instance.b", refs: {
        subnet_id: ["aws_subnet.private.id"], vpc_security_group_ids: ["aws_security_group.web.id"] } }]), "t");
    const tree = buildTree(model, OPTS);
    const sgBoxes = [];
    (function walk(g){ if (g.box){ if (g.cls === "sg") sgBoxes.push(g); g.children.forEach(walk); } })(tree);
    eq(sgBoxes.length, 2, "two separate Security group web boxes");
    const members = sgBoxes.map(g => g.children.map(c => c.res.addr).sort());
    eq(members.sort(), [["aws_instance.a"], ["aws_instance.b"]], "each boundary holds only its own subnet's member");
  });

  test("a resource referencing two security groups keeps the first one referenced, not the last one declared", () => {
    // sg1 is declared before sg2 in the plan (so sg2 is last-declared), but
    // the instance's own vpc_security_group_ids lists sg1 first (so sg1 is
    // first-referenced). Ownership must follow reference order — a bug that
    // instead picks whichever SG is processed last while building the boxes
    // would give sg2 here, not sg1.
    const where = built([VPC, SUBNET,
      { addr: "aws_security_group.sg1", refs: { vpc_id: ["aws_vpc.main.id"] } },
      { addr: "aws_security_group.sg2", refs: { vpc_id: ["aws_vpc.main.id"] } },
      { addr: "aws_instance.web", refs: {
        subnet_id: ["aws_subnet.public.id"],
        vpc_security_group_ids: ["aws_security_group.sg1.id", "aws_security_group.sg2.id"] } }]);
    eq(where["aws_instance.web"], "Security group sg1");
  });

  test("two AZs that fit side by side pack into one row, not one per row", () => {
    const SUBNET2 = { addr: "aws_subnet.private", refs: { vpc_id: ["aws_vpc.main.id"] },
                       after: { availability_zone: "eu-west-1b", cidr_block: "10.0.2.0/24" } };
    const tree = buildTree(parsePlan(plan([VPC, SUBNET, SUBNET2]), "t"), OPTS);
    const azBoxes = [];
    (function walk(g){ if (g.box){ if (g.cls === "az") azBoxes.push(g); g.children.forEach(walk); } })(tree);
    eq(azBoxes.length, 2, "two AZ boxes");
    eq(azBoxes[0].y, azBoxes[1].y, "same row");
    ok(azBoxes[0].x !== azBoxes[1].x, "different columns");
  });

  test("a multi-AZ resource sits below the AZs in its VPC", () => {
    const SUBNET2 = { addr: "aws_subnet.private", refs: { vpc_id: ["aws_vpc.main.id"] },
                       after: { availability_zone: "eu-west-1b", cidr_block: "10.0.2.0/24" } };
    const model = parsePlan(plan([VPC, SUBNET, SUBNET2,
      { addr: "aws_autoscaling_group.app", refs: {
        vpc_zone_identifier: ["aws_subnet.public.id", "aws_subnet.private.id"] } }]), "t");
    const tree = buildTree(model, OPTS);
    const vpc = tree.children[0].children.find(g => g.cls === "vpc");
    const azs = vpc.children.filter(g => g.cls === "az");
    const wide = vpc.children.find(g => g.cls === "vpc-wide");
    eq(azs.length, 2);
    ok(wide && wide.y > Math.max(...azs.map(g => g.y)), "VPC-wide row follows AZ row");
    eq(wide.children[0].res.addr, "aws_autoscaling_group.app");
  });

  test("a launch template is not enclosed by a security group", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_security_group.app", refs: { vpc_id: ["aws_vpc.main.id"] } },
      { addr: "aws_launch_template.app", refs: {
        vpc_security_group_ids: ["aws_security_group.app.id"] } },
      { addr: "aws_instance.app", refs: {
        subnet_id: ["aws_subnet.public.id"],
        vpc_security_group_ids: ["aws_security_group.app.id"] } }]);
    eq(where["aws_launch_template.app"], "Region eu-west-1");
    eq(where["aws_instance.app"], "Security group app");
  });
});

describe("layout: filters", () => {
  const changing = [VPC, SUBNET,
    { addr: "aws_instance.web", actions: ["update"], refs: { subnet_id: ["aws_subnet.public.id"] } },
    { addr: "aws_instance.idle", actions: ["no-op"], refs: { subnet_id: ["aws_subnet.public.id"] } }];

  test("an action filter also applies to a security group drawn as a tile", () => {
    const where = built(changing.concat([
      { addr: "aws_security_group.unused", actions: ["no-op"], refs: { vpc_id: ["aws_vpc.main.id"] } }]),
      { mode: "changes", action: "update" });
    ok(!where["aws_security_group.unused"], "the no-op security group is filtered out");
  });
});

describe("diff: rule matching", () => {
  const a = { from_port: 443, to_port: 443, protocol: "tcp", cidr_blocks: ["10.0.0.0/16"] };
  const b = { from_port: 1024, to_port: 65535, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] };

  test("a set matches by content, not by position", () => {
    const m = matchRules([a, b], [b, a], "set");
    eq(m.filter(r => r.mark !== "").length, 0, "no rule reported changed");
  });

  test("a list matches by position, so a reorder is a change", () => {
    const m = matchRules([a, b], [b, a], "list");
    ok(m.some(r => r.mark !== ""), "a reorder shows as a change");
  });
});

describe("parse: non-resource sections become typed fields", () => {
  const withExtras = () => parsePlan(plan([VPC], {
    variables: { region: { value: "eu-west-1" }, flag: { value: true } },
    output_changes: {
      vpc_id: { actions: ["create"], after_unknown: true },
      secret: { actions: ["create"], after: "x", after_sensitive: true },
      name: { actions: ["no-op"], after: "main" }
    },
    resource_drift: [{ address: "aws_vpc.main", type: "aws_vpc", name: "main",
      change: { actions: ["update"], before: { a: 1 }, after: { a: 2 } } }],
    checks: [{ address: { kind: "check", to_display: "check.health" }, status: "fail",
      instances: [{ problems: [{ message: "bad" }, { message: "worse" }] }] }]
  }), "t");

  test("variables are name to value", () => {
    eq(withExtras().variables, { region: "eu-west-1", flag: true });
  });

  test("outputs are normalised, with unknown and sensitive as booleans", () => {
    const o = withExtras().outputs;
    eq(o.vpc_id.afterUnknown, true);
    eq(o.secret.afterSensitive, true);
    eq(o.name.after, "main");
    eq(o.name.afterUnknown, false);
  });

  test("drift carries before and after", () => {
    eq(withExtras().driftDetails, [{ address: "aws_vpc.main", type: "aws_vpc", name: "main",
      before: { a: 1 }, after: { a: 2 } }]);
  });

  test("a check keeps its status and flattens its problems", () => {
    eq(withExtras().checks, [{ name: "check.health", status: "fail", problems: ["bad", "worse"] }]);
  });

  test("a plan with none of them has empty fields, not undefined", () => {
    const m = parsePlan(plan([VPC]), "t");
    eq([m.variables, m.driftDetails, m.checks, m.outputs], [{}, [], [], null]);
  });
});

describe("plan: the bundled sample", () => {
  const model = parsePlan(app.samplePlan(), "sample");

  test("no resource is left unplaced", () => {
    const where = placements(model);
    const loose = Object.entries(where).filter(([, box]) => box.startsWith("Unplaced"));
    eq(loose.map(([a]) => a), []);
  });

  test("the sample carries no account identifier", () => {
    const text = JSON.stringify(app.samplePlan());
    eq(text.match(/\b\d{12}\b/g), null, "12-digit account id");
  });
});

/* ---- report ---------------------------------------------------------- */

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
