"use strict";

(function () {
if (globalThis.__FB_ARCHIVE_LOADED) return;
globalThis.__FB_ARCHIVE_LOADED = true;

const PACE_MS = 2000;
const FB = globalThis.FBParse;

let started = false;
let pauseRequested = false;
let queuedJob = null;
let idleRounds = 0;
let lastSig = null;
let threadMisses = 0;
const gotoAttempts = new Map();
const clicked = new WeakSet();

function bind() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true, running: started, href: location.href });
      return;
    }
    if (msg.type === "PAUSE") {
      pauseRequested = true;
      queuedJob = null;
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "RUN") {
      pauseRequested = false;
      maybeStart(msg.job);
      sendResponse({ ok: true });
    }
  });
}

async function hello() {
  if (FB.isInterstitial(document)) {
    await send({ type: "INTERRUPTED" });
    return;
  }
  const res = await send({ type: "HELLO", url: location.href, title: document.title });
  if (res?.run) maybeStart(res.job);
}

function maybeStart(job) {
  if (!job || job.status !== "running" || job.paused) return;
  if (FB.groupFromUrl(location.href)?.id !== job.groupId) return;
  if (started) {
    queuedJob = job;
    return;
  }
  started = true;
  pauseRequested = false;
  idleRounds = 0;
  lastSig = null;
  threadMisses = 0;
  runJob(job).finally(() => {
    started = false;
    const next = queuedJob;
    queuedJob = null;
    if (next) maybeStart(next);
  });
}

async function runJob(initial) {
  await send({ type: "NAME", groupId: initial.groupId, title: document.title });
  let job = initial;
  while (!pauseRequested) {
    const fresh = await send({ type: "GET_JOB", groupId: job.groupId });
    job = fresh?.job;
    if (!job || job.paused || job.status !== "running") return;
    if (FB.isInterstitial(document)) {
      await send({
        type: "JOB_ERROR",
        groupId: job.groupId,
        error: "Facebook interrupted the session. Resume after you can open the group normally.",
      });
      return;
    }
    if (job.phase === "feed") {
      const step = await feedStep(job);
      if (step === "paused") return;
      if (step === "done") {
        const res = await send({ type: "FEED_DONE", groupId: job.groupId });
        if (res?.nextUrl) await goto(res.nextUrl);
        continue;
      }
      continue;
    }
    if (job.phase === "threads") {
      const next = job.pending?.[0];
      if (!next) {
        await send({ type: "THREADS_DONE", groupId: job.groupId });
        return;
      }
      if (FB.postIdFromUrl(location.href) !== next.id) {
        const attempts = (gotoAttempts.get(next.id) || 0) + 1;
        gotoAttempts.set(next.id, attempts);
        if (attempts > 3) {
          await send({
            type: "JOB_ERROR",
            groupId: job.groupId,
            error: "Could not open that post. Resume after the group page loads.",
          });
          return;
        }
        await goto(next.url);
        continue;
      }
      const saved = await readThread(job, next);
      if (saved === "paused") return;
      if (saved === "miss") continue;
      const res = await send({
        type: "THREAD_DONE",
        groupId: job.groupId,
        postId: next.id,
        post: saved.post,
        comments: saved.comments,
        older: saved.older === true,
        newer: saved.newer === true,
      });
      threadMisses = 0;
      if (res?.nextUrl) await goto(res.nextUrl);
      else return;
    }
  }
}

async function feedStep(job) {
  if (!FB.isFeedUrl(location.href, job.groupId)) {
    await goto(FB.feedUrl(job.groupId, location.href));
    return pauseRequested ? "paused" : "continue";
  }
  clickSeeMores(document);
  const known = new Set(job.knownIds || []);
  const seen = new Set(job.seenIds || []);
  let stop = false;
  for (const article of FB.topArticles(document)) {
    if (pauseRequested) return "paused";
    const post = FB.postFromArticle(article, job.groupId, location.href);
    if (!post) continue;
    if (job.mode === "update" && known.has(post.id)) {
      stop = true;
      break;
    }
    if (seen.has(post.id)) continue;
    if (FB.isNewerThan(post, job.until)) continue;
    if (FB.isOlderThan(post, job.since)) {
      stop = true;
      break;
    }
    const saved = await send({ type: "SAVE_POST", groupId: job.groupId, post });
    if (!saved?.ok) {
      await send({ type: "JOB_ERROR", groupId: job.groupId, error: saved?.error || "Could not save a post." });
      return "paused";
    }
    seen.add(post.id);
    if (saved.stopFeed) {
      stop = true;
      break;
    }
  }
  if (stop) return "done";

  const ids = FB.topArticles(document)
    .map((article) => FB.postFromArticle(article, job.groupId, location.href)?.id)
    .filter(Boolean);
  const sig = ids.join(",");
  // ponytail: end of feed is "the visible post ids did not change for 6 scrolls". A slow load can look finished; Resume continues.
  if (lastSig !== null && sig === lastSig) idleRounds += 1;
  else idleRounds = 0;
  lastSig = sig;
  if (idleRounds >= 6) return "done";

  scrollFeed();
  const kept = await pace();
  return kept ? "continue" : "paused";
}

async function readThread(job, next) {
  if (pauseRequested) return "paused";
  if (FB.postIdFromUrl(location.href) !== next.id) return "miss";
  let article = FB.articleForPost(document, next.id);
  if (!article) {
    threadMisses += 1;
    if (threadMisses >= 3) {
      await send({
        type: "JOB_ERROR",
        groupId: job.groupId,
        error: "Could not read that post. Facebook may have changed the page, or the post did not load.",
      });
      return "paused";
    }
    await pace();
    return "miss";
  }
  let post = FB.postFromArticle(article, job.groupId, location.href);
  if (post && FB.isNewerThan(post, job.until)) return { newer: true };
  if (post && FB.isOlderThan(post, job.since)) return { older: true };
  await expandThread();
  if (pauseRequested) return "paused";
  article = FB.articleForPost(document, next.id) || article;
  post = FB.postFromArticle(article, job.groupId, location.href) || post;
  if (post && FB.isNewerThan(post, job.until)) return { newer: true };
  if (post && FB.isOlderThan(post, job.since)) return { older: true };
  const comments = FB.commentsFromArticle(article, next.id, job.groupId);
  return { post, comments };
}

function clickSeeMores(root) {
  for (const button of findExpandButtons(root)) {
    if (!/^see more$/i.test(labelOf(button))) continue;
    if (clicked.has(button)) continue;
    clicked.add(button);
    button.click();
  }
}

// ponytail: stops after 40 expansions per thread so a button that never disappears cannot spin.
async function expandThread() {
  let clicks = 0;
  while (clicks < 40) {
    if (pauseRequested) return;
    const buttons = findExpandButtons(document).filter((button) => !clicked.has(button));
    if (!buttons.length) return;
    const button = buttons[0];
    clicked.add(button);
    button.click();
    clicks += 1;
    const kept = await pace();
    if (!kept) return;
  }
}

function findExpandButtons(root) {
  return [...root.querySelectorAll('[role="button"]')].filter((el) => {
    if (el.closest('[contenteditable="true"]')) return false;
    return FB.isExpandLabel(labelOf(el));
  });
}

function labelOf(el) {
  const text = (el.innerText || "").replace(/\s+/g, " ").trim();
  if (text && text.length <= 80) return text;
  return (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
}

function scrollFeed() {
  const articles = FB.topArticles(document);
  const last = articles[articles.length - 1];
  if (last?.scrollIntoView) last.scrollIntoView({ block: "end", behavior: "auto" });
  let node = last?.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 20) {
      node.scrollTop += Math.max(400, node.clientHeight * 0.8);
      return;
    }
    node = node.parentElement;
  }
  window.scrollBy(0, Math.max(500, window.innerHeight || 800) * 0.8);
}

async function goto(url) {
  const target = new URL(url, location.href);
  const here = new URL(location.href);
  if (here.origin === target.origin && here.pathname === target.pathname && here.search === target.search) return;
  location.assign(target.href);
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (pauseRequested) return;
    const now = new URL(location.href);
    const pathOk = now.pathname === target.pathname;
    if (pathOk && document.querySelector('[role="article"]')) {
      await sleep(500);
      return;
    }
    await sleep(300);
  }
}

async function pace() {
  const step = 200;
  for (let waited = 0; waited < PACE_MS; waited += step) {
    if (pauseRequested) return false;
    await sleep(step);
  }
  return !pauseRequested;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch((err) => ({ ok: false, error: String(err) }));
}

bind();
hello();
})();
