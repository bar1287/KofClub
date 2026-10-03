const fs = require('node:fs');
const path = require('node:path');

const swcConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '.swcrc'), 'utf8'));
const transform = { '^.+\\.ts$': ['@swc/jest', { ...swcConfig, swcrc: false }] };

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: __dirname,
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'],
      transform,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: __dirname,
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      transform,
      globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/integration/support/global-teardown.ts',
      testTimeout: 30000,
    },
  ],
};
