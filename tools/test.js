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

  test("a resource referencing only the vpc sits in the vpc", () => {
    const where = built([VPC, SUBNET,
      { addr: "aws_internet_gateway.igw", refs: { vpc_id: ["aws_vpc.main.id"] } }]);
    eq(where["aws_internet_gateway.igw"], "VPC main 10.0.0.0/16");
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
