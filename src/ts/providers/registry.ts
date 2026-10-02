// providers/registry.ts — Pluggable multi-provider manager
import { ProviderPlugin, CatalogEntry, CliCommand, PlanResource, RuleSection, LayoutContext, LayoutGroup } from "../types/index.js";
import { awsProvider } from "./aws/index.js";
import { CAT, CAT_LABEL } from "./aws/catalog.js";
import { gcpProvider } from "./gcp/index.js";

const providers: ProviderPlugin[] = [awsProvider, gcpProvider];

export function getProviderForType(type: string): ProviderPlugin | null {
  if (!type) return null;
  for (const p of providers) {
    if (p.prefix && type.startsWith(p.prefix)) return p;
    if (p.catalog && p.catalog[type]) return p;
  }
  return null;
}

export function getProviderForResource(res: PlanResource | null | undefined): ProviderPlugin | null {
  return res ? getProviderForType(res.type) : null;
}

export function getProviderForName(name: string): ProviderPlugin | null {
  if (!name) return null;
  for (const p of providers) {
    if (p.id === name) return p;
  }
  return null;
}

export function isProviderSupported(name: string): boolean {
  return name === "aws";
}

export function isForeignType(type: string): boolean {
  return !type || type.indexOf("aws_") !== 0;
}

export function getCloudRootLabel(model?: any): string {
  return "AWS Cloud";
}

export function getAllProviders(): ProviderPlugin[] {
  return providers;
}

export var REG: Record<string, CatalogEntry> = new Proxy({} as Record<string, CatalogEntry>, {
  get(target: any, prop: string | symbol) {
    if (typeof prop === "string") {
      if (prop in target) return target[prop];
      for (const p of providers) {
        if (p.catalog && p.catalog[prop]) return p.catalog[prop];
      }
    }
    return undefined;
  },
  has(target: any, prop: string | symbol) {
    if (typeof prop === "string") {
      if (prop in target) return true;
      for (const p of providers) {
        if (p.catalog && prop in p.catalog) return true;
      }
    }
    return false;
  },
  ownKeys(target: any) {
    const keys = new Set(Object.keys(target));
    for (const p of providers) {
      if (p.catalog) Object.keys(p.catalog).forEach(k => keys.add(k));
    }
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target: any, prop: string | symbol) {
    if (typeof prop === "string") {
      if (prop in target) return Object.getOwnPropertyDescriptor(target, prop);
      for (const p of providers) {
        if (p.catalog && prop in p.catalog) {
          return Object.getOwnPropertyDescriptor(p.catalog, prop);
        }
      }
    }
    return undefined;
  }
});

export { CAT, CAT_LABEL };

export function CLI(r: PlanResource, ctx?: any): CliCommand[] {
  const p = getProviderForResource(r);
  return (p && p.cli) ? p.cli(r, ctx) : [];
}

export function consoleUrl(r: PlanResource, ctx?: any): string | null {
  const p = getProviderForResource(r);
  return (p && p.consoleUrl) ? p.consoleUrl(r, ctx) : null;
}

export function rulesHtml(r: PlanResource): RuleSection | null {
  const p = getProviderForResource(r);
  return (p && p.rules && p.rules.rulesHtml) ? p.rules.rulesHtml(r) : null;
}

export function isRuleAttr(rOrK: any, kOrA?: any, aOrB?: any, maybeB?: any): boolean {
  let r: any, k: any, a: any, b: any;
  if (maybeB !== undefined) {
    r = rOrK; k = kOrA; a = aOrB; b = maybeB;
  } else {
    r = null; k = rOrK; a = kOrA; b = aOrB;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.isRuleAttr === "function") {
    return p.rules.isRuleAttr(k, a, b);
  }
  return awsProvider.rules?.isRuleAttr ? awsProvider.rules.isRuleAttr(k, a, b) : false;
}

export function ruleKey(rOrE: any, maybeE?: any): string {
  const e = maybeE !== undefined ? maybeE : rOrE;
  const r = maybeE !== undefined ? rOrE : null;
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleKey === "function") {
    return p.rules.ruleKey(e);
  }
  return awsProvider.rules?.ruleKey ? awsProvider.rules.ruleKey(e) : "";
}

export function ruleRow(rOrE: any, markOrE?: any, dirOrMark?: any, maybeDir?: any): string {
  let r: any, e: any, mark: any, dir: any;
  if (maybeDir !== undefined) {
    r = rOrE; e = markOrE; mark = dirOrMark; dir = maybeDir;
  } else {
    r = null; e = rOrE; mark = markOrE; dir = dirOrMark;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleRow === "function") {
    return p.rules.ruleRow(e, mark, dir);
  }
  return awsProvider.rules?.ruleRow ? awsProvider.rules.ruleRow(e, mark, dir) : "";
}

export function popRow(rOrE: any, eOrDir: any, dirOrNacl?: any, isNaclOrMark?: any, maybeMark?: any): string {
  let r: any, e: any, dir: any, isNacl: any, mark: any;
  if (maybeMark !== undefined) {
    r = rOrE; e = eOrDir; dir = dirOrNacl; isNacl = isNaclOrMark; mark = maybeMark;
  } else {
    r = null; e = rOrE; dir = eOrDir; isNacl = dirOrNacl; mark = isNaclOrMark;
  }
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.popRow === "function") {
    return p.rules.popRow(e, dir, isNacl, mark);
  }
  return awsProvider.rules?.popRow ? awsProvider.rules.popRow(e, dir, isNacl, mark) : "";
}

export function ruleLines(r: PlanResource, dir: string, isNacl: boolean, opts?: any, matchRulesFn?: any, attrKindFn?: any, sameValFn?: any): string {
  const p = getProviderForResource(r);
  if (p && p.rules && typeof p.rules.ruleLines === "function") {
    return p.rules.ruleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn);
  }
  return awsProvider.rules?.ruleLines ? awsProvider.rules.ruleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn) : "";
}

export function placeAllContainers(ctx: LayoutContext): void {
  for (const p of providers) {
    if (p.placement && typeof p.placement.placeContainers === "function") {
      p.placement.placeContainers(ctx);
    }
  }
}

export function containerOfResource(ctx: LayoutContext, r: PlanResource): LayoutGroup | null {
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

export function isContainerBoundary(ctx: LayoutContext, r: PlanResource): boolean {
  const p = getProviderForResource(r);
  if (p && p.placement && typeof p.placement.isBoundary === "function") {
    return p.placement.isBoundary(ctx, r);
  }
  return !!(ctx.sgGroups && (ctx.sgGroups[r.addr] || []).length);
}

export function blockHeight(r: PlanResource): number {
  const p = getProviderForResource(r);
  return (p && p.sizing && p.sizing.blockHeight) ? p.sizing.blockHeight(r) : 26;
}

