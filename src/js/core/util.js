// core/util.js — Pure string, DOM and general utilities

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

export function q(s) {
  return String(s).replace(/"/g, '\"');
}

export const $ = function(id) {
  return document.getElementById(id);
};
