"use strict";

const assert = require("assert");
const parse = require("../src/parse.js");

let ids = [];
let clicks = 0;
const button = {
  innerText: "View more comments",
  getAttribute: () => "",
  closest: () => null,
  click() {
    clicks += 1;
    if (clicks === 1) ids.push("901");
  },
};
const root = {
  querySelectorAll(selector) {
    if (selector === '[role="button"]') return [button];
    return [];
  },
};

globalThis.FBParse = {
  ...parse,
  commentsFromArticle: () => ids.map((id) => ({ id })),
};

const { expandThread } = require("../src/content.js");

(async () => {
  const result = await expandThread("555", root, async () => true);
  assert.equal(result.complete, false);
  assert.match(result.error, /stopped expanding/);
  assert.equal(clicks, 3, "persistent control is retried after progress, then stops after two idle waits");

  let menuOpen = false;
  let allSelected = false;
  const sort = { innerText: "Most relevant", getAttribute: () => "", closest: () => null, click: () => { menuOpen = true; } };
  const all = { innerText: "All comments", getAttribute: () => "", closest: () => null, click: () => { allSelected = true; } };
  const sortedRoot = {
    querySelectorAll(selector) {
      if (selector === '[role="button"]') return allSelected ? [] : [sort];
      if (selector.includes("menuitem")) return menuOpen ? [all] : [];
      return [];
    },
  };
  const sorted = await expandThread("555", sortedRoot, async () => true);
  assert.equal(sorted.complete, true);
  assert.equal(allSelected, true, "Most relevant is switched to All comments before expansion");
  console.log("content.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
