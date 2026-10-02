// core/links.ts — the one place that decides whether a plan-derived link may exist
//
// A CSP cannot stop a click from navigating, so the guarantee is made here:
// links built from plan data are off until the user turns them on, and when
// on, only an https AWS console host is ever returned.

var LINKS_KEY = "tfplanview-links";
var linksOn = false;

/* <region>.console.<aws domain> or the bare console host. Anchored, so a
   suffix match such as evil.com/console.aws.amazon.com cannot pass. */
var CONSOLE_HOST = /^([a-z]{2}(-[a-z]+)+-\d+\.)?console\.(aws\.amazon\.com|amazonaws\.cn|amazonaws-us-gov\.com)$/;
var MAX_URL_LENGTH = 2048;

export function safeExternalUrl(url: any): string | null {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return null;
  var u: URL;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password || u.port) return null;
  if (!CONSOLE_HOST.test(u.hostname)) return null;
  return u.href;
}

export function linksEnabled(): boolean { return linksOn; }

export function setLinksEnabled(on: boolean): void {
  linksOn = !!on;
  try { localStorage.setItem(LINKS_KEY, linksOn ? "1" : "0"); } catch (e) {}
}

/* Only ever restores the user's own earlier choice; nothing in a plan or the
   page URL is consulted. */
export function restoreLinksEnabled(): boolean {
  try { linksOn = localStorage.getItem(LINKS_KEY) === "1"; } catch (e) { linksOn = false; }
  return linksOn;
}

/* The single gate for links derived from plan data: off means null. */
export function guardedLink(url: string | null): string | null {
  if (!linksOn || !url) return null;
  return safeExternalUrl(url);
}

/* Hover text for a link: what the click does and the exact destination. */
export function linkTitle(url: string): string {
  return "Opens this resource in the AWS console:\n" + url;
}
