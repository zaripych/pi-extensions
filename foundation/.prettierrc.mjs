// prettier.config.js, .prettierrc.js, prettier.config.mjs, or .prettierrc.mjs

/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
export default {
  trailingComma: 'es5',
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  proseWrap: 'preserve',
  overrides: [
    {
      files: '*.(js|ts|mjs|mts|tsx)',
      options: {
        proseWrap: 'always',
      },
    },
  ],
}
