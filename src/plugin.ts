/**
 * `dev-domain` 插件契约层：声明 Cordis 插件三要素（name / inject / apply）。
 *
 * 本包是 `dsh-rsi-agent` 的领域包：只声明 `agentHost` 一个跨包服务，
 * 拿到 core 提供的宿主后把 `dev` 领域安装进去（人设 / 资产 / 固件 Skill）。
 *
 * 固件 Skill 的注册（任务-02 修复）：core 的 `registerFirmwareSkills()` 只注册
 * **core 自己的** 3 个固件 SKILL，`pack.firmwareSkills` 仅用于重名冲突校验，
 * core 不会注册其中声明的 markdown。故这里在 `install()` 成功后，由领域侧自己
 * 把 2 个固件 SKILL 静态注册进 `ctx.skills`，并与 install 的 Disposable 一起
 * 交给 `ctx.effect` 管理（领域卸载时反注册）。
 */
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { Context } from '@deepseek-ai/cordis'
import { createDomainLogger, type DomainLogger, type FirmwareSkill } from 'dsh-rsi-agent'
import { planFirmwareSkillRegistrations, type SkippedFirmwareSkill } from './firmware.js'
import { devPack } from './pack.js'

/** 插件唯一标识（必须与 `cordis.patch.yml` 中的 `dev-domain` 一致）。 */
export const name = 'dev-domain'

/**
 * 依赖服务：只声明 core 提供的 `agentHost`。
 *
 * 必须与 `cordis.patch.yml` 中 `dev-domain` 条目的 `inject` 逐项一致。
 */
export const inject = ['agentHost']

/* ------------------------------------------------------------------ *
 * 服务探测（与 core 同款容错：get() 优先，退化到属性读取）
 * ------------------------------------------------------------------ */

/** 读取服务实例；缺失或抛错时返回 `undefined`（不阻断装配）。 */
function readService(ctx: Context, serviceName: string): unknown {
  const getter = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof getter === 'function') {
    try {
      const value = getter.call(ctx, serviceName)
      if (value !== undefined) return value
    } catch {
      // 落到属性读取
    }
  }
  try {
    return (ctx as unknown as Record<string, unknown>)[serviceName]
  } catch {
    return undefined
  }
}

/** `ctx.skills.get()` 返回的最小结构（只读核验用）。 */
interface SkillDefinitionLike {
  readonly name?: string
  readonly provider?: string
  readonly content?: string
}

/** `ctx.skills` 的最小结构：只依赖 dsh-skill 的公开 `register()`（`get()` 可选）。 */
interface SkillRegistryLike {
  register(skill: SkillRegistration): () => void
  get?(name: string): Promise<SkillDefinitionLike | undefined>
}

/** 读取 `ctx.skills`；缺失或不支持 `register()` 时返回 `undefined`（降级信号）。 */
function readSkillRegistry(ctx: Context): SkillRegistryLike | undefined {
  const service = readService(ctx, 'skills')
  if (
    service !== null &&
    typeof service === 'object' &&
    typeof (service as SkillRegistryLike).register === 'function'
  ) {
    return service as SkillRegistryLike
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * 已注册名字的进程内记录（同步查重）
 * ------------------------------------------------------------------ */

/**
 * 每个 ctx 已由本领域注册过的固件 Skill 名。
 *
 * `ctx.skills.list()` / `get()` 都是**异步** API，`apply()` 内无法同步等待，
 * 因此同步查重只能覆盖「本领域自己注册过的名字」（重复 apply / 重复 install
 * 的真实来源）。跨来源重名由 dsh-skill 保证：同一层同名 runtime 条目 first-wins
 * （后来者拿到 no-op disposer，不报错），core 若将来支持 `pack.firmwareSkills`，
 * 其条目先注册即胜出，语义与「跳过」一致；这种情况由
 * {@link verifyRegistrationWinner} 异步补一条 warn。
 */
const registeredByContext = new WeakMap<object, Set<string>>()

/** 取（必要时创建）某个 ctx 的已注册名字集合。 */
function claimedNames(ctx: Context): Set<string> {
  const key = ctx as unknown as object
  let names = registeredByContext.get(key)
  if (names === undefined) {
    names = new Set<string>()
    registeredByContext.set(key, names)
  }
  return names
}

/* ------------------------------------------------------------------ *
 * 注册 / 反注册
 * ------------------------------------------------------------------ */

/** 把跳过项汇总成一条可读的 warn 文案。 */
function describeSkipped(skipped: readonly SkippedFirmwareSkill[]): string {
  return skipped
    .map((item) =>
      item.reason === 'duplicate-declaration'
        ? `${item.name}（声明内重名）`
        : `${item.name}（注册表已有同名 Skill，保留已有条目）`,
    )
    .join('、')
}

/**
 * 注册完成后异步核验「最终胜出的条目是否就是我们这份」。
 *
 * 只在发现被其它来源抢占时 warn（不改变行为、不抛错）：filesystem / 项目级
 * Skill 可以合法覆盖同名 runtime 注册，领域侧需要让用户看到这条事实。
 */
function verifyRegistrationWinner(
  registry: SkillRegistryLike,
  registration: SkillRegistration,
  logger: DomainLogger,
): void {
  const get = registry.get
  if (typeof get !== 'function') return

  let pending: Promise<SkillDefinitionLike | undefined>
  try {
    pending = Promise.resolve(get.call(registry, registration.name))
  } catch {
    return
  }

  void pending.then(
    (found) => {
      if (found === undefined) {
        logger.warn(`固件 Skill "${registration.name}" 注册后仍不可见（skills.get() 返回 undefined）`)
        return
      }
      if (typeof found.provider === 'string' && found.provider !== 'runtime') {
        logger.warn(
          `同名 Skill "${registration.name}" 已由 provider "${found.provider}" 提供，领域固件版本未生效（保留已有条目）`,
        )
        return
      }
      if (typeof found.content === 'string' && found.content !== registration.content) {
        logger.warn(
          `同名 Skill "${registration.name}" 的正文与领域固件版本不一致（可能已被其它来源抢先注册），保留已有条目`,
        )
      }
    },
    () => {
      // 核验是尽力而为：`get()` 失败（provider 抖动 / 已卸载）不应影响安装。
    },
  )
}

/**
 * 把领域声明的固件 Skill 静态注册进 `ctx.skills`。
 *
 * 降级语义：`ctx.skills` 缺失或不支持 `register()` 时只 warn，返回空数组，
 * **不阻断** install（与 core 的固件注册同口径）。注册中途失败会回滚已注册项
 * 后抛出，调用方负责同时拆卸领域，避免留下「半个注册表」。
 *
 * @returns 与注册顺序一致的 unregister 数组（调用方按 LIFO 反注册）。
 */
export function registerDomainFirmwareSkills(
  ctx: Context,
  skills: readonly FirmwareSkill[] | undefined = devPack.firmwareSkills,
  logger: DomainLogger = createDomainLogger(readService(ctx, 'logger'), 'dev-domain'),
): Array<() => void> {
  const registry = readSkillRegistry(ctx)
  if (registry === undefined) {
    logger.warn(
      'ctx.skills 缺失或不支持 register()，跳过固件 Skill 注册（降级：dev-dispatch-contract / dev-quality-gate 在会话中不可见）',
    )
    return []
  }

  const claimed = claimedNames(ctx)
  const plan = planFirmwareSkillRegistrations(skills, { skip: (name) => claimed.has(name) })
  if (plan.skipped.length > 0) {
    logger.warn(`跳过 ${plan.skipped.length} 个固件 Skill：${describeSkipped(plan.skipped)}`)
  }

  const unregisters: Array<() => void> = []
  const registered: string[] = []
  try {
    for (const registration of plan.registrations) {
      const unregister = registry.register(registration)
      if (typeof unregister !== 'function') {
        throw new TypeError(
          `ctx.skills.register("${registration.name}") 未返回 unregister 函数（实际为 ${typeof unregister}）`,
        )
      }
      unregisters.push(unregister)
      registered.push(registration.name)
      claimed.add(registration.name)
      verifyRegistrationWinner(registry, registration, logger)
    }
  } catch (error) {
    const rolledBack: string[] = []
    for (let index = unregisters.length - 1; index >= 0; index -= 1) {
      try {
        unregisters[index]?.()
        claimed.delete(registered[index] as string)
        rolledBack.push(registered[index] as string)
      } catch (rollbackError) {
        logger.warn(`回滚固件 Skill "${registered[index]}" 失败`, rollbackError)
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`[dev] 注册固件 Skill 失败（已回滚 [${rolledBack.join(', ')}]）：${detail}`)
  }

  // 反注册时同步释放查重占位，保证「卸载后再装」可以重新注册。
  return unregisters.map((unregister, index) => () => {
    try {
      unregister()
    } finally {
      claimed.delete(registered[index] as string)
    }
  })
}

/* ------------------------------------------------------------------ *
 * 插件装配
 * ------------------------------------------------------------------ */

/** 插件装配入口。 */
export function apply(ctx: Context): void {
  const logger = createDomainLogger(readService(ctx, 'logger'), 'dev-domain')

  ctx.effect(() => {
    // install 返回的 Disposable 交给 ctx.effect 管理：fiber 卸载时自动拆卸领域。
    const install = ctx.agentHost.install(devPack)

    let unregisters: Array<() => void>
    try {
      unregisters = registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)
    } catch (error) {
      // 固件 Skill 注册失败：先拆领域再抛，绝不留下半个激活领域。
      install()
      throw error
    }

    return () => {
      // 反注册顺序与注册顺序相反（LIFO），再拆卸领域。
      for (let index = unregisters.length - 1; index >= 0; index -= 1) {
        try {
          unregisters[index]?.()
        } catch (error) {
          logger.warn('固件 Skill 反注册失败（已继续拆卸领域）', error)
        }
      }
      install()
    }
  }, 'dev-domain:install-dev-pack')
}
