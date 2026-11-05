import { getGroup, getJob, listComments, listCommentsByGroup, listGroups, listPosts } from "./db.js";
import { commentsCsv, groupHtml, groupJson, groupMarkdown, insights, postsCsv, postsJsonl } from "./export.js";

const currentEl = document.querySelector("#current");
const progressEl = document.querySelector("#progress");
const groupsEl = document.querySelector("#groups");
const detailEl = document.querySelector("#detail");
const titleEl = document.querySelector("#detail-title");
const searchEl = document.querySelector("#search");
const insightsEl = document.querySelector("#insights");
const resultsEl = document.querySelector("#results");
const threadEl = document.querySelector("#thread");

let selectedId = "";
let signature = "";

document.querySelector("#download").addEventListener("click", () => command("START", "full"));
document.querySelector("#update").addEventListener("click", () => command("START", "update"));
document.querySelector("#pause").addEventListener("click", () => command("PAUSE"));
document.querySelector("#resume").addEventListener("click", () => command("RESUME"));
searchEl.addEventListener("input", () => renderResults());
document.querySelector("#exports").addEventListener("click", (event) => {
  const format = event.target?.dataset?.format;
  if (format) exportGroup(format);
});

chrome.storage.local.get("selectedGroupId").then((stored) => {
  if (stored.selectedGroupId) selectedId = stored.selectedGroupId;
  return refresh();
}).catch((err) => {
  progressEl.textContent = err.message || String(err);
});

setInterval(() => {
  refresh().catch((err) => {
    progressEl.textContent = err.message || String(err);
  });
}, 1000);

async function command(type, mode) {
  const since = document.querySelector("#since").value;
  const until = document.querySelector("#until").value;
  if (since && until && since > until) {
    progressEl.textContent = "From is after To.";
    return;
  }
  const message = { type, mode, since, until, groupId: selectedId };
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) progressEl.textContent = res?.error || "Something went wrong.";
  else if (res.groupId) selectGroup(res.groupId);
  await refresh();
}

async function refresh() {
  const tab = await activeGroupTab();
  const group = tab && groupFromTab(tab.url);
  currentEl.textContent = group ? `This tab: ${group.id}` : "Open a Facebook group to download it.";
  const groups = await listGroups();
  if (!selectedId && groups[0]) selectedId = groups[0].id;
  const jobs = [];
  for (const item of groups) jobs.push([item.id, await getJob(item.id), (await listPosts(item.id)).length]);
  const sig = JSON.stringify(jobs.map(([id, job, count]) => [id, job?.status, job?.phase, job?.seenIds?.length, job?.pending?.length, job?.error, count]));
  paintProgress(group, jobs);
  if (sig === signature) return;
  signature = sig;
  paintGroups(groups, jobs);
  if (selectedId) await renderDetail();
}

function paintProgress(group, jobs) {
  const id = group?.id || selectedId;
  const row = jobs.find(([groupId]) => groupId === id);
  const job = row?.[1];
  if (!job) return;
  if (job.error && job.status === "error") {
    progressEl.textContent = job.error;
    return;
  }
  const saved = job.seenIds?.length || 0;
  const left = job.pending?.length || 0;
  if (job.status === "paused") progressEl.textContent = `Paused. ${saved} posts saved this run, ${left} threads left.`;
  else if (job.status === "running" && job.phase === "feed") progressEl.textContent = `Reading the feed. ${saved} posts saved.`;
  else if (job.status === "running" && job.phase === "threads") progressEl.textContent = `Reading comments. ${left} threads left.`;
  else if (job.status === "done") progressEl.textContent = "Download finished.";
}

function paintGroups(groups, jobs) {
  groupsEl.replaceChildren();
  if (!groups.length) {
    const item = document.createElement("li");
    item.className = "meta";
    item.textContent = "Nothing saved yet.";
    groupsEl.append(item);
    detailEl.hidden = true;
    return;
  }
  for (const group of groups) {
    const count = jobs.find(([id]) => id === group.id)?.[2] || 0;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${group.name || group.id} · ${count} posts`;
    if (group.id === selectedId) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      selectGroup(group.id);
      renderDetail();
    });
    const item = document.createElement("li");
    item.append(button);
    groupsEl.append(item);
  }
}

function selectGroup(id) {
  selectedId = id;
  chrome.storage.local.set({ selectedGroupId: id });
  signature = "";
}

async function renderDetail() {
  const group = await getGroup(selectedId);
  if (!group) {
    detailEl.hidden = true;
    return;
  }
  detailEl.hidden = false;
  titleEl.textContent = group.name || group.id;
  await renderInsights();
  await renderResults();
}

async function renderInsights() {
  const posts = await listPosts(selectedId);
  const comments = await listCommentsByGroup(selectedId);
  const data = insights(posts, comments);
  insightsEl.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Insights";
  insightsEl.append(heading);
  const days = document.createElement("p");
  days.textContent = data.days.length
    ? "Busiest days: " + data.days.map(([day, count]) => `${day} (${count})`).join(", ")
    : "No absolute dates yet, so there is no timeline.";
  insightsEl.append(days);
  if (data.words.length) {
    const words = document.createElement("p");
    words.textContent = "Top words: " + data.words.map(([word, count]) => `${word} ${count}`).join(", ");
    insightsEl.append(words);
  }
  if (data.busiest.length) {
    const label = document.createElement("p");
    label.className = "meta";
    label.textContent = "Most comments";
    insightsEl.append(label);
    for (const post of data.busiest) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${post.authorName || "Unknown"} · ${post.commentCount || 0} comments`;
      button.addEventListener("click", () => showThread(post.id));
      insightsEl.append(button);
    }
  }
}

async function renderResults() {
  const posts = await listPosts(selectedId);
  const query = searchEl.value.trim().toLowerCase();
  resultsEl.replaceChildren();
  let shown = 0;
  for (const post of posts) {
    const comments = query ? await listComments(post.id) : [];
    if (query && !matches(post, comments, query)) continue;
    shown += 1;
    const button = document.createElement("button");
    button.type = "button";
    const preview = (post.text || post.sharedText || "No text").slice(0, 140);
    button.textContent = `${post.authorName || "Unknown"}: ${preview}`;
    button.addEventListener("click", () => showThread(post.id));
    const item = document.createElement("li");
    item.append(button);
    resultsEl.append(item);
    if (shown >= 50) break;
  }
  if (!shown) {
    const item = document.createElement("li");
    item.className = "meta";
    item.textContent = posts.length ? "No matches." : "No posts saved for this group.";
    resultsEl.append(item);
  }
}

// ponytail: loads every comment under a post while filtering. Fine until a group is tens of thousands of rows; then search in a worker.
function matches(post, comments, query) {
  if (!query) return true;
  const hay = [post.text, post.authorName, post.sharedText, ...comments.map((comment) => `${comment.authorName} ${comment.text}`)].join("\n").toLowerCase();
  return hay.includes(query);
}

async function showThread(postId) {
  const posts = await listPosts(selectedId);
  const post = posts.find((item) => item.id === postId);
  if (!post) return;
  const comments = await listComments(postId);
  threadEl.hidden = false;
  threadEl.replaceChildren();
  threadEl.append(line("h3", post.authorName || "Unknown"));
  threadEl.append(line("p", when(post), "meta"));
  if (post.url) {
    const link = document.createElement("a");
    link.href = post.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = post.url;
    threadEl.append(link);
  }
  if (post.text) threadEl.append(line("p", post.text));
  if (post.sharedText) {
    const quote = document.createElement("blockquote");
    quote.textContent = post.sharedText;
    threadEl.append(quote);
  }
  for (const alt of post.imageAlts || []) threadEl.append(line("p", `Photo: ${alt}`, "meta"));
  for (const comment of comments) {
    const block = document.createElement("div");
    block.className = "comment";
    block.style.marginLeft = `${(comment.depth || 0) * 12}px`;
    block.append(line("p", `${comment.authorName || "Unknown"} · ${when(comment)}`, "meta"));
    if (comment.text) block.append(line("p", comment.text));
    threadEl.append(block);
  }
  threadEl.scrollIntoView({ block: "nearest" });
}

async function exportGroup(format) {
  const group = await getGroup(selectedId);
  if (!group) return;
  const posts = await listPosts(selectedId);
  const comments = await listCommentsByGroup(selectedId);
  const base = safeName(group.name || group.id);
  if (format === "csv-posts") download(`${base}-posts.csv`, "text/csv", postsCsv(posts));
  else if (format === "csv-comments") download(`${base}-comments.csv`, "text/csv", commentsCsv(comments));
  else if (format === "json") download(`${base}.json`, "application/json", groupJson(group, posts, comments));
  else if (format === "jsonl") download(`${base}.jsonl`, "application/jsonl", postsJsonl(posts, comments));
  else if (format === "md") download(`${base}.md`, "text/markdown", groupMarkdown(group, posts, comments));
  else if (format === "html") download(`${base}.html`, "text/html", groupHtml(group, posts, comments));
}

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function line(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function when(row) {
  if (row.createdAt && !row.approximate) return row.createdAt.slice(0, 10);
  return row.createdLabel || "";
}

function safeName(name) {
  return String(name).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "group";
}

async function activeGroupTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];
  for (const query of queries) {
    const tabs = await chrome.tabs.query(query);
    for (const tab of tabs) {
      if (isGroupUrl(tab.url || "")) return tab;
    }
  }
  return null;
}

function groupFromTab(href) {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "groups" || !parts[1]) return null;
    const id = decodeURIComponent(parts[1]);
    if (["feed", "discover", "joins", "search"].includes(id)) return null;
    return { id };
  } catch {
    return null;
  }
}

function isGroupUrl(href) {
  return Boolean(groupFromTab(href));
}
