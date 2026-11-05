"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parse = require("../src/parse.js");
const { loadHtml } = require("./mini-dom.js");

const html = fs.readFileSync(path.join(__dirname, "../fixtures/thread.html"), "utf8");
const doc = loadHtml(html);
const article = doc.querySelector('[role="article"]');
const post = parse.postFromArticle(article, "123", "https://www.facebook.com/groups/123");
const comments = parse.commentsFromArticle(article, "555", "123");

assert.equal(parse.groupFromUrl("https://www.facebook.com/groups/123").id, "123");
assert.equal(parse.groupFromUrl("https://www.facebook.com/groups/feed"), null);
assert.equal(parse.groupFromUrl("https://www.facebook.com/groups/123/posts/555").id, "123");
assert.equal(parse.isFeedUrl("https://www.facebook.com/groups/123", "123"), true);
assert.equal(parse.isFeedUrl("https://www.facebook.com/groups/123/posts/555", "123"), false);
assert.equal(parse.postIdFromUrl("https://www.facebook.com/groups/123/posts/555"), "555");
assert.equal(parse.postIdFromUrl("https://www.facebook.com/groups/123/posts/pfbid0abc"), "pfbid0abc");
assert.equal(parse.postIdFromUrl("/groups/9/permalink/42"), "42");

const absolute = parse.parseTimeLabel("November 1, 2026");
assert.equal(absolute.approximate, false);
assert.equal(absolute.createdAt, "2026-11-01T00:00:00.000Z");
assert.equal(parse.parseTimeLabel("November 1, 2026 at 8:05 PM").createdAt, "2026-11-01T20:05:00.000Z");
assert.equal(parse.parseTimeLabel("2h").approximate, true);
assert.equal(parse.parseTimeLabel("2h").createdAt, null);
assert.equal(parse.parseTimeLabel("Yesterday at 3:14 PM").approximate, true);
assert.equal(parse.isOlderThan({ createdAt: "2026-11-01T00:00:00.000Z", approximate: false }, "2026-12-01"), true);
assert.equal(parse.isOlderThan({ createdAt: "2026-11-01T00:00:00.000Z", approximate: false }, "2026-01-01"), false);
assert.equal(parse.isOlderThan({ createdAt: null, approximate: true }, "2026-12-01"), false);
assert.equal(parse.isNewerThan({ createdAt: "2026-03-02T00:00:00.000Z", approximate: false }, "2026-03-01"), true);
assert.equal(parse.isNewerThan({ createdAt: "2026-03-01T00:00:00.000Z", approximate: false }, "2026-03-01"), false);
assert.equal(parse.isNewerThan({ createdAt: null, approximate: true }, "2025-01-01", "2026-11-05"), true);
assert.equal(parse.isNewerThan({ createdAt: null, approximate: true }, "2026-11-05", "2026-11-05"), false);

assert.equal(parse.isExpandLabel("See more"), true);
assert.equal(parse.isExpandLabel("View 5 more comments"), true);
assert.equal(parse.isExpandLabel("View 2 replies"), true);
assert.equal(parse.isExpandLabel("Write a comment"), false);

assert.ok(post);
assert.equal(post.id, "555");
assert.equal(post.authorName, "Ada Lovelace");
assert.ok(post.authorUrl.includes("/user/99"));
assert.equal(post.text, "Full post text about cast iron pans.");
assert.equal(post.sharedText, "Original thought from another post");
assert.equal(post.reactionCount, 12);
assert.equal(post.commentCount, 4);
assert.deepEqual(post.links, ["https://example.com/guide"]);
assert.deepEqual(post.imageAlts, ["skillet on a stove"]);
assert.equal(post.createdAt, "2026-11-01T00:00:00.000Z");
assert.equal(post.approximate, false);
assert.ok(post.url.includes("/groups/123/posts/555"));

const hiddenYear = loadHtml(`
<div role="article">
  <a href="https://www.facebook.com/groups/123/user/99">Ada Lovelace</a>
  <a href="https://www.facebook.com/groups/123/posts/888" aria-label="2d"><span>November 23, 2025</span></a>
  <div dir="auto">A post from last year.</div>
</div>`);
const oldPost = parse.postFromArticle(hiddenYear.querySelector('[role="article"]'), "123", "https://www.facebook.com/groups/123");
assert.equal(oldPost.createdAt, "2025-11-23T00:00:00.000Z");
assert.equal(oldPost.approximate, false);
assert.equal(parse.isOlderThan(oldPost, "2026-01-01"), true);

assert.equal(comments.length, 2);
assert.equal(comments[0].id, "901");
assert.equal(comments[0].authorName, "Grace Hopper");
assert.equal(comments[0].text, "Top comment");
assert.equal(comments[0].parentId, null);
assert.equal(comments[0].depth, 0);
assert.equal(comments[0].reactionCount, 2);
assert.equal(comments[0].approximate, true);
assert.equal(comments[1].id, "902");
assert.equal(comments[1].authorName, "Alan Turing");
assert.equal(comments[1].text, "A reply");
assert.equal(comments[1].parentId, "901");
assert.equal(comments[1].depth, 1);
assert.equal(comments[1].order, 1);
assert.equal(comments[1].createdAt, "2026-11-02T00:00:00.000Z");

const blocked = loadHtml('<div role="dialog"><p>Help us confirm it\'s you</p></div>');
blocked.title = "Facebook";
assert.equal(parse.isInterstitial(blocked), true);

const slow = loadHtml("<p>Please slow down</p>");
assert.equal(parse.isInterstitial(slow), true);
assert.equal(parse.isInterstitial(doc), false);

const quoted = loadHtml(`<div role="article"><div dir="auto">${"please slow down ".repeat(80)}</div></div>`);
assert.equal(parse.isInterstitial(quoted), false);

assert.equal(parse.groupNameFromTitle("Cast Iron | Facebook"), "Cast Iron");
assert.equal(parse.groupNameFromTitle("(3) Cast Iron | Facebook"), "Cast Iron");
assert.equal(parse.groupNameFromTitle("Log in to Facebook"), "");

console.log("parse.test.js ok");
