import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const forbiddenExtensions = new Set([
  ".ckpt",
  ".env",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".pem",
  ".pickle",
  ".pkl",
  ".p12",
  ".pfx",
  ".pt",
  ".pth",
  ".sqlite",
]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".txt",
]);
const forbiddenText = [
  /\/n\/(?:home|holylabs|netscratch)/i,
  /[a-z]:\\(?:users|documents and settings)\\/i,
  new RegExp(["begin", "private", "key"].join("[ ]+"), "i"),
  new RegExp(["secret", "access", "key"].join("[_-]?"), "i"),
  new RegExp(["access", "key", "id"].join("[_-]?"), "i"),
  new RegExp(`api[_-]?${"token"}`, "i"),
  new RegExp(`h${"f"}_[a-z0-9]{12,}`, "i"),
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

const files = await walk(publicRoot);
const issues = [];
let totalBytes = 0;

for (const absolutePath of files) {
  const relativePath = path
    .relative(publicRoot, absolutePath)
    .split(path.sep)
    .join("/");
  const extension = path.extname(relativePath).toLowerCase();
  totalBytes += (await stat(absolutePath)).size;

  if (forbiddenExtensions.has(extension)) {
    issues.push(`${relativePath}: forbidden public file type ${extension}`);
  }
  if (!textExtensions.has(extension)) continue;

  const text = await readFile(absolutePath, "utf8");
  for (const pattern of forbiddenText) {
    if (pattern.test(text)) {
      issues.push(`${relativePath}: contains a private-path or secret pattern`);
      break;
    }
  }
}

if (issues.length > 0) {
  throw new Error(`Public-data boundary failed:\n${issues.join("\n")}`);
}

console.log(
  `Public-data boundary passed: ${files.length} files, ${totalBytes.toLocaleString()} bytes.`,
);
