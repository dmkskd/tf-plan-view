// providers/aws/rules.js — AWS Security Group and Network ACL rules
import { escapeHtml } from "../../core/util.js";

var PORT_NAME = {
  20:"ftp-data", 21:"ftp", 22:"ssh", 23:"telnet", 25:"smtp", 53:"dns",
  67:"dhcp", 68:"dhcp", 80:"http", 110:"pop3", 111:"rpc", 123:"ntp",
  135:"rpc", 139:"netbios", 143:"imap", 161:"snmp", 389:"ldap", 443:"https",
  445:"smb", 465:"smtps", 514:"syslog", 587:"smtp", 636:"ldaps", 873:"rsync",
  993:"imaps", 995:"pop3s", 1194:"openvpn", 1433:"mssql", 1521:"oracle",
  2049:"nfs", 2375:"docker", 2376:"docker-tls", 3000:"grafana", 3306:"mysql",
  3389:"rdp", 4369:"epmd", 5000:"flask", 5432:"postgres", 5601:"kibana",
  5672:"amqp", 6379:"redis", 8000:"http-alt", 8080:"http-alt", 8443:"https-alt",
  8500:"consul", 9042:"cassandra", 9092:"kafka", 9200:"elasticsearch",
  9300:"elasticsearch", 11211:"memcached", 15672:"rabbitmq", 27017:"mongodb"
};

function portName(e){
  if (e.protocol === "-1" || e.protocol === "all") return "";
  if (e.from_port === e.to_port) return PORT_NAME[e.from_port] || "";
  if (e.from_port === 1024 && e.to_port === 65535) return "ephemeral";
  if (e.from_port === 32768 && e.to_port === 65535) return "ephemeral";
  if (e.from_port === 0 && e.to_port === 65535) return "all ports";
  return "";
}

function portText(r){
  if (r.protocol === "-1" || r.protocol === "all") return "all";
  if (r.from_port === 0 && r.to_port === 0) return "all";
  if (r.from_port === r.to_port) return String(r.from_port);
  return r.from_port + "\u2013" + r.to_port;
}
function protoText(p){
  if (p === "-1" || p === undefined || p === null) return "all";
  return String(p);
}
function peerText(e){
  var out = [];
  (e.cidr_blocks || []).forEach(function(c){ out.push(c); });
  (e.ipv6_cidr_blocks || []).forEach(function(c){ out.push(c); });
  (e.prefix_list_ids || []).forEach(function(c){ out.push("pl " + c); });
  (e.security_groups || []).forEach(function(c){ out.push("sg " + c); });
  if (e.self) out.push("self");
  if (e.cidr_block) out.push(e.cidr_block);
  if (e.ipv6_cidr_block) out.push(e.ipv6_cidr_block);
  return out.length ? out.join(", ") : "\u2014";
}

function awsRulesHtml(r){
  var isNacl = r.type === "aws_network_acl";
  var isSg = r.type === "aws_security_group";
  if (!isNacl && !isSg) return "";

  function table(dir, entries){
    var peerHd = (dir === "ingress") ? "Source" : "Destination";
    var h = '<div class="rules-cap">' + dir + '</div>';
    if (!entries || !entries.length) return h + '<div class="none">no ' + dir + ' rules</div>';
    var sorted = entries.slice();
    if (isNacl) sorted.sort(function(a,b){ return (a.rule_no||0) - (b.rule_no||0); });
    h += '<table><thead><tr>' +
         (isNacl ? '<th>#</th>' : '') +
         '<th>Proto</th><th>Ports</th><th></th><th>' + peerHd + '</th>' +
         (isNacl ? '<th>Action</th>' : '') +
         '</tr></thead><tbody>';
    sorted.forEach(function(e){
      h += '<tr>' +
           (isNacl ? '<td>' + escapeHtml(e.rule_no) + '</td>' : '') +
           '<td>' + escapeHtml(protoText(e.protocol)) + '</td>' +
           '<td>' + escapeHtml(portText(e)) + '</td>' +
           '<td class="svc">' + escapeHtml(portName(e)) + '</td>' +
           '<td>' + escapeHtml(peerText(e)) + (e.description ? '<br><span style="color:var(--faint)">' + escapeHtml(e.description) + '</span>' : '') + '</td>' +
           (isNacl ? '<td class="' + (e.action === "deny" ? "deny" : "allow") + '">' + escapeHtml(e.action) + '</td>' : '') +
           '</tr>';
    });
    /* the implicit rule belongs in the same table, or the columns do not line up */
    if (isNacl){
      h += '<tr class="implicit"><td>*</td><td>all</td><td>all</td><td></td>' +
           '<td>0.0.0.0/0</td><td class="deny">deny</td></tr>';
    }
    h += '</tbody></table>';
    return h;
  }

  var out = '<div class="rules">';
  out += table("ingress", r.attrs.ingress);
  out += table("egress", r.attrs.egress);
  if (isSg) out += '<div class="none" style="padding-top:8px">Stateful: replies to allowed traffic return without a matching rule.</div>';
  if (isNacl) out += '<div class="none" style="padding-top:8px">Stateless: each direction is evaluated independently, first match wins.</div>';
  out += '</div>';
  return {title: isSg ? "Security group rules" : "Network ACL rules", body: out};
}

function awsIsRuleAttr(kOrR, aOrK, bOrA, maybeB){
  var k = maybeB !== undefined ? aOrK : kOrR;
  var a = maybeB !== undefined ? bOrA : aOrK;
  var b = maybeB !== undefined ? maybeB : bOrA;
  if (k !== "ingress" && k !== "egress") return false;
  return (Array.isArray(a) || a == null) && (Array.isArray(b) || b == null);
}

function awsRuleKey(rOrE, maybeE){
  var e = maybeE !== undefined ? maybeE : rOrE;
  return [e.action || "", e.protocol, e.from_port, e.to_port,
          peerText(e), e.rule_no == null ? "" : e.rule_no].join("|");
}

function awsRuleRow(rOrE, markOrE, dirOrMark, maybeDir){
  var e = maybeDir !== undefined ? markOrE : rOrE;
  var mark = maybeDir !== undefined ? dirOrMark : markOrE;
  var dir = maybeDir !== undefined ? maybeDir : dirOrMark;
  var cls = mark === "+" ? "added" : (mark === "-" ? "removed" : "kept");
  return '<div class="rdiff-row ' + cls + '">' +
           '<span class="m">' + (mark || "\u00a0") + '</span>' +
           '<span class="p">' + escapeHtml(portText(e)) + '</span>' +
           '<span class="s">' + escapeHtml(portName(e)) + '</span>' +
           '<span class="pr">' + escapeHtml(protoText(e.protocol)) + '</span>' +
           '<span class="pe">' + escapeHtml(peerText(e)) +
             (e.rule_no != null ? ' #' + escapeHtml(e.rule_no) : '') + '</span>' +
           (e.description ? '<span class="d">' + escapeHtml(e.description) + '</span>' : '') +
         '</div>';
}

function awsPopRow(e, dir, isNacl, mark){
  var arrow = dir === "ingress" ? "\u2190" : "\u2192";
  var deny = e.action === "deny";
  var cls = mark === "+" ? "added" : mark === "-" ? "removed" : (deny ? "deny" : "allow");
  return '<div class="rp-rule ' + cls + '">' +
           '<span class="rp-mark">' + (mark || "") + '</span>' +
           '<span class="rp-arrow">' + arrow + '</span>' +
           '<span class="rp-port">' + escapeHtml(portText(e)) + '</span>' +
           '<span class="rp-svc">' + escapeHtml(portName(e)) + '</span>' +
           '<span class="rp-proto">' + escapeHtml(protoText(e.protocol)) + '</span>' +
           '<span class="rp-peer">' + escapeHtml(peerText(e)) +
             (isNacl && e.rule_no != null ? ' <span class="rp-no">#' + escapeHtml(e.rule_no) + '</span>' : '') +
           '</span>' +
         '</div>';
}

function awsRuleLines(r, dir, isNacl, opts, matchRulesFn, attrKindFn, sameValFn){
  var after = (r.attrs || {})[dir];
  var before = (r.before || {})[dir];
  var mode = (opts && opts.mode) ? opts.mode : "all";
  var isSame = sameValFn ? sameValFn(before, after) : (JSON.stringify(before) === JSON.stringify(after));
  var changed = mode === "changes" &&
                r.action !== "create" && r.action !== "no-op" &&
                Array.isArray(before) && !isSame;

  var out;
  if (changed && matchRulesFn && attrKindFn){
    out = matchRulesFn(before, after, attrKindFn(r.type, dir))
            .map(function(m){ return awsPopRow(m.rule, dir, isNacl, m.mark); }).join("");
  } else {
    var entries = Array.isArray(after) ? after : [];
    if (!entries.length) return '<div class="rp-none">no ' + dir + ' rules</div>';
    var list = entries.slice();
    if (isNacl) list.sort(function(a, b){ return (a.rule_no || 0) - (b.rule_no || 0); });
    out = list.map(function(e){ return awsPopRow(e, dir, isNacl, ""); }).join("");
  }
  if (!out) return '<div class="rp-none">no ' + dir + ' rules</div>';

  if (isNacl){
    out += awsPopRow({action:"deny", protocol:"-1", from_port:0, to_port:0,
                   cidr_block:"0.0.0.0/0"}, dir, false, "");
  }
  return out;
}

export {
  PORT_NAME, portName, portText, protoText, peerText,
  awsRulesHtml, awsIsRuleAttr, awsRuleKey, awsRuleRow, awsPopRow, awsRuleLines
};
