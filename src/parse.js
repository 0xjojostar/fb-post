"use strict";

(function () {
// DOM-fragile extractors. When Facebook reshapes the group page, change this file only.
// Reads role, dir, aria-label, and post URLs. No CSS class names.

const RESERVED_GROUPS = new Set(["feed", "discover", "joins", "search"]);

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08",
  sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

const INTERRUPT = [
  "you're temporarily blocked",
  "you’re temporarily blocked",
  "help us confirm it's you",
  "help us confirm it’s you",
  "we suspect automated behavior",
  "please slow down",
  "try again later",
  "confirm your identity",
  "security check",
];

function groupFromUrl(href) {
  let url;
  try {
    url = new URL(href, "https://www.facebook.com");
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "groups" || !parts[1]) return null;
  const id = decodeURIComponent(parts[1]);
  if (RESERVED_GROUPS.has(id)) return null;
  return { id, url: `${url.origin}/groups/${encodeURIComponent(id)}` };
}

function isFeedUrl(href, groupId) {
  let url;
  try {
    url = new URL(href, "https://www.facebook.com");
  } catch {
    return false;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "groups") return false;
  if (decodeURIComponent(parts[1] || "") !== groupId) return false;
  return parts.length === 2;
}

function feedUrl(groupId, href) {
  let origin = "https://www.facebook.com";
  try {
    origin = new URL(href).origin;
  } catch { /* keep default */ }
  return `${origin}/groups/${encodeURIComponent(groupId)}`;
}

function postIdFromUrl(href) {
  let url;
  try {
    url = new URL(String(href), "https://www.facebook.com");
  } catch {
    return null;
  }
  const match = url.pathname.match(/\/groups\/[^/]+\/(?:posts|permalink)\/([^/]+)/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (id && id !== "edit") return id;
  }
  return url.searchParams.get("story_fbid") || url.searchParams.get("fbid") || null;
}

function groupNameFromTitle(title) {
  const cleaned = String(title || "")
    .replace(/^\(\d+\+?\)\s*/, "")
    .replace(/\s*\|\s*Facebook\s*$/i, "")
    .trim();
  if (!cleaned || /^facebook$/i.test(cleaned) || /log\s*in/i.test(cleaned)) return "";
  return cleaned;
}

function parseTimeLabel(raw) {
  const label = String(raw || "").replace(/\s+/g, " ").trim();
  if (!label) return { createdAt: null, approximate: true, label: "" };
  if (/^(just now|today|yesterday)\b/i.test(label)) {
    return { createdAt: null, approximate: true, label };
  }
  if (/^\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/i.test(label)) {
    return { createdAt: null, approximate: true, label };
  }
  const absolute = absoluteDate(label);
  if (absolute) return { createdAt: absolute, approximate: false, label };
  return { createdAt: null, approximate: true, label };
}

function absoluteDate(label) {
  if (!/\d{4}/.test(label)) return null;
  const clockTime = clockSuffix(label);
  const monthFirst = label.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) {
    return stamp(monthFirst[3], MONTHS[monthFirst[1].toLowerCase()], monthFirst[2], clockTime);
  }
  const dayFirst = label.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    return stamp(dayFirst[3], MONTHS[dayFirst[2].toLowerCase()], dayFirst[1], clockTime);
  }
  const numeric = label.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (numeric) return stamp(numeric[1], numeric[2], numeric[3], clockTime);
  const parsed = Date.parse(label);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function stamp(year, month, day, clockTime) {
  const dd = String(day).padStart(2, "0");
  return `${year}-${month}-${dd}T${clockTime || "00:00:00.000Z"}`;
}

function clockSuffix(label) {
  const match = label.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2];
  const second = match[3] || "00";
  const ap = (match[4] || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  if (hour > 23 || Number(minute) > 59) return null;
  return `${String(hour).padStart(2, "0")}:${minute}:${second}.000Z`;
}

function isOlderThan(post, since) {
  if (!since || !post || !post.createdAt || post.approximate) return false;
  return post.createdAt.slice(0, 10) < since;
}

function isNewerThan(post, until, today) {
  if (!until || !post) return false;
  if (post.createdAt && !post.approximate) return post.createdAt.slice(0, 10) > until;
  if (post.approximate) return until < (today || localToday());
  return false;
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isExpandLabel(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return false;
  if (/^see more$/i.test(t)) return true;
  if (/^(view more comments|view previous comments|view more replies|view replies|more comments|more replies)$/i.test(t)) {
    return true;
  }
  if (/^view \d[\d,]* (more )?(comments|replies)$/i.test(t)) return true;
  if (/^(see )?\d[\d,]* more comments$/i.test(t)) return true;
  return false;
}

function isInterstitial(doc) {
  const title = String(doc.title || "").toLowerCase();
  const href = doc.URL || doc.location?.href || "";
  if (/log in|login/.test(title) && !groupFromUrl(href)) return true;
  const dialogs = doc.querySelectorAll ? [...doc.querySelectorAll('[role="dialog"]')] : [];
  const dialogText = dialogs.map((d) => d.innerText || d.textContent || "").join("\n").toLowerCase();
  if (INTERRUPT.some((phrase) => dialogText.includes(phrase))) return true;
  const bodyText = String(doc.body?.innerText || doc.body?.textContent || "").slice(0, 1500).toLowerCase();
  if (bodyText.length < 800 && INTERRUPT.some((phrase) => bodyText.includes(phrase))) return true;
  return false;
}

function topArticles(root) {
  return [...root.querySelectorAll('[role="article"]')].filter((el) => {
    const parent = el.parentElement && el.parentElement.closest('[role="article"]');
    return !parent;
  });
}

function articleForPost(root, postId) {
  const matches = [...root.querySelectorAll('[role="article"]')].filter((article) => {
    return [...article.querySelectorAll("a[href]")].some((link) => {
      if (link.closest('[role="article"]') !== article) return false;
      return postIdFromUrl(link.getAttribute("href")) === postId;
    });
  });
  return matches.find((article) => !(article.parentElement && article.parentElement.closest('[role="article"]'))) || matches[0] || null;
}

function postFromArticle(article, groupId, pageUrl) {
  if (!article) return null;
  const link = findPostLink(article, groupId);
  if (!link) return null;
  const id = postIdFromUrl(link.getAttribute("href"));
  if (!id) return null;
  const time = timeFromArticle(article, id);
  const author = findAuthor(article);
  const share = findShare(article, id);
  const base = pageUrl || link.getAttribute("href");
  return {
    id,
    groupId,
    url: cleanPostUrl(link.getAttribute("href"), base),
    authorName: author.name,
    authorUrl: author.url ? absUrl(author.url, base) : "",
    createdAt: time.createdAt,
    createdLabel: time.label,
    approximate: time.approximate,
    text: textOf(article),
    reactionCount: findCount(article, "reaction"),
    commentCount: findCount(article, "comment"),
    links: outboundLinks(article, base),
    sharedText: share ? textOf(share) : "",
    imageAlts: imageAlts(article),
  };
}

function commentsFromArticle(postEl, postId, groupId) {
  if (!postEl) return [];
  const shares = [...postEl.querySelectorAll('[role="article"]')].filter((node) => isShare(node, postId));
  const nodes = [...postEl.querySelectorAll('[role="article"]')].filter((node) => {
    return !shares.some((share) => share === node || share.contains(node));
  });
  const ids = new Map();
  nodes.forEach((node, order) => {
    ids.set(node, explicitCommentId(node) || `${postId}:${order}`);
  });
  return nodes.map((node, order) => {
    const owner = node.parentElement && node.parentElement.closest('[role="article"]');
    const parentId = owner && owner !== postEl && ids.has(owner) ? ids.get(owner) : null;
    let depth = 0;
    let cursor = owner;
    while (cursor && cursor !== postEl) {
      if (ids.has(cursor)) depth += 1;
      cursor = cursor.parentElement && cursor.parentElement.closest('[role="article"]');
    }
    const timeLink = timeLinkFor(node);
    const time = parseTimeLabel(
      (timeLink && (timeLink.getAttribute("aria-label") || ownText(timeLink))) || ""
    );
    const author = findAuthor(node);
    const base = timeLink ? timeLink.getAttribute("href") : "https://www.facebook.com/";
    return {
      id: ids.get(node),
      postId,
      groupId,
      parentId,
      depth,
      order,
      authorName: author.name,
      authorUrl: author.url ? absUrl(author.url, base) : "",
      createdAt: time.createdAt,
      createdLabel: time.label,
      approximate: time.approximate,
      text: textOf(node),
      reactionCount: findCount(node, "reaction"),
    };
  });
}

function timeFromArticle(article, postId) {
  const labels = [];
  const push = (value) => {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    if (label && label.length <= 120 && !labels.includes(label)) labels.push(label);
  };
  for (const link of article.querySelectorAll("a[href]")) {
    if (link.closest('[role="article"]') !== article) continue;
    if (postIdFromUrl(link.getAttribute("href")) !== postId) continue;
    push(link.getAttribute("aria-label"));
    push(link.textContent);
  }
  for (const node of article.querySelectorAll("[aria-label], abbr, time")) {
    if (node.closest('[role="article"]') !== article) continue;
    push(node.getAttribute("aria-label"));
    if (node.tagName === "ABBR" || node.tagName === "TIME" || node.tag === "abbr" || node.tag === "time") push(node.textContent);
  }
  let fallback = null;
  for (const label of labels) {
    const time = parseTimeLabel(label);
    if (time.createdAt && !time.approximate) return time;
    if (!fallback && time.label) fallback = time;
  }
  return fallback || { createdAt: null, approximate: true, label: "" };
}

function findPostLink(article, groupId) {
  const links = [...article.querySelectorAll("a[href]")].filter((link) => link.closest('[role="article"]') === article);
  const ranked = links.filter((link) => {
    const id = postIdFromUrl(link.getAttribute("href"));
    if (!id) return false;
    const group = groupFromUrl(link.getAttribute("href"));
    return !group || group.id === groupId;
  });
  return ranked[0] || null;
}

function findShare(article, postId) {
  return [...article.querySelectorAll('[role="article"]')].find((node) => isShare(node, postId)) || null;
}

function isShare(article, postId) {
  return [...article.querySelectorAll("a[href]")].some((link) => {
    if (link.closest('[role="article"]') !== article) return false;
    const id = postIdFromUrl(link.getAttribute("href"));
    return id && id !== postId;
  });
}

function findAuthor(root) {
  const links = [...root.querySelectorAll("a[href]")].filter((link) => link.closest('[role="article"]') === root);
  for (const link of links) {
    if (!isProfileHref(link.getAttribute("href"))) continue;
    const name = (ownText(link) || link.textContent || "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) continue;
    return { name, url: link.getAttribute("href") };
  }
  return { name: "", url: "" };
}

function isProfileHref(href) {
  if (!href || postIdFromUrl(href)) return false;
  if (/comment_id=/.test(href)) return false;
  if (/\/(posts|permalink|photos|videos|watch|reel|hashtag)\//.test(href)) return false;
  return /facebook\.com\/|\/user\/|profile\.php/i.test(href);
}

function explicitCommentId(article) {
  for (const link of article.querySelectorAll("a[href]")) {
    if (link.closest('[role="article"]') !== article) continue;
    const href = link.getAttribute("href") || "";
    const match = href.match(/[?&]comment_id=([^&#]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function timeLinkFor(article) {
  const links = [...article.querySelectorAll("a[href]")].filter((link) => link.closest('[role="article"]') === article);
  return links.find((link) => /comment_id=/.test(link.getAttribute("href") || "")) || links.find((link) => link.getAttribute("aria-label")) || null;
}

function textOf(root) {
  const blocks = [...root.querySelectorAll('[dir="auto"]')].filter((el) => el.closest('[role="article"]') === root);
  const leaves = blocks.filter((el) => !blocks.some((other) => other !== el && el.contains(other)));
  const parts = [];
  for (const el of leaves) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join("\n");
}

function findCount(root, word) {
  const re = new RegExp("(\\d[\\d,]*)\\s+" + word + "s?", "i");
  for (const node of root.querySelectorAll("[aria-label]")) {
    if (node.closest('[role="article"]') !== root) continue;
    const label = node.getAttribute("aria-label") || "";
    const match = label.match(re);
    if (match) return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

function outboundLinks(root, base) {
  const links = [];
  for (const link of root.querySelectorAll("a[href]")) {
    if (link.closest('[role="article"]') !== root) continue;
    const href = link.getAttribute("href") || "";
    if (!/^https?:/i.test(href) && !href.startsWith("/")) continue;
    if (isProfileHref(href) || postIdFromUrl(href) || /comment_id=/.test(href)) continue;
    let abs;
    let host = "";
    try {
      abs = absUrl(href, base);
      host = new URL(abs).hostname;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    const facebook = /(^|\.)facebook\.com$/i.test(host);
    const externalHop = /(^|\.)l\.facebook\.com$/i.test(host) || host === "lm.facebook.com";
    if (facebook && !externalHop) continue;
    if (!links.includes(abs)) links.push(abs);
  }
  return links;
}

function imageAlts(root) {
  const alts = [];
  for (const img of root.querySelectorAll("img[alt]")) {
    if (img.closest('[role="article"]') !== root) continue;
    const alt = (img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    if (!alt || /^facebook$/i.test(alt) || alts.includes(alt)) continue;
    alts.push(alt);
  }
  return alts;
}

function ownText(el) {
  let text = "";
  for (const node of el.childNodes || []) {
    if (node.nodeType === 3) text += node.nodeValue || "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function absUrl(href, base) {
  try {
    return new URL(href, base || "https://www.facebook.com").href;
  } catch {
    return href || "";
  }
}

function cleanPostUrl(href, base) {
  const url = new URL(href, base || "https://www.facebook.com");
  url.hash = "";
  [...url.searchParams.keys()].forEach((key) => {
    if (key === "comment_id" || key === "reply_comment_id" || key.startsWith("__")) url.searchParams.delete(key);
  });
  return url.href;
}

const FBParse = {
  groupFromUrl,
  isFeedUrl,
  feedUrl,
  postIdFromUrl,
  groupNameFromTitle,
  parseTimeLabel,
  isOlderThan,
  isNewerThan,
  isExpandLabel,
  isInterstitial,
  topArticles,
  articleForPost,
  postFromArticle,
  commentsFromArticle,
};

if (typeof module !== "undefined" && module.exports) module.exports = FBParse;
globalThis.FBParse = FBParse;
})();
