// core/tree.js — Containment group creation for layout trees

function mkGroup(cls, label, meta, maxW, stack){
  return {box:true, cls:cls, label:label, meta:meta||"", children:[],
          maxW:maxW||760, stack:!!stack, w:0, h:0, x:0, y:0};
}

export { mkGroup };
