import { readFile, writeFile } from "node:fs/promises";

const moduleIndexes = [
  {
    path: new URL("../docs/fetch/modules/index.md", import.meta.url),
    permalink: "/fetch/modules/",
  },
  {
    path: new URL("../docs/api/modules/index.md", import.meta.url),
    permalink: "/api/modules/",
  },
  {
    path: new URL("../docs/logger/modules/index.md", import.meta.url),
    permalink: "/logger/modules/",
  },
];

for (const entry of moduleIndexes) {
  const content = await readFile(entry.path, "utf8");
  const nextContent = content.replace(
    /^permalink:\s+.+$/m,
    `permalink: ${entry.permalink}`
  );

  await writeFile(entry.path, nextContent);
}
