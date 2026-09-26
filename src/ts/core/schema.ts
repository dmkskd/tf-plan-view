// core/schema.ts — Schema pruning, localStorage cache & kind lookups
import { escapeHtml, $ } from "./util.js";
import { state } from "./state.js";

var SCHEMA: any = null;                    /* {type: resource_schema}, from a dropped file */
var SCHEMA_META: any = null;               /* {provider, version, types}                   */
var KINDS: any = null, KINDS_META: any = null;  /* bundled collection-kind table                */

function loadKinds(): void {
  if (KINDS) return;
  try {
    var el = document.getElementById("collection-kinds");
    if (el && el.textContent) {
      var doc = JSON.parse(el.textContent);
      KINDS = doc.kinds || {};
      KINDS_META = doc.meta || {};
    } else {
      KINDS = {};
      KINDS_META = {};
    }
  } catch(e){ KINDS = {}; KINDS_META = {}; }
}

var KIND_WORD: Record<string, string> = {s:"set", l:"list", m:"map"};

function isSchemaFile(doc: any): boolean {
  return !!(doc && doc.provider_schemas);
}

function pruneSchema(doc: any, types: string[]): { schema: Record<string, any>; meta: { provider: string | null; version: string | null; types: number } } {
  var out: Record<string, any> = {}, meta = {provider: null as string | null, version: (doc.format_version || null) as string | null, types: 0};
  Object.keys(doc.provider_schemas || {}).forEach(function(prov: string){
    var rs = (doc.provider_schemas[prov] || {}).resource_schemas || {};
    types.forEach(function(t: string){
      if (rs[t] && !out[t]){ out[t] = rs[t]; meta.types++; }
    });
    if (meta.types && !meta.provider) meta.provider = prov.split("/").pop() || null;
  });
  return {schema:out, meta:meta};
}

function storeSchema(schema: any, meta: any): void {
  SCHEMA = schema; SCHEMA_META = meta;
  try {
    localStorage.setItem("tfplanview-schema", JSON.stringify({s:schema, m:meta}));
  } catch(e){ /* too large, or storage unavailable: keep it in memory only */ }
}

function restoreSchema(): void {
  try {
    var raw = localStorage.getItem("tfplanview-schema");
    if (!raw) return;
    var v = JSON.parse(raw);
    SCHEMA = v.s || null; SCHEMA_META = v.m || null;
  } catch(e){ SCHEMA = null; SCHEMA_META = null; }
}

/* A schema the user dropped is exact for their provider version, so it wins.
   Otherwise fall back to the bundled table. Returns
   "set" | "list" | "map" | "single" | "scalar", plus where it came from. */
function attrKind(type: string, key: string): string | null {
  var rs = SCHEMA && SCHEMA[type];
  if (rs && rs.block){
    var a = (rs.block.attributes || {})[key];
    if (a) return Array.isArray(a.type) ? a.type[0] : "scalar";
    var bt = (rs.block.block_types || {})[key];
    if (bt) return bt.nesting_mode;
  }
  loadKinds();
  var k = KINDS && KINDS[type] && KINDS[type][key];
  return k ? KIND_WORD[k] : null;
}

function kindSource(type: string, key: string): string | null {
  var rs = SCHEMA && SCHEMA[type];
  if (rs && rs.block &&
      (((rs.block.attributes || {})[key]) || ((rs.block.block_types || {})[key]))) {
    return "loaded schema";
  }
  loadKinds();
  if (KINDS && KINDS[type] && KINDS[type][key]){
    var m = (KINDS_META.providers || {}).aws || {};
    return "aws " + (m.version || "bundled");
  }
  return null;
}

function schemaFit(): { bundled: string | null; unknown: string[]; constraint: string | null; mismatch: boolean; usingLoaded: boolean } {
  loadKinds();
  var meta = (KINDS_META && KINDS_META.providers && KINDS_META.providers.aws) || {};
  var bundled = meta.version || null;

  var currentModel = state.model;
  var types = Object.keys((currentModel && currentModel.typeCounts) || {});
  /* KINDS holds every type in the provider, with {} when it has no
     collections, so absence genuinely means "this version has no such type" */
  var unknown = types.filter(function(t: string){
    return t.indexOf("aws_") === 0 && !(KINDS && KINDS[t]);
  });

  var constraint = currentModel && (currentModel as any).providerConstraint;
  var wantMajor = constraint && (constraint.match(/(\d+)/) || [])[1];
  var haveMajor = bundled && bundled.split(".")[0];

  return {bundled:bundled, unknown:unknown, constraint:constraint || null,
          mismatch: !!(wantMajor && haveMajor && wantMajor !== haveMajor),
          usingLoaded: !!SCHEMA};
}

export {
  SCHEMA, SCHEMA_META, KINDS, KINDS_META, KIND_WORD,
  loadKinds, isSchemaFile, pruneSchema, storeSchema, restoreSchema,
  attrKind, kindSource, schemaFit
};

