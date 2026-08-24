import eslintConfig from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...eslintConfig,

    {
        // Ignore patterns (from legacy .eslintignore / .npmignore).
        // Generated/template *.d.ts files are not part of the tsconfig project.
        ignores: ['admin/words.js', 'admin/i18n/**', 'test/**', '**/*.d.ts'],
    },

    {
        // @iobroker/eslint-config builds on jsdoc's "recommended-typescript" preset, which reports
        // "@type" and "@typedef" as redundant because TypeScript would carry the type itself. This
        // adapter is plain JavaScript, type checked through "checkJs" (see tsconfig.json), so JSDoc
        // is the only place a type can be expressed.
        files: ['**/*.js'],
        rules: {
            'jsdoc/check-tag-names': ['error', { typed: false }],
            // The legacy main.js suppresses type-checker complaints on custom runtime
            // attributes with intentional "@ts-ignore" comments; keep them as-is.
            '@typescript-eslint/ban-ts-comment': 'off',
        },
    },

    // Add mocha globals for test files
    {
        files: ['**/*.test.js', 'test/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.mocha,
            },
        },
    },
];
