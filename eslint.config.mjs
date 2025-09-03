import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import jsonPlugin from 'eslint-plugin-json';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended
});

export default [
  {
    ignores: ['eslint.config.mjs', 'overrides/**']
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:n/recommended',
    'plugin:promise/recommended'
  ),
  jsonPlugin.configs.recommended,
  {
    languageOptions: {
      globals: {
        jQuery: 'readonly',
        window: 'readonly'
      }
    },
    rules: {
      'no-prototype-builtins': 'off'
    }
  }
];
