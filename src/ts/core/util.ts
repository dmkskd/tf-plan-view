// core/util.ts — Pure string, DOM and general utilities

export function escapeHtml(s: any): string {
  return String(s).replace(/[&<>"']/g, function(c: string) {
    const map: Record<string, string> = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
    return map[c] ?? c;
  });
}

export function q(s: any): string {
  return String(s).replace(/"/g, '\"');
}

export const $ = function<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
};
