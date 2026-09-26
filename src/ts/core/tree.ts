// core/tree.ts — Containment group creation for layout trees

import { LayoutGroup } from "../types/index.js";

export type GroupBox = LayoutGroup;

function mkGroup(cls: string, label: string, meta?: string, maxW?: number, stack?: boolean): LayoutGroup {
  return {
    box: true, cls: cls, label: label, meta: meta || "", children: [],
    maxW: maxW || 760, stack: !!stack, w: 0, h: 0, x: 0, y: 0
  };
}

export { mkGroup };
