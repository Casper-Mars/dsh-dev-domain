/**
 * 固件 Skill 的**运行时注册**（任务-02 修复）。
 *
 * 背景：core 的 `registerFirmwareSkills()` 只注册 core 自己的 3 个固件 SKILL，
 * `pack.firmwareSkills` 仅用于重名冲突校验。若不修，挂载后
 * `skills.get('dev-leader-rules')` 是 undefined，README 的「10 个 Skill 可用」不成立。
 *
 * 两层：
 *   - **纯函数层**：frontmatter 解析、注册参数构造、注册计划查重；
 *   - **集成层**：真实 `SkillRegistry` + `AgentHost` + `apply()`，
 *     验证 3 个固件可见 / 7 个种子仍可见 / 卸载反注册 / skills 缺失降级。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { AgentHost, type DomainLogger, type FirmwareSkill } from 'dsh-rsi-agent'
import {
  buildFirmwareSkillRegistration,
  parseFirmwareSkillMarkdown,
  planFirmwareSkillRegistrations,
} from '../src/firmware'
import { devPack } from '../src/pack'
import { apply, registerDomainFirmwareSkills } from '../src/plugin'
import { SEED_SKILLS } from '../src/seeds'

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 记录 warn 的 logger（降级 / 查重路径的断言用）。 */
function recordingLogger(): { logger: DomainLogger; warns: string[] } {
  const warns: string[] = []
  const noop = (): void => {}
  const logger: DomainLogger = {
    error: noop,
    warn: (message) => {
      warns.push(message)
    },
    info: noop,
    debug: noop,
  }
  return { logger, warns }
}

/** 构造一个只有 `skills` 服务的假 ctx（不需要真实 Cordis 生命周期）。 */
function fakeContext(registry: unknown): Context {
  return {
    get(name: string) {
      return name === 'skills' ? registry : undefined
    },
  } as unknown as Context
}

/** 固件名（真源来自 pack 声明，不手抄）。 */
const FIRMWARE_NAMES = (devPack.firmwareSkills ?? []).map((skill) => skill.name)

const temporaryHomes: string[] = []
let previousDshHome: string | undefined

beforeEach(() => {
  previousDshHome = process.env.DSH_HOME
})

afterEach(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  while (temporaryHomes.length > 0) {
    rmSync(temporaryHomes.pop() as string, { recursive: true, force: true })
  }
})

/** 隔离的 DSH_HOME（不污染真实 ~/.dsh）。 */
function isolatedHome(label: string): string {
  const home = mkdtempSync(join(tmpdir(), `dev-firmware-${label}-`))
  temporaryHomes.push(home)
  process.env.DSH_HOME = home
  return home
}

/* ------------------------------------------------------------------ *
 * 1. 纯函数：解析与注册参数构造
 * ------------------------------------------------------------------ */

describe('固件 SKILL 解析', () => {
  it('frontmatter 三字段被解析，正文不含 frontmatter', () => {
    const markdown = [
      '---',
      'name: demo-skill',
      'description: 一句话说明',
      'whenToUse: 什么时候用',
      '---',
      '',
      '# 正文',
      '',
      '细节。',
    ].join('\n')

    const parsed = parseFirmwareSkillMarkdown(markdown, 'demo')
    expect(parsed.name).toBe('demo-skill')
    expect(parsed.description).toBe('一句话说明')
    expect(parsed.whenToUse).toBe('什么时候用')
    expect(parsed.content).not.toContain('---')
    expect(parsed.content).not.toContain('whenToUse')
    expect(parsed.content.trimStart().startsWith('# 正文')).toBe(true)
  })

  it('缺 whenToUse → 抛错并点名字段', () => {
    const markdown = ['---', 'name: demo', 'description: 只有描述', '---', '正文'].join('\n')
    expect(() => parseFirmwareSkillMarkdown(markdown, 'demo')).toThrowError(/whenToUse/)
  })

  it('缺 frontmatter → 抛错', () => {
    expect(() => parseFirmwareSkillMarkdown('# 没有 frontmatter', 'demo')).toThrowError(
      /frontmatter/,
    )
  })

  it('3 个固件的注册参数：name/description/whenToUse/path/resourceBase/invocation 全部合规', () => {
    expect(devPack.firmwareSkills).toHaveLength(3)

    for (const skill of devPack.firmwareSkills ?? []) {
      const registration = buildFirmwareSkillRegistration(skill)
      expect(registration.name).toBe(skill.name)
      expect(registration.description.length).toBeGreaterThan(0)
      expect(registration.description).toBe(
        parseFirmwareSkillMarkdown(skill.markdown, skill.name).description,
      )
      expect(registration.whenToUse?.length).toBeGreaterThan(0)
      expect(registration.source).toBe('runtime')
      expect(registration.invocation).toEqual({ modelInvocable: true, userInvocable: true })

      // path 必须是 SKILL.md 的绝对路径，resourceBase 指向其所在目录。
      const path = registration.path as string
      expect(path.startsWith('/')).toBe(true)
      expect(path.endsWith(join('skills', skill.name, 'SKILL.md'))).toBe(true)
      expect(registration.resourceBase).toEqual({ kind: 'directory', path: dirname(path) })

      // 正文剥离 frontmatter：模型可见内容里不能出现元数据。
      expect(registration.content.startsWith('---')).toBe(false)
      expect(registration.content).not.toContain(`name: ${skill.name}`)
      expect(registration.content).not.toContain('whenToUse:')
      expect(registration.content.trimStart().startsWith('# ')).toBe(true)
    }
  })

  it('声明名与 frontmatter.name 不一致 → 抛错', () => {
    const broken: FirmwareSkill = {
      name: 'dev-leader-rules',
      description: '声明名与 frontmatter 不一致',
      markdown: ['---', 'name: other-skill', 'description: x', 'whenToUse: y', '---', '正文'].join(
        '\n',
      ),
    }
    expect(() => buildFirmwareSkillRegistration(broken)).toThrowError(/other-skill/)
  })
})

describe('注册计划查重', () => {
  const sample = (name: string): FirmwareSkill => ({
    name,
    markdown: ['---', `name: ${name}`, 'description: d', 'whenToUse: w', '---', '正文'].join('\n'),
  })

  it('声明内重名只注册一次，其余记为 duplicate-declaration', () => {
    const plan = planFirmwareSkillRegistrations([sample('a-skill'), sample('a-skill')])
    expect(plan.registrations.map((item) => item.name)).toEqual(['a-skill'])
    expect(plan.skipped).toEqual([{ name: 'a-skill', reason: 'duplicate-declaration' }])
  })

  it('skip 回调命中 → 跳过并记为 already-registered', () => {
    const plan = planFirmwareSkillRegistrations([sample('a-skill'), sample('b-skill')], {
      skip: (name) => name === 'b-skill',
    })
    expect(plan.registrations.map((item) => item.name)).toEqual(['a-skill'])
    expect(plan.skipped).toEqual([{ name: 'b-skill', reason: 'already-registered' }])
  })

  it('devPack 的 3 个固件全部进入计划，无跳过', () => {
    const plan = planFirmwareSkillRegistrations(devPack.firmwareSkills)
    expect(plan.registrations.map((item) => item.name)).toEqual(FIRMWARE_NAMES)
    expect(plan.skipped).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 2. 注册 / 回滚 / 查重（假注册表，确定性触发）
 * ------------------------------------------------------------------ */

describe('注册失败回滚与幂等查重', () => {
  it('第 3 个注册抛错 → 已注册的 2 个被反注册，错误信息点出回滚项', () => {
    const { logger } = recordingLogger()
    const unregistered: string[] = []
    let calls = 0
    const registry = {
      register(registration: { name: string }) {
        calls += 1
        if (calls === 3) throw new Error('boom')
        return () => {
          unregistered.push(registration.name)
        }
      },
    }

    expect(() =>
      registerDomainFirmwareSkills(fakeContext(registry), devPack.firmwareSkills, logger),
    ).toThrowError(/已回滚 \[dev-dispatch-contract, dev-leader-rules\]/)
    expect(unregistered).toEqual(['dev-dispatch-contract', 'dev-leader-rules'])
  })

  it('同一 ctx 第二次调用 → 全部跳过并 warn，注册表不变', () => {
    const { logger, warns } = recordingLogger()
    const live = new Set<string>()
    const registry = {
      register(registration: { name: string }) {
        live.add(registration.name)
        return () => {
          live.delete(registration.name)
        }
      },
    }
    const ctx = fakeContext(registry)

    const first = registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)
    expect(first).toHaveLength(3)
    expect([...live].sort()).toEqual([...FIRMWARE_NAMES].sort())
    expect(warns).toEqual([])

    const second = registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)
    expect(second).toHaveLength(0)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('跳过 3 个固件 Skill')
    expect(warns[0]).toContain('dev-leader-rules')
    expect([...live].sort()).toEqual([...FIRMWARE_NAMES].sort())
  })

  it('反注册后占位被释放，可以重新注册（卸载 → 再装的路径）', () => {
    const { logger, warns } = recordingLogger()
    const live = new Set<string>()
    const registry = {
      register(registration: { name: string }) {
        live.add(registration.name)
        return () => {
          live.delete(registration.name)
        }
      },
    }
    const ctx = fakeContext(registry)

    const first = registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)
    for (const unregister of [...first].reverse()) unregister()
    expect(live.size).toBe(0)

    const second = registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)
    expect(second).toHaveLength(3)
    expect(live.size).toBe(3)
    expect(warns).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 3. 真实挂载：固件可见 / 种子可见 / 卸载反注册 / 降级
 * ------------------------------------------------------------------ */

describe('真实挂载（SkillRegistry + AgentHost + apply）', () => {
  it('挂载后 3 个固件 Skill 立即可见，provider 就绪后 7 个种子也在；工具面仍为空', async () => {
    isolatedHome('mount')
    const ctx = new Context()
    const registry = new SkillRegistry(ctx)
    const host = new AgentHost(ctx)

    apply(ctx)
    try {
      expect(host.active?.id).toBe('dev')
      expect(host.active?.toolNames).toEqual([])

      // 固件 Skill 是同步注册的：apply 返回后立即 list 即可见（不依赖 provider 就绪）。
      const immediate = await registry.list({})
      const firmware = immediate.filter((summary) => FIRMWARE_NAMES.includes(summary.name))
      expect(firmware.map((summary) => summary.name).sort()).toEqual([...FIRMWARE_NAMES].sort())
      expect(firmware.every((summary) => summary.provider === 'runtime')).toBe(true)

      const definition = await registry.get('dev-leader-rules')
      expect(definition?.name).toBe('dev-leader-rules')
      expect(definition?.source).toBe('runtime')
      expect(definition?.content.startsWith('---')).toBe(false)
      expect(definition?.content).toContain('Dev Leader')
      expect(definition?.invocation).toEqual({ modelInvocable: true, userInvocable: true })

      // 7 个可进化种子由 skill-filesystem provider 提供：就绪后可见。
      await host.skillProviderReady
      const names = (await registry.list({})).map((summary) => summary.name)
      for (const seed of SEED_SKILLS) expect(names).toContain(seed.name)
      for (const name of FIRMWARE_NAMES) expect(names).toContain(name)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 40_000)

  it('卸载领域后 3 个固件 Skill 被反注册，7 个种子资产仍保留在磁盘', async () => {
    isolatedHome('dispose')
    const ctx = new Context()
    const registry = new SkillRegistry(ctx)
    const host = new AgentHost(ctx)

    apply(ctx)
    const assetsDir = host.active?.runtime.assetsDir as string
    expect(assetsDir.length).toBeGreaterThan(0)
    expect((await registry.list({})).map((summary) => summary.name).sort()).toEqual(
      expect.arrayContaining([...FIRMWARE_NAMES]),
    )

    await ctx.fiber.dispose()

    expect(host.active).toBeUndefined()
    const remaining = (await registry.list({})).map((summary) => summary.name)
    for (const name of FIRMWARE_NAMES) expect(remaining).not.toContain(name)
    for (const seed of SEED_SKILLS) {
      expect(existsSync(join(assetsDir, 'skills', seed.name, 'SKILL.md'))).toBe(true)
    }
  }, 40_000)

  it('ctx.skills 缺失 → 降级 warn，install 仍成功（active.id = dev）', async () => {
    isolatedHome('degrade')
    const ctx = new Context()
    const host = new AgentHost(ctx)
    const { logger, warns } = recordingLogger()

    // 注册函数的降级路径（显式 logger，便于断言文案）。
    expect(registerDomainFirmwareSkills(ctx, devPack.firmwareSkills, logger)).toEqual([])
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('ctx.skills')
    expect(warns[0]).toContain('dev-leader-rules')

    // 插件装配的降级路径：只 warn，不阻断 install。
    apply(ctx)
    try {
      expect(host.active?.id).toBe('dev')
      expect(host.active?.toolNames).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  }, 40_000)
})
