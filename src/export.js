// ponytail: English stop list only. Other languages will rank common words; drop the list or swap in a locale list if that shows up.

const STOP = new Set(
  "this that with from your have about they them were been into just like more some what when will would group facebook post comment posts comments their there which while after before could should because".split(" ")
);

export function postsCsv(posts) {
  const header = [
    "id", "groupId", "url", "authorName", "authorUrl", "createdAt", "createdLabel", "approximate",
    "text", "reactionCount", "commentCount", "links", "sharedText", "imageAlts",
  ];
  return toCsv(header, posts.map((post) => header.map((key) => post[key])));
}

export function commentsCsv(comments) {
  const header = [
    "id", "postId", "groupId", "parentId", "depth", "order", "authorName", "authorUrl",
    "createdAt", "createdLabel", "approximate", "text", "reactionCount",
  ];
  const sorted = [...comments].sort((a, b) => (a.postId || "").localeCompare(b.postId || "") || a.order - b.order);
  return toCsv(header, sorted.map((comment) => header.map((key) => comment[key])));
}

export function groupJson(group, posts, comments) {
  return JSON.stringify({ group, posts, comments }, null, 2);
}

export function postsJsonl(posts, comments) {
  const byPost = groupComments(comments);
  return posts.map((post) => JSON.stringify({ ...post, comments: byPost.get(post.id) || [] })).join("\n") + (posts.length ? "\n" : "");
}

export function groupMarkdown(group, posts, comments) {
  const byPost = groupComments(comments);
  const lines = [`# ${group.name || group.id}`, ""];
  for (const post of posts) {
    lines.push(`## ${post.authorName || "Unknown"} · ${when(post)}`);
    if (post.url) lines.push(post.url);
    lines.push("");
    if (post.text) lines.push(post.text, "");
    if (post.sharedText) lines.push(`Shared: ${post.sharedText}`, "");
    for (const comment of byPost.get(post.id) || []) {
      const pad = "  ".repeat(comment.depth || 0);
      lines.push(`${pad}- **${comment.authorName || "Unknown"}** · ${when(comment)}`);
      if (comment.text) lines.push(`${pad}  ${comment.text.replace(/\n/g, "\n" + pad + "  ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function groupHtml(group, posts, comments) {
  const byPost = groupComments(comments);
  const title = escapeHtml(group.name || group.id);
  const articles = posts.map((post) => {
    const thread = (byPost.get(post.id) || []).map((comment) => {
      return `<div class="c" style="--d:${comment.depth || 0}"><p class="meta">${escapeHtml(comment.authorName || "Unknown")} · ${escapeHtml(when(comment))}</p><p>${escapeHtml(comment.text || "").replace(/\n/g, "<br>")}</p></div>`;
    }).join("");
    const shared = post.sharedText ? `<blockquote>${escapeHtml(post.sharedText)}</blockquote>` : "";
    const alts = (post.imageAlts || []).map((alt) => `<p class="meta">Photo: ${escapeHtml(alt)}</p>`).join("");
    return `<article><p class="meta">${escapeHtml(post.authorName || "Unknown")} · ${escapeHtml(when(post))}</p><p>${escapeHtml(post.text || "").replace(/\n/g, "<br>")}</p>${shared}${alts}${thread}</article>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font: 16px/1.45 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  article { border-top: 1px solid #ccc; padding: 1rem 0; }
  .meta { color: #555; font-size: 0.85rem; }
  .c { margin-left: calc(var(--d) * 1rem); }
  blockquote { margin-left: 0; padding-left: 0.8rem; border-left: 3px solid #ccc; color: #333; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<p class="meta">Print this page to PDF from the browser.</p>
<h1>${title}</h1>
${articles}
</body>
</html>
`;
}

export function insights(posts, comments) {
  const byDay = new Map();
  for (const post of posts) {
    if (!post.createdAt || post.approximate) continue;
    const day = post.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const days = [...byDay.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).slice(0, 7);
  const busiest = [...posts].sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);
  return { days, busiest, words: topWords(posts, comments) };
}

function topWords(posts, comments) {
  const counts = new Map();
  const blob = posts.map((post) => `${post.text || ""} ${post.sharedText || ""}`).concat(comments.map((comment) => comment.text || "")).join("\n").toLowerCase();
  for (const word of blob.match(/[a-z0-9']{4,}/g) || []) {
    if (STOP.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
}

function groupComments(comments) {
  const byPost = new Map();
  for (const comment of [...comments].sort((a, b) => a.order - b.order)) {
    if (!byPost.has(comment.postId)) byPost.set(comment.postId, []);
    byPost.get(comment.postId).push(comment);
  }
  return byPost;
}

function when(row) {
  if (row.createdAt && !row.approximate) return row.createdAt.slice(0, 10);
  return row.createdLabel || row.createdAt || "";
}

function toCsv(header, rows) {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

function csvCell(value) {
  let text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}
