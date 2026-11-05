const DB_NAME = "fb-group-archive";
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("groups")) {
          db.createObjectStore("groups", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("posts")) {
          const posts = db.createObjectStore("posts", { keyPath: "id" });
          posts.createIndex("groupId", "groupId", { unique: false });
        }
        if (!db.objectStoreNames.contains("comments")) {
          const comments = db.createObjectStore("comments", { keyPath: "id" });
          comments.createIndex("postId", "postId", { unique: false });
          comments.createIndex("groupId", "groupId", { unique: false });
        }
        if (!db.objectStoreNames.contains("jobs")) {
          db.createObjectStore("jobs", { keyPath: "groupId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
  const result = await fn(tx.objectStore(name));
  await done;
  return result;
}

export function putGroup(group) {
  return withStore("groups", "readwrite", (store) => requestToPromise(store.put(group)));
}

export function getGroup(id) {
  return withStore("groups", "readonly", (store) => requestToPromise(store.get(id)));
}

export async function listGroups() {
  const rows = await withStore("groups", "readonly", (store) => requestToPromise(store.getAll()));
  return rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function putPost(post) {
  return withStore("posts", "readwrite", (store) => requestToPromise(store.put(post)));
}

export function getPost(id) {
  return withStore("posts", "readonly", (store) => requestToPromise(store.get(id)));
}

export async function listPosts(groupId) {
  const rows = await withStore("posts", "readonly", (store) => {
    return requestToPromise(store.index("groupId").getAll(groupId));
  });
  return rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || (b.id || "").localeCompare(a.id || ""));
}

export async function knownPostIds(groupId) {
  const posts = await listPosts(groupId);
  return posts.map((post) => post.id);
}

export function listComments(postId) {
  return withStore("comments", "readonly", (store) => {
    return requestToPromise(store.index("postId").getAll(postId));
  }).then((rows) => rows.sort((a, b) => a.order - b.order));
}

export function listCommentsByGroup(groupId) {
  return withStore("comments", "readonly", (store) => {
    return requestToPromise(store.index("groupId").getAll(groupId));
  });
}

export async function deletePost(postId) {
  await replaceComments(postId, []);
  await withStore("posts", "readwrite", (store) => requestToPromise(store.delete(postId)));
}

export function replaceComments(postId, comments) {
  return withStore("comments", "readwrite", (store) => new Promise((resolve, reject) => {
    const req = store.index("postId").getAll(postId);
    req.onsuccess = () => {
      for (const row of req.result) store.delete(row.id);
      for (const comment of comments) store.put(comment);
      resolve();
    };
    req.onerror = () => reject(req.error);
  }));
}

export function getJob(groupId) {
  return withStore("jobs", "readonly", (store) => requestToPromise(store.get(groupId)));
}

export function listJobs() {
  return withStore("jobs", "readonly", (store) => requestToPromise(store.getAll()));
}

export function putJob(job) {
  return withStore("jobs", "readwrite", (store) => requestToPromise(store.put(job)));
}
