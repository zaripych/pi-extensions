const allJs = '*.(js|ts|mjs|mts|tsx)'

export default {
  [`!(${allJs})`]: 'prettier --write -u',
  [allJs]: [
    'oxlint --fix --no-error-on-unmatched-pattern',
    'prettier --write -u',
    () => 'tsgo --noEmit --pretty',
  ],
  'package.json': () => 'npm exec sort-package-json',
}
