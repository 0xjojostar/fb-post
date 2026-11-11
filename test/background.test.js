"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const posts = new Map([["555", { id: "555", groupId: "123", text: "Correct post", threadCaptureVersion: 2 }]]);
  const comments = new Map([["555", [{ id: "901", postId: "555", text: "Correct comment" }]]]);
  const groups = new Map([["123", { id: "123", status: "running" }]]);
  const job = {
    groupId: "123", mode: "full", phase: "feed", status: "running", paused: false,
    seenIds: [], pending: [], knownIds: [],
  };
  let postWrites = 0;
  let commentWrites = 0;
  globalThis.__dbMocks = {
    getGroup: async (id) => groups.get(id),
    getJob: async () => job,
    getPost: async (id) => posts.get(id),
    knownPostIds: async () => [],
    listJobs: async () => [job],
    putGroup: async (group) => groups.set(group.id, { ...group }),
    putJob: async () => {},
    putPost: async (post) => { postWrites += 1; posts.set(post.id, { ...post }); },
    replaceComments: async (id, rows) => { commentWrites += 1; comments.set(id, rows.map((row) => ({ ...row }))); },
  };
  globalThis.chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {},
    scripting: {},
  };

  let source = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
  source = source.replace(/import \{[\s\S]*?\} from "\.\/db\.js";/, "const { getGroup, getJob, getPost, knownPostIds, listJobs, putGroup, putJob, putPost, replaceComments } = globalThis.__dbMocks;");
  source += "\nexport { threadDone, savePost };";
  const mod = await import(`data:text/javascript,${encodeURIComponent(source)}`);

  await mod.savePost("123", { id: "555", url: "https://www.facebook.com/groups/123/posts/555", text: "Feed preview" });
  assert.equal(posts.get("555").text, "Correct post", "feed reread does not overwrite an archived post");
  assert.equal(postWrites, 0);

  const resetJob = () => {
    Object.assign(job, { phase: "threads", status: "running", paused: false, error: "", pending: [{ id: "555", url: "post" }] });
  };
  resetJob();
  await mod.threadDone({ groupId: "123", postId: "555", complete: false, post: { id: "555", text: "Bad" }, comments: [] });
  assert.equal(posts.get("555").text, "Correct post");
  assert.equal(comments.get("555")[0].text, "Correct comment");
  assert.equal(job.pending.length, 1);

  resetJob();
  await mod.threadDone({ groupId: "123", postId: "555", complete: true, post: { id: "999", text: "Wrong post" }, comments: [] });
  assert.equal(postWrites, 0);
  assert.equal(commentWrites, 0);

  resetJob();
  await mod.threadDone({ groupId: "123", postId: "555", complete: true, post: { id: "555", text: "No reported comments", commentCount: 0 }, comments: [] });
  assert.equal(comments.get("555")[0].text, "Correct comment", "an empty reread does not erase stored comments");
  assert.equal(commentWrites, 0);

  resetJob();
  const writesBeforeMissing = postWrites;
  await mod.threadDone({ groupId: "123", postId: "555", complete: true, post: { id: "555", text: "Empty", commentCount: 2 }, comments: [] });
  assert.equal(postWrites, writesBeforeMissing);
  assert.equal(commentWrites, 0);

  resetJob();
  await mod.threadDone({
    groupId: "123", postId: "555", complete: true,
    post: { id: "555", text: "Repaired", commentCount: 1 },
    comments: [{ id: "902", text: "Repaired comment" }],
  });
  assert.equal(posts.get("555").text, "Repaired");
  assert.equal(posts.get("555").threadCaptureVersion, 2);
  assert.equal(comments.get("555")[0].text, "Repaired comment");
  assert.equal(job.pending.length, 0);
  console.log("background.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
