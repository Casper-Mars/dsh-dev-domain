/**
 * `dsh-dev-domain` 包入口：汇聚导出 Cordis 插件三要素与 `dev` 领域包。
 *
 * `package.json` 的 `exports["."]` 指向本文件的编译产物
 * （`dist-server/index.js`），实际契约收敛在 `./plugin.js` 与 `./pack.js`。
 */
export { name, apply, inject } from './plugin.js'
export { devPack } from './pack.js'
export { SEED_SKILLS, type SeedSkill } from './seeds.js'
