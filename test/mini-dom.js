"use strict";

const VOID_TAGS = new Set(["img", "br", "hr", "meta", "input"]);

class TextNode {
  constructor(value, parent) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = parent;
    this.childNodes = [];
  }
  get textContent() { return this.nodeValue; }
  get innerText() { return this.nodeValue; }
}

class El {
  constructor(tag, attrs, parent) {
    this.nodeType = 1;
    this.tag = tag;
    this.attrs = attrs || {};
    this.parentElement = parent || null;
    this.childNodes = [];
    this.children = [];
  }
  append(node) {
    node.parentElement = this;
    this.childNodes.push(node);
    if (node.nodeType === 1) this.children.push(node);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  get innerText() {
    return this.textContent;
  }
  matches(sel) {
    return matchSelector(this, sel);
  }
  closest(sel) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (node.matches(sel)) return node;
      node = node.parentElement;
    }
    return null;
  }
  contains(other) {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(sel)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

function matchSelector(el, sel) {
  return sel.split(",").some((part) => {
    const match = part.trim().match(/^([a-z*]+)?(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?$/);
    if (!match) return false;
    const tag = match[1];
    const attr = match[2];
    const value = match[3];
    if (tag && tag !== "*" && el.tag !== tag) return false;
    if (!tag && !attr) return false;
    if (attr) {
      const have = el.getAttribute(attr);
      if (have == null) return false;
      if (value != null && have !== value) return false;
    }
    return true;
  });
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=/]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g;
  let match;
  while ((match = re.exec(raw))) {
    if (match[1] === "/") continue;
    attrs[match[1]] = decode(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function decode(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseFragment(html) {
  const root = new El("div", {}, null);
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      while (stack.length > 1 && stack[stack.length - 1].tag !== tag) stack.pop();
      if (stack.length > 1) stack.pop();
    } else if (match[2]) {
      const tag = match[2].toLowerCase();
      const el = new El(tag, parseAttrs(match[3] || ""), null);
      stack[stack.length - 1].append(el);
      const selfClose = /\/\s*$/.test(match[3] || "") || VOID_TAGS.has(tag);
      if (!selfClose) stack.push(el);
    } else if (match[4]) {
      const text = decode(match[4]);
      if (text.trim()) stack[stack.length - 1].append(new TextNode(text, null));
    }
  }
  return root;
}

function loadHtml(html) {
  const body = parseFragment(html);
  return {
    title: "",
    URL: "https://www.facebook.com/groups/123",
    body,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    querySelector: (sel) => body.querySelector(sel),
  };
}

module.exports = { loadHtml };
