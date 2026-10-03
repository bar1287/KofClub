// Regenerates TypeScript types from the canonical OpenAPI documents.
// Output is deterministic so CI can verify it with `git diff --exit-code`.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const specs = [
  { input: 'openapi/control-api.yaml', output: 'src/generated/control-api.ts' },
  { input: 'openapi/realtime.yaml', output: 'src/generated/realtime.ts' },
];

const prettierConfig = (await prettier.resolveConfig(path.join(root, 'src/index.ts'))) ?? {};

for (const spec of specs) {
  // Pass a file URL so relative $refs (e.g. ./realtime.yaml) resolve correctly.
  const ast = await openapiTS(pathToFileURL(path.join(root, spec.input)), {
    exportType: true,
    alphabetize: true,
  });
  const header =
    `// Code generated from ${spec.input} by scripts/generate.mjs. DO NOT EDIT.\n` +
    `/* eslint-disable */\n`;
  const formatted = await prettier.format(header + astToString(ast), {
    ...prettierConfig,
    parser: 'typescript',
  });
  await writeFile(path.join(root, spec.output), formatted);
  console.log(`generated ${spec.output}`);
}
