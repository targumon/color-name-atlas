import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { minify } from "@swc/core";
import { transform } from "lightningcss";

const html = await readFile("index.html", "utf8");
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
for (const [index, [tag]] of scripts.entries()) {
  page = page.replace(tag, index === 0 ? `<script defer src="${jsFile}"></script>` : "");
}
await copyFile("LICENSE", "dist/LICENSE");
await writeFile("dist/index.html", page);
console.log(`Built dist/index.html with ${jsFile} and ${cssFile}`);
