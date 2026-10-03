import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Contract tests: responses are validated against the canonical OpenAPI
 * document (packages/contracts/openapi/control-api.yaml), so the
 * implementation cannot drift from the published contract.
 */
const specDir = path.resolve(__dirname, '../../../../../packages/contracts/openapi');
const load = (file: string) =>
  parse(
    // Cross-document refs (./realtime.yaml#...) are mapped to registered schema ids.
    readFileSync(path.join(specDir, file), 'utf8').replaceAll("'./realtime.yaml#", "'realtime#"),
  ) as { components: { schemas: Record<string, unknown> } };
const spec = load('control-api.yaml');
const realtime = load('realtime.yaml');

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('int64', { type: 'number', validate: (n: number) => Number.isSafeInteger(n) });
ajv.addSchema({ $id: 'openapi', components: spec.components });
ajv.addSchema({ $id: 'realtime', components: realtime.components });

const cache = new Map<string, ValidateFunction>();

export function expectSchema(name: string, body: unknown): void {
  const doc = spec.components.schemas[name]
    ? 'openapi'
    : realtime.components.schemas[name]
      ? 'realtime'
      : null;
  if (!doc) throw new Error(`Unknown schema ${name}`);
  let validate = cache.get(name);
  if (!validate) {
    validate = ajv.compile({ $ref: `${doc}#/components/schemas/${name}` });
    cache.set(name, validate);
  }
  if (!validate(body)) {
    throw new Error(
      `Response does not match OpenAPI schema ${name}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n` +
        JSON.stringify(body, null, 2),
    );
  }
}
