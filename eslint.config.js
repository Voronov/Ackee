import config from '@electerious/eslint-config'
import { defineConfig } from 'eslint/config'
import globals from 'globals'

export default defineConfig([
  config,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'import-x/dynamic-import-chunkname': 0,
      'import-x/no-named-as-default': 0,
      'unicorn/filename-case': 0,
      'unicorn/consistent-function-scoping': 0,
      'unicorn/no-await-expression-member': 0,
      'unicorn/no-anonymous-default-export': 0,
      'unicorn/prefer-top-level-await': 0,
      'unicorn/no-thenable': 0,
      'unicorn/no-process-exit': 0,
    },
  },
  {
    // Maintenance scripts, run by hand and not part of the package. They import the map
    // data they convert, which is installed on demand rather than declared as a
    // dependency, because nothing at run time uses it.
    files: ['tools/**/*.js'],
    rules: {
      'import-x/no-unresolved': 0,
      'import-x/no-extraneous-dependencies': 0,
    },
  },
])
