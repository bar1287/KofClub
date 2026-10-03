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
const specPath = path.resolve(
  __dirname,
  '../../../../../packages/contracts/openapi/control-api.yaml',
);
const spec = parse(readFileSync(specPath, 'utf8')) as {
  components: { schemas: Record<string, unknown> };
};

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('int64', { type: 'number', validate: (n: number) => Number.isSafeInteger(n) });
ajv.addSchema({ $id: 'openapi', components: spec.components });

const cache = new Map<string, ValidateFunction>();

export function expectSchema(name: string, body: unknown): void {
  if (!spec.components.schemas[name]) throw new Error(`Unknown schema ${name}`);
  let validate = cache.get(name);
  if (!validate) {
    validate = ajv.compile({ $ref: `openapi#/components/schemas/${name}` });
    cache.set(name, validate);
  }
  if (!validate(body)) {
    throw new Error(
      `Response does not match OpenAPI schema ${name}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n` +
        JSON.stringify(body, null, 2),
    );
  }
}
