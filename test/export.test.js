"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/export.js"), "utf8");
  const { postsCsv } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const csv = postsCsv([{ id: "555", threadCaptureVersion: 2 }]);
  assert.equal(csv.split("\r\n")[0].split(",").at(-1), "threadCaptureVersion");
  assert.equal(csv.split("\r\n")[1].split(",").at(-1), "2");
  console.log("export.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
