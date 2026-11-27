import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { minify } from "@swc/core";
import { transform } from "lightningcss";

const html = await readFile("index.html", "utf8");
const envFile = await readFile(".env", "utf8").catch(() => "");
const env = Object.fromEntries(envFile.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2]]] : [];
}));
const key = process.env.POSTHOG_KEY || env.POSTHOG_KEY;
const host = process.env.POSTHOG_HOST || env.POSTHOG_HOST;
let posthogConfig;
if (key && host && URL.canParse(host)) {
  const url = new URL(host);
  if (url.protocol === "https:" || url.protocol === "http:") {
    posthogConfig = { key, host: url.href.replace(/\/$/, "") };
  }
}
if (!posthogConfig && (key || host)) {
  console.warn("PostHog disabled: set POSTHOG_KEY and a valid HTTP(S) POSTHOG_HOST.");
}
// The source page declares the execution order and also works directly from disk.
const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)];
const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)">/);
if (!scripts.length || !stylesheet) throw new Error("Missing atlas scripts or stylesheet in index.html");

const sources = await Promise.all(scripts.map(([, file]) => readFile(file, "utf8")));
const js = await minify(['"use strict";', ...sources].join("\n;\n"), { module: false, ecma: 2022 });
const css = transform({
  filename: stylesheet[1],
  code: Buffer.from((await readFile(stylesheet[1], "utf8")).replace(/^\uFEFF/, "")),
  minify: true
});

await mkdir("dist/assets", { recursive: true });
async function writeAsset(extension, bytes) {
  // 16 hex digits of SHA-256 identify the final, minified bytes.
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const file = `assets/atlas.${hash}.${extension}`;
  await writeFile(`dist/${file}`, bytes);
  return file;
}
const jsFile = await writeAsset("js", js.code);
const cssFile = await writeAsset("css", css.code);
let page = html.replace(stylesheet[0], `<link rel="stylesheet" href="${cssFile}">`);
if (posthogConfig) {
  const configJson = JSON.stringify(posthogConfig).replaceAll("<", "\\u003c");
  page = page.replace("</head>", () => `<script>window.__POSTHOG_CONFIG__=${configJson};</script></head>`);
}
for (const [index, [tag]] of scripts.entries()) {
  page = page.replace(tag, index === 0 ? `<script defer src="${jsFile}"></script>` : "");
}
await copyFile("LICENSE", "dist/LICENSE");
await writeFile("dist/index.html", page);
console.log(`Built dist/index.html with ${jsFile} and ${cssFile}`);
