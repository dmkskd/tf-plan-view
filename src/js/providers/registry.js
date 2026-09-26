// providers/registry.js — Pluggable multi-provider manager
import { awsProvider } from "./aws/index.js";
import { CAT, CAT_LABEL } from "./aws/catalog.js";
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

export function getProviderForName(name) {
  if (!name) return null;
  for (const p of providers) {
    if (p.id === name) return p;
  }
  return null;
}

export function isProviderSupported(name) {
  return name === "aws";
}

export function isForeignType(type) {
  return !type || type.indexOf("aws_") !== 0;
}

export function getCloudRootLabel(model) {
  return "AWS Cloud";
}

export function getAllProviders() {
  return providers;
}

export var REG = new Proxy({}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    for (const p of providers) {
      if (p.catalog && p.catalog[prop]) return p.catalog[prop];
    }
    return undefined;
  },
  has(target, prop) {
    if (prop in target) return true;
    for (const p of providers) {
      if (p.catalog && prop in p.catalog) return true;
    }
    return false;
  },
  ownKeys(target) {
    const keys = new Set(Object.keys(target));
    for (const p of providers) {
      if (p.catalog) Object.keys(p.catalog).forEach(k => keys.add(k));
    }
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) return Object.getOwnPropertyDescriptor(target, prop);
    for (const p of providers) {
      if (p.catalog && prop in p.catalog) {
        return Object.getOwnPropertyDescriptor(p.catalog, prop);
      }
    }
    return undefined;
  }
});

export { CAT, CAT_LABEL };

export function CLI(r, ctx) {
  const p = getProviderForResource(r);
  return (p && p.cli) ? p.cli(r, ctx) : [];
}

export function rulesHtml(r) {
  const p = getProviderForResource(r);
  return (p && p.rules && p.rules.rulesHtml) ? p.rules.rulesHtml(r) : "";
}

export function isRuleAttr(rOrK, kOrA, aOrB, maybeB) {
  let r, k, a, b;
  if (maybeB !== undefined) {
    r = rOrK; k = kOrA; a = aOrB; b = maybeB;
  } else {
    r = null; k = rOrK; a = kOrA; b = aOrB;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.isRuleAttr === "function") {
    return p.rules.isRuleAttr(k, a, b);
  }
  return awsProvider.rules.isRuleAttr(k, a, b);
}

export function ruleKey(rOrE, maybeE) {
  const e = maybeE !== undefined ? maybeE : rOrE;
  const r = maybeE !== undefined ? rOrE : null;
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleKey === "function") {
    return p.rules.ruleKey(e);
  }
  return awsProvider.rules.ruleKey(e);
}

export function ruleRow(rOrE, markOrE, dirOrMark, maybeDir) {
  let r, e, mark, dir;
  if (maybeDir !== undefined) {
    r = rOrE; e = markOrE; mark = dirOrMark; dir = maybeDir;
  } else {
    r = null; e = rOrE; mark = markOrE; dir = dirOrMark;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleRow === "function") {
    return p.rules.ruleRow(e, mark, dir);
  }
  return awsProvider.rules.ruleRow(e, mark, dir);
}

export function popRow(rOrE, eOrDir, dirOrNacl, isNaclOrMark, maybeMark) {
  let r, e, dir, isNacl, mark;
  if (maybeMark !== undefined) {
    r = rOrE; e = eOrDir; dir = dirOrNacl; isNacl = isNaclOrMark; mark = maybeMark;
  } else {
    r = null; e = rOrE; dir = eOrDir; isNacl = dirOrNacl; mark = isNaclOrMark;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.popRow === "function") {
    return p.rules.popRow(e, dir, isNacl, mark);
  }
  return awsProvider.rules.popRow(e, dir, isNacl, mark);
}

export function ruleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn) {
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleLines === "function") {
    return p.rules.ruleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn);
  }
  return awsProvider.rules.ruleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn);
}

export function placeAllContainers(ctx) {
  for (const p of providers) {
    if (p.placement && typeof p.placement.placeContainers === "function") {
      p.placement.placeContainers(ctx);
    }
  }
}

export function containerOfResource(ctx, r) {
  const p = getProviderForResource(r);
  if (p && p.placement && typeof p.placement.containerOf === "function") {
    const c = p.placement.containerOf(ctx, r);
    if (c) return c;
  }
  for (var i = 0; i < (r.refs || []).length; i++) {
    var ref = r.refs[i];
    if (ctx.subnetGroups && ctx.subnetGroups[ref]) return ctx.subnetGroups[ref];
    if (ctx.vpcGroups && ctx.vpcGroups[ref]) return ctx.vpcGroups[ref];
  }
  return null;
}

export function isContainerBoundary(ctx, r) {
  const p = getProviderForResource(r);
  if (p && p.placement && typeof p.placement.isBoundary === "function") {
    return p.placement.isBoundary(ctx, r);
  }
  return !!(ctx.sgGroups && ctx.sgGroups[r.addr]);
}

export function blockHeight(r) {
  const p = getProviderForResource(r);
  return (p && p.sizing && p.sizing.blockHeight) ? p.sizing.blockHeight(r) : 26;
}
