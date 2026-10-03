import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ALL_ERROR_CODES, ErrorCodes, isErrorCode } from '../src';

describe('error codes', () => {
  it('match the OpenAPI ErrorCode enum exactly', () => {
    const doc = parse(
      readFileSync(path.join(__dirname, '../openapi/control-api.yaml'), 'utf8'),
    ) as { components: { schemas: { ErrorCode: { enum: string[] } } } };
    expect([...ALL_ERROR_CODES].sort()).toEqual([...doc.components.schemas.ErrorCode.enum].sort());
  });

  it('are uppercase snake case', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it('narrows unknown values', () => {
    expect(isErrorCode(ErrorCodes.NOT_YOUR_TURN)).toBe(true);
    expect(isErrorCode('nope')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
