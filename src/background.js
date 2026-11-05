import {
  deletePost,
  getGroup,
  getJob,
  getPost,
  knownPostIds,
  listJobs,
  putGroup,
  putJob,
  putPost,
  replaceComments,
} from "./db.js";

const FB = globalThis.FBParse;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  });
  return true;
});

async function handle(msg, sender) {
  switch (msg.type) {
    case "START":
      return startJob(msg.mode, msg.since, msg.until);
    case "PAUSE":
      return pauseJob(msg.groupId);
    case "RESUME":
      return resumeJob(msg.groupId);
    case "HELLO":
      return hello(msg.url, msg.title, sender?.tab?.id);
    case "INTERRUPTED":
      return interrupted(sender?.tab?.id);
    case "NAME":
      return nameGroup(msg.groupId, msg.title);
    case "GET_JOB":
      return { ok: true, job: await getJob(msg.groupId) };
    case "SAVE_POST":
      return savePost(msg.groupId, msg.post);
    case "FEED_DONE":
      return feedDone(msg.groupId);
    case "THREAD_DONE":
      return threadDone(msg);
    case "THREADS_DONE":
      return threadsDone(msg.groupId);
    case "JOB_ERROR":
      return jobError(msg.groupId, msg.error);
    default:
      return { ok: false, error: "Unknown message" };
  }
}

async function startJob(mode, since, until) {
  const tab = await activeGroupTab();
  if (!tab) return { ok: false, error: "Open a Facebook group in this window first." };
  const group = groupFromUrl(tab.url);
  if (!group) return { ok: false, error: "Open a Facebook group in this window first." };
  const now = new Date().toISOString();
  const knownIds = mode === "update" ? await knownPostIds(group.id) : [];
  const existing = await getGroup(group.id);
  await putGroup({
    id: group.id,
    name: existing?.name && existing.name !== group.id ? existing.name : group.id,
    url: feedUrl(group.id, tab.url),
    status: "running",
    updatedAt: now,
  });
  const job = {
    groupId: group.id,
    since: since || "",
    until: until || "",
    mode: mode === "update" ? "update" : "full",
    phase: "feed",
    status: "running",
    paused: false,
    seenIds: [],
    pending: [],
    knownIds,
    error: "",
    tabId: tab.id,
    updatedAt: now,
  };
  await putJob(job);
  if (!isFeedUrl(tab.url, group.id)) {
    await chrome.tabs.update(tab.id, { url: feedUrl(group.id, tab.url) });
    return { ok: true, groupId: group.id };
  }
  await ensureScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: "RUN", job });
  return { ok: true, groupId: group.id };
}

async function pauseJob(groupId) {
  const id = groupId || (await activeGroupId());
  const job = id && await getJob(id);
  if (!job) return { ok: false, error: "Nothing is downloading." };
  job.paused = true;
  job.status = "paused";
  job.updatedAt = new Date().toISOString();
  await putJob(job);
  await updateGroupStatus(id, "paused");
  const tab = await tabForGroup(id);
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "PAUSE" }).catch(() => {});
  return { ok: true, groupId: id };
}

async function resumeJob(groupId) {
  const id = groupId || (await activeGroupId());
  const job = id && await getJob(id);
  if (!job) return { ok: false, error: "Nothing to resume." };
  if (job.status === "done" && !job.pending?.length) {
    return { ok: false, error: "This download finished. Use Update for new posts." };
  }
  job.paused = false;
  job.status = "running";
  job.error = "";
  if (job.pending?.length) job.phase = job.phase === "feed" ? "feed" : "threads";
  job.updatedAt = new Date().toISOString();
  const existingTab = await tabForGroup(id);
  const tab = existingTab || await chrome.tabs.create({ url: nextUrl(job) });
  job.tabId = tab.id;
  await putJob(job);
  await updateGroupStatus(id, "running");
  if (!existingTab) return { ok: true, groupId: id };
  const here = tab.url || "";
  const dest = nextUrl(job);
  if (samePath(here, dest)) {
    await ensureScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "RUN", job });
  } else {
    await chrome.tabs.update(tab.id, { url: dest });
  }
  return { ok: true, groupId: id };
}

function nextUrl(job) {
  if (job.phase === "threads" && job.pending?.length) return job.pending[0].url;
  return feedUrl(job.groupId, job.pending?.[0]?.url || "https://www.facebook.com/");
}

async function nameGroup(groupId, title) {
  const name = groupNameFromTitle(title);
  if (!name) return { ok: true };
  const group = await getGroup(groupId);
  if (!group || (group.name && group.name !== group.id)) return { ok: true };
  group.name = name;
  group.updatedAt = new Date().toISOString();
  await putGroup(group);
  return { ok: true };
}

async function hello(url, title, tabId) {
  const group = groupFromUrl(url);
  if (!group) return { ok: true, run: false };
  const name = groupNameFromTitle(title);
  const stored = await getGroup(group.id);
  if (stored && name && (stored.name === stored.id || !stored.name)) {
    stored.name = name;
    stored.updatedAt = new Date().toISOString();
    await putGroup(stored);
  }
  const job = await getJob(group.id);
  if (job && tabId && job.tabId !== tabId && !(await tabExists(job.tabId))) {
    job.tabId = tabId;
    await putJob(job);
  }
  if (!job || job.status !== "running" || job.paused) return { ok: true, run: false, job: job || null };
  if (job.tabId && tabId && job.tabId !== tabId) return { ok: true, run: false, job };
  return { ok: true, run: true, job };
}

async function interrupted(tabId) {
  const jobs = await listJobs();
  for (const job of jobs) {
    if (job.status === "running" && !job.paused && job.tabId === tabId) {
      await jobError(job.groupId, "Facebook interrupted the session. Resume after you can open the group normally.");
    }
  }
  return { ok: true };
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function savePost(groupId, post) {
  const job = await getJob(groupId);
  if (!job) return { ok: false, error: "No download is running." };
  if (job.mode === "update" && (job.knownIds || []).includes(post.id)) {
    return { ok: true, stopFeed: true };
  }
  const existing = await getPost(post.id);
  const merged = mergePost(existing, post, "feed");
  await putPost(merged);
  if (!job.seenIds.includes(post.id)) job.seenIds.push(post.id);
  if (!job.pending.some((item) => item.id === post.id)) job.pending.push({ id: post.id, url: post.url });
  job.updatedAt = new Date().toISOString();
  await putJob(job);
  await touchGroup(groupId);
  return { ok: true, stopFeed: false };
}

async function feedDone(groupId) {
  const job = await getJob(groupId);
  if (!job) return { ok: false, error: "No download is running." };
  if (job.paused) return { ok: true, nextUrl: null };
  job.phase = job.pending.length ? "threads" : "done";
  job.status = job.pending.length ? "running" : "done";
  job.updatedAt = new Date().toISOString();
  await putJob(job);
  await updateGroupStatus(groupId, job.status);
  return { ok: true, nextUrl: job.pending[0]?.url || null };
}

async function threadDone(msg) {
  const job = await getJob(msg.groupId);
  if (!job) return { ok: false, error: "No download is running." };
  if (msg.newer) {
    await deletePost(msg.postId);
    job.pending = (job.pending || []).filter((item) => item.id !== msg.postId);
    job.updatedAt = new Date().toISOString();
    if (!job.pending.length) {
      job.phase = "done";
      job.status = "done";
    }
    await putJob(job);
    if (job.status === "done") await updateGroupStatus(msg.groupId, "done");
    if (job.paused || job.status !== "running") return { ok: true, nextUrl: null };
    return { ok: true, nextUrl: job.pending[0]?.url || null };
  }
  if (msg.older) {
    await deletePost(msg.postId);
    job.pending = [];
    job.phase = "done";
    job.status = "done";
    job.updatedAt = new Date().toISOString();
    await putJob(job);
    await updateGroupStatus(msg.groupId, "done");
    return { ok: true, nextUrl: null };
  }
  if (msg.post) {
    const existing = await getPost(msg.post.id);
    const comments = Array.isArray(msg.comments) ? msg.comments : [];
    const post = mergePost(existing, msg.post, "threads");
    if (comments.length && (post.commentCount == null || post.commentCount < comments.length)) {
      post.commentCount = comments.length;
    }
    await putPost(post);
    await replaceComments(post.id, comments.map((comment) => ({ ...comment, postId: post.id, groupId: msg.groupId })));
  }
  job.pending = (job.pending || []).filter((item) => item.id !== msg.postId);
  job.updatedAt = new Date().toISOString();
  if (!job.pending.length) {
    job.phase = "done";
    job.status = "done";
  }
  await putJob(job);
  await touchGroup(msg.groupId);
  if (job.status === "done") await updateGroupStatus(msg.groupId, "done");
  if (job.paused || job.status !== "running") return { ok: true, nextUrl: null };
  return { ok: true, nextUrl: job.pending[0]?.url || null };
}

async function threadsDone(groupId) {
  const job = await getJob(groupId);
  if (!job) return { ok: false };
  job.phase = "done";
  job.status = "done";
  job.updatedAt = new Date().toISOString();
  await putJob(job);
  await updateGroupStatus(groupId, "done");
  return { ok: true };
}

async function jobError(groupId, error) {
  const job = await getJob(groupId);
  if (!job) return { ok: false };
  job.status = "error";
  job.error = error || "Facebook interrupted the session.";
  job.paused = true;
  job.updatedAt = new Date().toISOString();
  await putJob(job);
  await updateGroupStatus(groupId, "error");
  return { ok: true };
}

function mergePost(existing, incoming, phase) {
  if (!existing) return { ...incoming };
  const keepFeedText = phase === "feed" && existing.text && existing.text.length > (incoming.text || "").length;
  return {
    ...existing,
    ...incoming,
    text: keepFeedText ? existing.text : (incoming.text || existing.text || ""),
    sharedText: incoming.sharedText || existing.sharedText || "",
    links: incoming.links?.length ? incoming.links : (existing.links || []),
    imageAlts: incoming.imageAlts?.length ? incoming.imageAlts : (existing.imageAlts || []),
    reactionCount: incoming.reactionCount ?? existing.reactionCount,
    commentCount: incoming.commentCount ?? existing.commentCount,
    createdAt: !incoming.approximate && incoming.createdAt ? incoming.createdAt : (existing.createdAt || incoming.createdAt),
    createdLabel: incoming.createdLabel || existing.createdLabel || "",
    approximate: !incoming.approximate && incoming.createdAt ? false : existing.approximate,
    authorName: incoming.authorName || existing.authorName,
    authorUrl: incoming.authorUrl || existing.authorUrl,
  };
}

async function touchGroup(groupId) {
  const group = await getGroup(groupId);
  if (!group) return;
  group.updatedAt = new Date().toISOString();
  await putGroup(group);
}

async function updateGroupStatus(groupId, status) {
  const group = await getGroup(groupId);
  if (!group) return;
  group.status = status;
  group.updatedAt = new Date().toISOString();
  await putGroup(group);
}

async function activeGroupTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];
  for (const query of queries) {
    const tabs = await chrome.tabs.query(query);
    for (const tab of tabs) {
      if (groupFromUrl(tab.url || "")) return tab;
    }
  }
  const all = await chrome.tabs.query({
    url: ["https://www.facebook.com/groups/*", "https://web.facebook.com/groups/*"],
  });
  return all.find((tab) => tab.active) || all[0] || null;
}

async function activeGroupId() {
  const tab = await activeGroupTab();
  return tab ? groupFromUrl(tab.url)?.id : null;
}

async function tabForGroup(groupId) {
  const tabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/groups/*", "https://web.facebook.com/groups/*"],
  });
  return tabs.find((tab) => groupFromUrl(tab.url || "")?.id === groupId) || null;
}

async function ensureScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (pong?.ok) return;
  } catch { /* inject below */ }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/parse.js", "src/content.js"],
  });
}

function groupFromUrl(href) {
  return FB?.groupFromUrl ? FB.groupFromUrl(href) : fallbackGroup(href);
}

function isFeedUrl(href, groupId) {
  return FB?.isFeedUrl ? FB.isFeedUrl(href, groupId) : fallbackIsFeed(href, groupId);
}

function feedUrl(groupId, href) {
  return FB?.feedUrl ? FB.feedUrl(groupId, href) : fallbackFeed(groupId, href);
}

function groupNameFromTitle(title) {
  if (FB?.groupNameFromTitle) return FB.groupNameFromTitle(title);
  const cleaned = String(title || "").replace(/^\(\d+\+?\)\s*/, "").replace(/\s*\|\s*Facebook\s*$/i, "").trim();
  if (!cleaned || /^facebook$/i.test(cleaned) || /log\s*in/i.test(cleaned)) return "";
  return cleaned;
}

function samePath(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function fallbackGroup(href) {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "groups" || !parts[1] || ["feed", "discover", "joins", "search"].includes(parts[1])) return null;
    return { id: decodeURIComponent(parts[1]) };
  } catch {
    return null;
  }
}

function fallbackIsFeed(href, groupId) {
  const group = fallbackGroup(href);
  if (!group || group.id !== groupId) return false;
  try {
    return new URL(href).pathname.split("/").filter(Boolean).length === 2;
  } catch {
    return false;
  }
}

function fallbackFeed(groupId, href) {
  let origin = "https://www.facebook.com";
  try { origin = new URL(href).origin; } catch { /* default */ }
  return `${origin}/groups/${encodeURIComponent(groupId)}`;
}
