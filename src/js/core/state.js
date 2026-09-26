// core/state.js — Centralized application state and selection store

export const state = {
  model: null,
  selected: null,
  opts: {
    showAssoc: false,
    showUnsup: true,
    edges: "select",
    mode: "all",
    render: "diagram",
    action: null,
    pulse: true
  },
  nodeEls: {},
  suppressClick: false
};

const selectListeners = [];
const renderListeners = [];
const modeListeners = [];

export function onSelect(fn) {
  if (typeof fn === "function") selectListeners.push(fn);
}

export function notifySelect(selected) {
  selectListeners.forEach(fn => {
    try { fn(selected); } catch (e) { console.error("Error in selectListener:", e); }
  });
}

export function onRender(fn) {
  if (typeof fn === "function") renderListeners.push(fn);
}

export function notifyRender() {
  renderListeners.forEach(fn => {
    try { fn(); } catch (e) { console.error("Error in renderListener:", e); }
  });
}

export function onMode(fn) {
  if (typeof fn === "function") modeListeners.push(fn);
}

export function notifyMode(m) {
  modeListeners.forEach(fn => {
    try { fn(m); } catch (e) { console.error("Error in modeListener:", e); }
  });
}

export function setMode(m) {
  state.opts.mode = m;
  notifyMode(m);
  return m;
}

export function getModel() {
  return state.model;
}

export function setModel(m) {
  state.model = m;
  return state.model;
}

export function getSelected() {
  return state.selected;
}

export function setSelected(s) {
  state.selected = s;
  return state.selected;
}

export function getOpts() {
  return state.opts;
}

export function setOpts(newOpts) {
  Object.assign(state.opts, newOpts);
  return state.opts;
}

export function getNodeEls() {
  return state.nodeEls;
}

export function setNodeEls(els) {
  state.nodeEls = els;
  return state.nodeEls;
}

export function setSuppressClick(val) {
  state.suppressClick = !!val;
  return state.suppressClick;
}
