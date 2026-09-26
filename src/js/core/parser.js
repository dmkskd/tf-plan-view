// core/parser.js — Plan JSON parser, validators and reference extractor
import { escapeHtml } from "./util.js";
import { REG, isProviderSupported, isForeignType } from "../providers/registry.js";

function actionOf(actions){
  if (!actions || !actions.length) return "no-op";
  var a = actions.join(",");
  if (a === "create,delete" || a === "delete,create") return "replace";
  if (actions.indexOf("create") >= 0) return "create";
  if (actions.indexOf("delete") >= 0) return "delete";
  if (actions.indexOf("update") >= 0) return "update";
  if (actions.indexOf("read") >= 0) return "read";
  return "no-op";
}

function parsePlan(plan, sourceName){
  var out = {
    source: sourceName,
    tfVersion: plan && plan.terraform_version || null,
    formatVersion: plan && plan.format_version || null,
    resources: [], byAddr: {}, cfgByAddr: {},
    region: null, diagnostics: [], typeCounts: {}
  };
  out.diag = function(level, code, msg, detail){
    out.diagnostics.push({level:level, code:code, msg:msg, detail:detail || null});
  };

  if (!checkShape(plan, out)) return out;
  readProviders(plan, out);
  readModules(plan, out);
  var refs = readReferences(plan, out);
  readResources(plan, out, refs);
  reportUnsupported(out);
  linkDependents(out);
  summarise(plan, out);

  var aws = out.resources.filter(function(r){ return !r.foreign; }).length;
  if (out.resources.length && !aws){
    out.diag("err", "no-aws", "No AWS resources to draw");
  }

  if (!out.diagnostics.length){
    out.diag("ok", "clean", "All resources recognised");
  }
  return out;
}

/* Is this a plan at all? Returns false when there is nothing to draw. */
function checkShape(plan, out){
  if (!plan || typeof plan !== "object"){
    out.diag("err", "not-json",
      "File is not a JSON object. Expected the output of <b>terraform show -json planfile</b>.");
    return false;
  }
  var fv = plan.format_version;
  if (!fv){
    out.diag("warn", "no-format",
      "No <b>format_version</b> \u2014 this may not be a plan file. Parsing optimistically.");
  } else if (String(fv).split(".")[0] !== "1"){
    out.diag("warn", "format-version", "Plan format <b>" + fv + "</b> is not implemented yet " +
      "\u2014 only format 1.x is understood. Rendering may be incomplete.");
  }
  if (!Array.isArray(plan.resource_changes)){
    if (plan.values || plan.planned_values){
      out.diag("warn", "state-file", "No <b>resource_changes</b>. This looks like a state file " +
        "rather than a plan; reading <b>planned_values</b> instead.");
    } else {
      out.diag("err", "no-resources", "No <b>resource_changes</b> array \u2014 nothing to draw.");
      return false;
    }
  }
  return true;
}

function readProviders(plan, out){
  var pcfg = (plan.configuration && plan.configuration.provider_config) || {};
  Object.keys(pcfg).forEach(function(k){
    var name = pcfg[k].name || k;
    if (!isProviderSupported(name)){
      out.diag("warn", "provider", "Provider <b>" + escapeHtml(name) + "</b> is not implemented " +
        "yet \u2014 only <b>aws</b> resources are drawn.");
      return;
    }
    out.providerConstraint = pcfg[k].version_constraint || null;
    var rex = pcfg[k].expressions && pcfg[k].expressions.region;
    if (rex && rex.constant_value){ out.region = rex.constant_value; return; }
    if (rex && rex.references){
      var vn = String(rex.references[0]).replace(/^var\./, "");
      var vars = plan.variables || {};
      if (vars[vn] && vars[vn].value) out.region = vars[vn].value;
    }
  });
}

function readModules(plan, out){
  var rootCfg = (plan.configuration && plan.configuration.root_module) || {};
  var calls = rootCfg.module_calls;
  if (!calls) return;
  Object.keys(calls).forEach(function(m){
    out.diag("warn", "module", "Nested module <b>module." + escapeHtml(m) + "</b> is not " +
      "implemented yet \u2014 its resources are drawn flat, without the module boundary.");
  });
}

/* Containment and dependencies both come from configuration expressions,
   the only place the plan records them before apply. */
function readReferences(plan, out){
  var rootCfg = (plan.configuration && plan.configuration.root_module) || {};
  var index = {};

  if (!rootCfg.resources){
    out.diag("warn", "no-config", "No <b>configuration</b> block in this plan \u2014 " +
      "relationships cannot be read, so everything is drawn at the top level. " +
      "Re-run <b>terraform show -json</b> on the plan file (not the state).");
    return index;
  }

  rootCfg.resources.forEach(function(r){
    out.cfgByAddr[r.address] = r;
    var refs = [];
    function take(list){
      (list || []).forEach(function(ref){
        if (typeof ref !== "string") return;
        if (/^(var|local|each|count|data)\./.test(ref)) return;
        var addr = ref.split(".").slice(0, 2).join(".");
        if (addr.indexOf("aws_") === 0 && refs.indexOf(addr) < 0) refs.push(addr);
      });
    }
    Object.keys(r.expressions || {}).forEach(function(k){
      var e = r.expressions[k];
      if (e && e.references){ take(e.references); return; }
      if (!Array.isArray(e)) return;
      e.forEach(function(item){                 /* repeated nested blocks */
        if (!item || typeof item !== "object") return;
        Object.keys(item).forEach(function(kk){
          if (item[kk] && item[kk].references) take(item[kk].references);
        });
      });
    });
    take(r.depends_on);
    index[r.address] = refs;
  });
  return index;
}

function readResources(plan, out, refIndex){
  var changes = Array.isArray(plan.resource_changes)
    ? plan.resource_changes
    : ((plan.planned_values && plan.planned_values.root_module &&
        plan.planned_values.root_module.resources) || []);

  changes.forEach(function(rc){
    if (rc.mode === "data") return;
    var spec = REG[rc.type] || null;
    var foreign = isForeignType(rc.type);
    var res = {
      addr: rc.address, type: rc.type, name: rc.name,
      action: rc.change ? actionOf(rc.change.actions) : "no-op",
      attrs: (rc.change && (rc.change.after || rc.change.before)) || rc.values || {},
      before: (rc.change && rc.change.before) || null,
      unknown: (rc.change && rc.change.after_unknown) || {},
      sensitive: (rc.change && rc.change.after_sensitive) || {},
      replacePaths: (rc.change && rc.change.replace_paths) || [],
      actionReason: rc.action_reason || null,
      spec: spec, supported: !foreign && !!spec, kind: spec ? spec.kind : "node",
      refs: refIndex[rc.address] || [],
      foreign: foreign,
      enabled: true, enabledType: true
    };
    out.resources.push(res);
    out.byAddr[res.addr] = res;
    out.typeCounts[rc.type] = (out.typeCounts[rc.type] || 0) + 1;
  });
}

function reportUnsupported(out){
  var unsup = {}, foreign = {};
  out.resources.forEach(function(r){
    if (r.foreign) foreign[r.type] = (foreign[r.type] || 0) + 1;
    else if (!r.supported) unsup[r.type] = (unsup[r.type] || 0) + 1;
  });
  Object.keys(foreign).sort().forEach(function(t){
    out.diag("warn", "foreign", "<b>" + escapeHtml(t) + "</b> \u00d7 " + foreign[t] +
      " \u2014 non-AWS resource, not implemented yet.");
  });
  Object.keys(unsup).sort().forEach(function(t){
    out.diag("warn", "unsupported", "<b>" + escapeHtml(t) + "</b> \u00d7 " + unsup[t] +
      " \u2014 not implemented yet; drawn as a generic tile with no placement rules.");
  });
}

function linkDependents(out){
  out.resources.forEach(function(r){ r.dependents = []; });
  out.resources.forEach(function(r){
    r.refs.forEach(function(a){
      var t = out.byAddr[a];
      if (t) t.dependents.push(r.addr);
    });
  });
}

function summarise(plan, out){
  out.summary = {create:0, update:0, replace:0, "delete":0, "no-op":0, read:0};
  out.resources.forEach(function(r){
    if (out.summary[r.action] === undefined) out.summary[r.action] = 0;
    out.summary[r.action]++;
  });

  out.outputs = plan.output_changes || null;

  if (Array.isArray(plan.resource_drift) && plan.resource_drift.length){
    var n = plan.resource_drift.length;
    out.diag("warn", "drift", "<b>" + n + "</b> resource" + (n > 1 ? "s" : "") +
      " drifted",
      plan.resource_drift.map(function(d){ return d.address; }));
    out.drift = plan.resource_drift.map(function(d){ return d.address; });
  }
  if (plan.errored){
    out.diag("err", "errored", "Plan <b>errored</b>, cannot be applied");
  } else if (plan.applyable === false){
    out.diag("warn", "not-applyable", "Plan is <b>not applyable</b>");
  }
}

export {
  actionOf, parsePlan, checkShape, readProviders, readModules,
  readReferences, readResources, reportUnsupported,
  linkDependents, summarise
};
