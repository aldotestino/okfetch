import { readFile, writeFile } from "node:fs/promises";

const packageDocs = [
  {
    indexPath: new URL("../docs/fetch/index.md", import.meta.url),
    moduleGlobPrefix: new URL("../docs/fetch/modules/", import.meta.url),
    moduleIndexPath: new URL("../docs/fetch/modules/index.md", import.meta.url),
    packageTitle: "@okfetch/fetch",
    packageDescription:
      "Transport core docs for validation, retries, plugins, streaming, and typed request handling.",
    permalink: "/fetch/",
    navOrder: 1,
  },
  {
    indexPath: new URL("../docs/api/index.md", import.meta.url),
    moduleGlobPrefix: new URL("../docs/api/modules/", import.meta.url),
    moduleIndexPath: new URL("../docs/api/modules/index.md", import.meta.url),
    packageTitle: "@okfetch/api",
    packageDescription:
      "Typed API client docs for endpoint trees, generated clients, and schema-driven request validation.",
    permalink: "/api/",
    navOrder: 2,
  },
  {
    indexPath: new URL("../docs/logger/index.md", import.meta.url),
    moduleGlobPrefix: new URL("../docs/logger/modules/", import.meta.url),
    moduleIndexPath: new URL(
      "../docs/logger/modules/index.md",
      import.meta.url
    ),
    packageTitle: "@okfetch/logger",
    packageDescription:
      "Logging plugin docs for the built-in pino-powered okfetch integration.",
    permalink: "/logger/",
    navOrder: 3,
  },
];

const rewritePackageIndex = async (entry) => {
  const content = `---
title: "${entry.packageTitle}"
nav_order: ${entry.navOrder}
has_children: true
permalink: ${entry.permalink}
---

# ${entry.packageTitle}

${entry.packageDescription}
`;

  await writeFile(entry.indexPath, content);
};

const rewriteModuleIndex = async (entry) => {
  const content = `---
title: Modules
parent: "${entry.packageTitle}"
nav_exclude: true
permalink: ${entry.permalink}modules/
---
`;

  await writeFile(entry.moduleIndexPath, content);
};

const rewriteModulePage = async (filePath, packageTitle) => {
  const content = await readFile(filePath, "utf8");
  const nextContent = content.replace(
    /^parent:\s+.+$/m,
    `parent: "${packageTitle}"`
  );

  await writeFile(filePath, nextContent);
};

for (const entry of packageDocs) {
  await rewritePackageIndex(entry);
  await rewriteModuleIndex(entry);

  const moduleDirectory = entry.moduleGlobPrefix.pathname;
  const files =
    await Bun.$`find ${moduleDirectory} -maxdepth 1 -type f -name '*.md'`.text();

  for (const file of files.split("\n").filter(Boolean)) {
    if (file === entry.moduleIndexPath.pathname) {
      continue;
    }

    await rewriteModulePage(new URL(`file://${file}`), entry.packageTitle);
  }
}
