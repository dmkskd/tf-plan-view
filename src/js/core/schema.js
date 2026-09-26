// core/schema.js — Schema pruning, localStorage cache & kind lookups
import { escapeHtml, $ } from "./util.js";
import { state } from "./state.js";

var SCHEMA = null;                    /* {type: resource_schema}, from a dropped file */
var SCHEMA_META = null;               /* {provider, version, types}                   */
var KINDS = null, KINDS_META = null;  /* bundled collection-kind table                */

function loadKinds(){
  if (KINDS) return;
  try {
    var el = document.getElementById("collection-kinds");
    var doc = JSON.parse(el.textContent);
    KINDS = doc.kinds || {};
    KINDS_META = doc.meta || {};
  } catch(e){ KINDS = {}; KINDS_META = {}; }
}

var KIND_WORD = {s:"set", l:"list", m:"map"};

function isSchemaFile(doc){
  return !!(doc && doc.provider_schemas);
}

function pruneSchema(doc, types){
  var out = {}, meta = {provider:null, version:doc.format_version || null, types:0};
  Object.keys(doc.provider_schemas || {}).forEach(function(prov){
    var rs = (doc.provider_schemas[prov] || {}).resource_schemas || {};
    types.forEach(function(t){
      if (rs[t] && !out[t]){ out[t] = rs[t]; meta.types++; }
    });
    if (meta.types && !meta.provider) meta.provider = prov.split("/").pop();
  });
  return {schema:out, meta:meta};
}

function storeSchema(schema, meta){
  SCHEMA = schema; SCHEMA_META = meta;
  try {
    localStorage.setItem("tfplanview-schema", JSON.stringify({s:schema, m:meta}));
  } catch(e){ /* too large, or storage unavailable: keep it in memory only */ }
}

function restoreSchema(){
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
function attrKind(type, key){
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

function kindSource(type, key){
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


function schemaFit(){
  loadKinds();
  var meta = (KINDS_META && KINDS_META.providers && KINDS_META.providers.aws) || {};
  var bundled = meta.version || null;

  var currentModel = state.model;
  var types = Object.keys((currentModel && currentModel.typeCounts) || {});
  /* KINDS holds every type in the provider, with {} when it has no
     collections, so absence genuinely means "this version has no such type" */
  var unknown = types.filter(function(t){
    return t.indexOf("aws_") === 0 && !(KINDS && KINDS[t]);
  });

  var constraint = currentModel && currentModel.providerConstraint;
  var wantMajor = constraint && (constraint.match(/(\d+)/) || [])[1];
  var haveMajor = bundled && bundled.split(".")[0];

  return {bundled:bundled, unknown:unknown, constraint:constraint,
          mismatch: !!(wantMajor && haveMajor && wantMajor !== haveMajor),
          usingLoaded: !!SCHEMA};
}

export {
  SCHEMA, SCHEMA_META, KINDS, KINDS_META, KIND_WORD,
  loadKinds, isSchemaFile, pruneSchema, storeSchema, restoreSchema,
  attrKind, kindSource, schemaFit
};
