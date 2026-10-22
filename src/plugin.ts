/**
 * `dev-domain` 插件契约层：声明 Cordis 插件三要素（name / inject / apply）。
 *
 * 本包是 `dsh-rsi-agent` 的领域包：只声明 `agentHost` 一个跨包服务，
 * 拿到 core 提供的宿主后把 `dev` 领域安装进去（人设 / 资产 / 固件 Skill）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { devPack } from './pack.js'

/** 插件唯一标识（必须与 `cordis.patch.yml` 中的 `dev-domain` 一致）。 */
export const name = 'dev-domain'

/**
 * 依赖服务：只声明 core 提供的 `agentHost`。
 *
 * 必须与 `cordis.patch.yml` 中 `dev-domain` 条目的 `inject` 逐项一致。
 */
export const inject = ['agentHost']

/** 插件装配入口。 */
export function apply(ctx: Context): void {
  // install 返回的 Disposable 交给 ctx.effect 管理：fiber 卸载时自动拆卸领域。
  ctx.effect(() => ctx.agentHost.install(devPack), 'dev-domain:install-dev-pack')
}
