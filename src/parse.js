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

function parseTimeLabel(raw, today) {
  const label = String(raw || "").replace(/\s+/g, " ").trim();
  if (!label) return { createdAt: null, approximate: true, label: "" };
  if (isRelativeTimeLabel(label)) {
    return { createdAt: null, approximate: true, label };
  }
  const absolute = absoluteDate(label, (today || localToday()).slice(0, 4));
  if (absolute) return { createdAt: absolute, approximate: false, label };
  return { createdAt: null, approximate: true, label };
}

function isRelativeTimeLabel(label) {
  return /^(just now|today|yesterday|an? (?:second|minute|hour|day) ago)\b/i.test(label)
    || /^\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/i.test(label);
}

function absoluteDate(label, currentYear) {
  const clockTime = clockSuffix(label);
  const monthFirst = label.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/);
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) {
    return stamp(monthFirst[3] || currentYear, MONTHS[monthFirst[1].toLowerCase()], monthFirst[2], clockTime);
  }
  const dayFirst = label.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\b/);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    return stamp(dayFirst[3] || currentYear, MONTHS[dayFirst[2].toLowerCase()], dayFirst[1], clockTime);
  }
  if (!/\d{4}/.test(label)) return null;
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
  if (isAllCommentsLabel(t)) return false;
  if (/^see more$/i.test(t)) return true;
  if (/^(?:more (?:comments?|repl(?:y|ies))|(?:view|see) (?:\d[\d,]* )?(?:more |previous )?(?:comments?|repl(?:y|ies))|\d[\d,]* (?:more )?(?:comments?|repl(?:y|ies)))$/i.test(t)) return true;
  return /(?:留言|評論|评论|回覆|回复)/.test(t) && /(?:查看|檢視|显示|顯示|載入|加载|更多|先前|之前|較早|更早|\d)/.test(t);
}

function isAllCommentsLabel(text) {
  return /^(?:all comments|所有留言|所有評論|所有评论)$/i.test(String(text || "").replace(/\s+/g, " ").trim());
}

function isCommentSortLabel(text) {
  return /^(?:most relevant|newest|最相關|最相关|最新)$/i.test(String(text || "").replace(/\s+/g, " ").trim());
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
  const cards = [...root.querySelectorAll('[data-ad-rendering-role="story_message"]')]
    .map((message) => message.closest("[data-virtualized]"))
    .filter((card, index, rows) => card && rows.indexOf(card) === index);
  if (cards.length) return cards;
  const articles = [];
  const links = [...root.querySelectorAll("a[href]")].filter((link) => isPostPermalink(link.getAttribute("href")));
  for (const link of links) {
    let article = link.closest('[role="article"]');
    if (article) {
      let parent = article.parentElement && article.parentElement.closest('[role="article"]');
      while (parent) {
        article = parent;
        parent = article.parentElement && article.parentElement.closest('[role="article"]');
      }
    } else {
      const id = postIdFromUrl(link.getAttribute("href"));
      article = link;
      while (article.parentElement) {
        const ids = [...article.parentElement.querySelectorAll("a[href]")]
          .filter((item) => isPostPermalink(item.getAttribute("href")))
          .map((item) => postIdFromUrl(item.getAttribute("href")));
        if (ids.some((other) => other !== id)) break;
        article = article.parentElement;
      }
    }
    if (!articles.includes(article)) articles.push(article);
  }
  return articles;
}

function articleForPost(root, postId) {
  const matches = topArticles(root).filter((article) => {
    return [...article.querySelectorAll("a[href]")].some((link) => {
      if (!belongsTo(article, link)) return false;
      return isPostPermalink(link.getAttribute("href"), postId);
    });
  });
  return matches.find((article) => !(article.parentElement && article.parentElement.closest('[role="article"]'))) || matches[0] || null;
}

function postFromArticle(article, groupId, pageUrl) {
  if (!article) return null;
  const link = findPostLink(article, groupId);
  const message = article.querySelector('[data-ad-rendering-role="story_message"]');
  if (!link && !message) return null;
  const id = link ? postIdFromUrl(link.getAttribute("href")) : feedPostId(article, groupId);
  const time = timeFromArticle(article, id);
  const author = findAuthor(article);
  const share = findShare(article, id);
  const base = pageUrl || (link && link.getAttribute("href"));
  return {
    id,
    groupId,
    url: link ? cleanPostUrl(link.getAttribute("href"), base) : "",
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

function commentsFromArticle(root, postId, groupId) {
  if (!root) return [];
  const seen = new Set();
  const rows = [];
  for (const node of root.querySelectorAll('[role="article"]')) {
    const meta = commentMeta(node, postId);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    rows.push({ node, ...meta });
  }
  const ids = new Map(rows.map((row) => [row.node, row.id]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.parentId === undefined) {
      const owner = row.node.parentElement && row.node.parentElement.closest('[role="article"]');
      row.parentId = ids.get(owner) || null;
    }
  }
  const depthOf = (row, trail = new Set()) => {
    if (!row.parentId) return 0;
    if (trail.has(row.id)) return 0;
    const parent = byId.get(row.parentId);
    return parent ? 1 + depthOf(parent, new Set([...trail, row.id])) : 1;
  };
  return rows.map((row, order) => {
    const node = row.node;
    const timeLink = timeLinkFor(node);
    const time = parseTimeLabel(
      (timeLink && (timeLink.getAttribute("aria-label") || ownText(timeLink))) || ""
    );
    const author = findAuthor(node);
    const base = timeLink ? timeLink.getAttribute("href") : "https://www.facebook.com/";
    return {
      id: row.id,
      postId,
      groupId,
      parentId: row.parentId,
      depth: depthOf(row),
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
    if (!belongsTo(article, link)) continue;
    if (postIdFromUrl(link.getAttribute("href")) !== postId) continue;
    push(link.getAttribute("aria-label"));
    push(labelledByText(link, article));
    push(link.textContent);
  }
  for (const node of article.querySelectorAll("[aria-labelledby]")) {
    if (belongsTo(article, node)) push(labelledByText(node, article));
  }
  for (const node of article.querySelectorAll("[aria-label], abbr, time")) {
    if (!belongsTo(article, node)) continue;
    push(node.getAttribute("aria-label"));
    if (node.tagName === "ABBR" || node.tagName === "TIME" || node.tag === "abbr" || node.tag === "time") push(node.textContent);
  }
  let fallback = null;
  for (const label of labels) {
    const time = parseTimeLabel(label);
    if (time.createdAt && !time.approximate) return time;
    if (!fallback && isRelativeTimeLabel(label)) fallback = time;
  }
  return fallback || { createdAt: null, approximate: true, label: "" };
}

function findPostLink(article, groupId) {
  const links = [...article.querySelectorAll("a[href]")].filter((link) => belongsTo(article, link));
  const ranked = links.filter((link) => {
    const href = link.getAttribute("href");
    if (!postIdFromUrl(href) || !/\/groups\/[^/]+\/(?:posts|permalink)\//.test(href || "")) return false;
    const group = groupFromUrl(link.getAttribute("href"));
    return !group || group.id === groupId;
  });
  const permalink = ranked.find((link) => isPostPermalink(link.getAttribute("href")));
  if (permalink) return permalink;
  if (!article.querySelector('[data-ad-rendering-role="story_message"]')) return null;
  return [...article.querySelectorAll("a[href]")].find((link) => {
    const href = link.getAttribute("href");
    return /\/groups\/[^/]+\/(?:posts|permalink)\//.test(href || "") && groupFromUrl(href)?.id === groupId;
  }) || null;
}

function isPostPermalink(href, postId) {
  let url;
  try {
    url = new URL(String(href), "https://www.facebook.com");
  } catch {
    return false;
  }
  if (url.searchParams.has("comment_id") || url.searchParams.has("reply_comment_id")) return false;
  if (!/\/groups\/[^/]+\/(?:posts|permalink)\//.test(url.pathname) && !url.searchParams.has("story_fbid")) return false;
  const id = postIdFromUrl(url.href);
  return Boolean(id && (postId === undefined || id === postId));
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
  const links = [...root.querySelectorAll("a[href]")].filter((link) => belongsTo(root, link));
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

function commentMeta(article, postId) {
  let fallback = null;
  for (const link of article.querySelectorAll("a[href]")) {
    if (link.closest('[role="article"]') !== article) continue;
    let url;
    try {
      url = new URL(link.getAttribute("href") || "", "https://www.facebook.com");
    } catch {
      continue;
    }
    if (postIdFromUrl(url.href) !== postId) continue;
    const commentId = url.searchParams.get("comment_id");
    const replyId = url.searchParams.get("reply_comment_id");
    if (replyId) return { id: replyId, parentId: commentId || null };
    if (commentId && !fallback) fallback = { id: commentId, parentId: undefined };
  }
  return fallback;
}

function timeLinkFor(article) {
  const links = [...article.querySelectorAll("a[href]")].filter((link) => link.closest('[role="article"]') === article);
  return links.find((link) => /reply_comment_id=/.test(link.getAttribute("href") || ""))
    || links.find((link) => /comment_id=/.test(link.getAttribute("href") || ""))
    || links.find((link) => link.getAttribute("aria-label")) || null;
}

function textOf(root) {
  const messages = [...root.querySelectorAll('[data-ad-rendering-role="story_message"]')]
    .filter((message) => message.closest("[data-virtualized]") === root);
  if (messages.length) return messages.map((message) => message.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const blocks = [...root.querySelectorAll('[dir="auto"]')].filter((el) => belongsTo(root, el));
  const leaves = blocks.filter((el) => {
    const link = el.closest("a[href]");
    if (link && isProfileHref(link.getAttribute("href"))) return false;
    return !blocks.some((other) => other !== el && el.contains(other));
  });
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
    if (!belongsTo(root, node)) continue;
    const label = node.getAttribute("aria-label") || "";
    const match = label.match(re);
    if (match) return Number(match[1].replace(/,/g, ""));
    if (word === "comment") {
      const localized = label.match(/(\d[\d,]*)\s*(?:則|条|個|个)?\s*(?:留言|評論|评论)/);
      if (localized) return Number(localized[1].replace(/,/g, ""));
    }
  }
  return null;
}

function outboundLinks(root, base) {
  const links = [];
  for (const link of root.querySelectorAll("a[href]")) {
    if (!belongsTo(root, link)) continue;
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
    if (!belongsTo(root, img)) continue;
    const alt = (img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    if (!alt || /^facebook$/i.test(alt) || alts.includes(alt)) continue;
    alts.push(alt);
  }
  return alts;
}

function belongsTo(root, node) {
  const article = node.closest('[role="article"]');
  return article ? article === root : root.contains(node);
}

function labelledByText(node, root) {
  if (!node) return "";
  const ids = (node.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (!ids.length) return "";
  const local = [...root.querySelectorAll("[id]")];
  return ids.map((id) => {
    const target = node.ownerDocument?.getElementById(id) || local.find((item) => item.getAttribute("id") === id);
    return target ? (target.getAttribute("aria-label") || target.textContent || "") : "";
  }).join(" ");
}

function feedPostId(article, groupId) {
  const message = article.querySelector('[data-ad-rendering-role="story_message"]');
  const author = findAuthor(article);
  // shortcut: identical permalink-free text by the same author shares an id, use Facebook's id if it returns to the DOM.
  const seed = `${groupId}\n${author.url}\n${message ? message.textContent : ""}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
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
  isAllCommentsLabel,
  isCommentSortLabel,
  isInterstitial,
  topArticles,
  articleForPost,
  postFromArticle,
  commentsFromArticle,
};

if (typeof module !== "undefined" && module.exports) module.exports = FBParse;
globalThis.FBParse = FBParse;
})();
