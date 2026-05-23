const allJs = '*.(js|ts|mjs|mts|tsx)'

export default {
  [`!(${allJs})`]: 'prettier --write -u',
  [allJs]: [
    `biome check --config-path ./biome.config.json --write --unsafe`,
    'prettier --write -u',
  ],
  [allJs]: () => 'tsc --noEmit --pretty',
}
