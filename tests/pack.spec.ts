/**
 * `dev` 领域包（任务-02）契约 / bootstrap / validate / 固件 / 真实 core 集成。
 *
 * 两层：
 *   - **纯函数层**：字段契约、路径派生、种子与模板一致性、校验反例；
 *   - **集成层**：用 core 的真实 `AgentHost.install` 在临时 home 下落盘 + git 提交，
 *     验证 `agentHost.active.id === 'dev'`、7 个种子一次提交、拆卸后人设回退。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AgentHost,
  FIRMWARE_SKILL_NAMES,
  GIT_IDENTITY_NAME,
  loadCorePersonaMarkdown,
  validateDomainPack,
  type AssetSpec,
  type AssetWriter,
  type DomainPack,
} from 'dsh-rsi-agent'
import { devPack } from '../src/pack'
import { SEED_SKILLS } from '../src/seeds'

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 捕获 bootstrap 期间对 writer 的调用（不落盘）。 */
function captureWriter(): { calls: AssetSpec[][]; writer: AssetWriter } {
  const calls: AssetSpec[][] = []
  const writer: AssetWriter = {
    register(input) {
      calls.push(Array.isArray(input) ? [...input] : [input as AssetSpec])
      return []
    },
    list: () => [],
    read: () => {
      throw new Error('capture writer 不提供 read')
    },
  }
  return { calls, writer }
}

/** 取出 devPack 在 bootstrap 里注册的全部 spec（真源，不手抄）。 */
function bootstrapSpecs(): AssetSpec[] {
  const { calls, writer } = captureWriter()
  devPack.assets.bootstrap?.(writer)
  expect(calls.length, 'bootstrap 必须只调用一次 register（一次调用 ⇒ 一次 commit）').toBe(1)
  return calls[0] as AssetSpec[]
}

/** 按类型名取资产类型声明。 */
function assetType(typeName: string) {
  const found = devPack.assets.types.find((item) => item.name === typeName)
  if (found === undefined) throw new Error(`devPack 未声明资产类型 "${typeName}"`)
  return found
}

/** 读取仓库内相对路径（相对 tests/ 的上一级包根）。 */
function readRepoFile(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

/** 读取固件 Skill 正文。 */
function readFirmware(name: string): string {
  return readRepoFile(`skills/${name}/SKILL.md`)
}

/** 读取种子模板正文。 */
function readTemplate(name: string): string {
  return readRepoFile(`templates/${name}/SKILL.md`)
}

/** 从 SKILL.md 文本里取 frontmatter 字段（YAML 子集）。 */
function frontmatterField(content: string, key: string): string | undefined {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return undefined
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (line.trim() === '---') return undefined
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    if (line.slice(0, separator).trim() !== key) continue
    return line.slice(separator + 1).trim()
  }
  return undefined
}

/** 提交总数。 */
function gitCommitCount(assetsDir: string): number {
  const out = execFileSync('git', ['-C', assetsDir, 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  return Number(out)
}

/** 读取 assets 仓库最近一次提交的指定字段。 */
function gitLast(assetsDir: string, format: string): string {
  return execFileSync('git', ['-C', assetsDir, 'log', '-1', `--format=${format}`], {
    encoding: 'utf8',
  }).trim()
}

const temporaryHomes: string[] = []

/** 建一个临时 home（每个用例独立，失败也不污染其它用例）。 */
function tempHome(label: string): string {
  const home = mkdtempSync(join(tmpdir(), `dev-pack-${label}-`))
  temporaryHomes.push(home)
  return home
}

afterEach(() => {
  while (temporaryHomes.length > 0) {
    rmSync(temporaryHomes.pop() as string, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ *
 * 1. pack 契约
 * ------------------------------------------------------------------ */

describe('devPack 字段契约', () => {
  it('身份字段与任务-02 约定一致', () => {
    expect(devPack.apiVersion).toBe(1)
    expect(devPack.id).toBe('dev')
    expect(devPack.version).toBe('0.1.0')
    expect(devPack.defaultSessionId).toBe('dev')
    expect(devPack.displayName).toBeTruthy()
  })

  it('scheduler / evolutionPolicy 使用约定值', () => {
    expect(devPack.scheduler.timezone).toBe('Asia/Shanghai')
    expect(devPack.evolutionPolicy.window).toBe('30d')
    expect(devPack.evolutionPolicy.independentCases).toBe(3)
  })

  it('零工具：tools() 返回空数组，toolNames 为空', () => {
    expect(devPack.toolNames).toEqual([])
    expect(devPack.tools({} as never, {} as never)).toEqual([])
  })

  it('通过 core 的公开校验，且校验结果确认无工具', () => {
    const validated = validateDomainPack(devPack)
    expect(validated.toolNames).toEqual([])
    expect(validated.tools).toEqual([])
    expect(validated.personaMarkdown).toContain('Dev Leader')
  })

  it('只声明一个资产类型：skill，前缀 skills/', () => {
    expect(devPack.assets.types).toHaveLength(1)
    const skillType = assetType('skill')
    expect(skillType.prefix).toBe('skills/')
    expect(typeof skillType.validate).toBe('function')
  })

  it('bootstrap 是同步函数（async 会让 core 判安装失败）', () => {
    const bootstrap = devPack.assets.bootstrap
    expect(typeof bootstrap).toBe('function')
    expect((bootstrap as { constructor: { name: string } }).constructor.name).not.toBe('AsyncFunction')

    const { writer } = captureWriter()
    const returned = bootstrap?.(writer) as unknown
    expect(returned).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 * 2. bootstrap 行为
 * ------------------------------------------------------------------ */

describe('assets.bootstrap 种子注册', () => {
  it('一次 register 注册 7 个 skill，路径 / message / 类型全部合规', () => {
    const specs = bootstrapSpecs()
    expect(specs).toHaveLength(7)
    expect(specs.every((spec) => spec.type === 'skill')).toBe(true)

    const skillType = assetType('skill')
    for (const spec of specs) {
      expect(spec.path.startsWith(skillType.prefix), `${spec.path} 必须落在 ${skillType.prefix} 下`).toBe(true)
      expect(spec.path.endsWith('/SKILL.md')).toBe(true)
      expect(spec.message).toBe('seed dev skills (domain bootstrap)')
    }

    const names = specs.map((spec) => spec.path.split('/')[1]).sort()
    expect(names).toEqual([...SEED_SKILLS.map((skill) => skill.name)].sort())
  })

  it('每个种子都通过自己类型的 validate（正例）', () => {
    const skillType = assetType('skill')
    for (const spec of bootstrapSpecs()) {
      expect(() => skillType.validate?.(spec.path, spec.content)).not.toThrow()
    }
  })

  it('种子内容与 templates/<name>/SKILL.md 逐字节一致（防漂移）', () => {
    for (const skill of SEED_SKILLS) {
      expect(skill.content, `种子 ${skill.name} 与模板不一致`).toBe(readTemplate(skill.name))
    }
  })

  it('每个种子都有 name / description / whenToUse，且 name 等于目录名', () => {
    for (const spec of bootstrapSpecs()) {
      const dir = spec.path.split('/')[1] as string
      expect(frontmatterField(spec.content, 'name')).toBe(dir)
      expect(frontmatterField(spec.content, 'description')).toBeTruthy()
      expect(frontmatterField(spec.content, 'whenToUse')).toBeTruthy()
    }
  })

  it('dev-test-strategy 明确五栈路由到 references/<stack>.md', () => {
    const content = readTemplate('dev-test-strategy')
    for (const stack of ['go', 'node-ts', 'react', 'harmony-arkts', 'python']) {
      expect(content).toContain(`references/${stack}.md`)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 3. validate 反例（纯函数，无 IO）
 * ------------------------------------------------------------------ */

describe('assets.types[].validate 语义校验', () => {
  const skillType = assetType('skill')
  const skillPath = `${skillType.prefix}dev-decompose/SKILL.md`

  it('frontmatter.name 与目录名不一致 → 抛错且消息含两者', () => {
    const content = ['---', 'name: other-skill', 'description: 随便写点什么', '---', ''].join('\n')
    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/other-skill/)
    try {
      skillType.validate?.(skillPath, content)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('dev-decompose')
      expect(message).toContain('other-skill')
    }
  })

  it('缺少 frontmatter → 抛错', () => {
    expect(() => skillType.validate?.(skillPath, '# 没有 frontmatter\n')).toThrowError(/frontmatter/)
  })

  it('description 为空 → 抛错', () => {
    const content = ['---', 'name: dev-decompose', 'description:   ', '---', ''].join('\n')
    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/description/)
  })

  it('name 缺失 → 抛错', () => {
    const content = ['---', 'description: 只有描述', '---', ''].join('\n')
    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/name/)
  })

  it('路径形状不合法 → 抛错（不允许把 SKILL.md 直接放在 prefix 根）', () => {
    expect(() =>
      skillType.validate?.(`${skillType.prefix}SKILL.md`, '---\nname: x\ndescription: y\n---\n'),
    ).toThrowError(/SKILL\.md/)
  })
})

/* ------------------------------------------------------------------ *
 * 4. 固件 Skill
 * ------------------------------------------------------------------ */

describe('固件 Skill', () => {
  it('恰好 3 个，名称唯一且不占用 core 保留名', () => {
    const firmware = devPack.firmwareSkills ?? []
    expect(firmware).toHaveLength(3)
    const names = firmware.map((skill) => skill.name)
    expect(new Set(names).size).toBe(3)
    for (const name of names) {
      expect(FIRMWARE_SKILL_NAMES).not.toContain(name)
    }
  })

  it('正文来自 skills/<name>/SKILL.md，frontmatter.name 与固件名一致', () => {
    for (const skill of devPack.firmwareSkills ?? []) {
      expect(skill.markdown).toBe(readFirmware(skill.name))
      expect(frontmatterField(skill.markdown, 'name')).toBe(skill.name)
      expect(frontmatterField(skill.markdown, 'description')).toBeTruthy()
      expect(frontmatterField(skill.markdown, 'whenToUse')).toBeTruthy()
    }
  })

  it('3 个固件与 7 个种子名称互不重复', () => {
    const firmwareNames = new Set((devPack.firmwareSkills ?? []).map((skill) => skill.name))
    for (const seed of SEED_SKILLS) {
      expect(firmwareNames.has(seed.name)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 5. 人设与 preset 隔离
 * ------------------------------------------------------------------ */

describe('Leader 人设与子 agent 隔离', () => {
  const persona = devPack.persona.markdown()

  it('人设非空、含 Leader 身份与硬约束，且不超过 64 KB', () => {
    expect(persona.trim().length).toBeGreaterThan(0)
    expect(persona).toContain('Dev Leader')
    expect(persona).toContain('绝不自己写业务代码')
    expect(Buffer.byteLength(persona, 'utf8')).toBeLessThanOrEqual(64 * 1024)
  })

  it('cordis.patch.yml：3 个 preset 都用 complete: true 切断 Leader 人设继承', () => {
    const patch = readRepoFile('cordis.patch.yml')
    const sections = patch.split(/\n {4}- id: preset-dev-/).slice(1)
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      const head = section.slice(0, section.indexOf('\n\n'))
      expect(head, '每个 preset 的 persona 必须 complete: true').toContain('complete: true')
    }
  })

  it('cordis.patch.yml：Leader preset 与顶层都挂了 subagent，且限深 1', () => {
    const patch = readRepoFile('cordis.patch.yml')
    expect(patch).toContain('allowedAgentPresets: [dev-developer, dev-tester]')
    expect(patch).toContain('maxDepth: 1')
    // Leader preset 内 + 顶层补丁，共两处 tool-subagent 配置。
    expect(patch.match(/id: tool-subagent/g)).toHaveLength(2)

    const leaderBlock = patch.split('preset-dev-leader')[1].split('preset-dev-developer')[0] as string
    expect(leaderBlock).toContain('id: tool-subagent')

    // 子 agent preset 不挂 subagent（maxDepth=1 下也无法再派发）。
    const developerBlock = patch.split('preset-dev-developer')[1].split('preset-dev-tester')[0] as string
    const testerBlock = patch.split('preset-dev-tester')[1].split('\n# 顶层补丁')[0] as string
    expect(developerBlock).not.toContain('tool-subagent')
    expect(testerBlock).not.toContain('tool-subagent')
  })
})

/* ------------------------------------------------------------------ *
 * 6. 真实 core 集成（AgentHost.install）
 * ------------------------------------------------------------------ */

describe('真实 core 集成：install / 一次提交 / 拆卸', () => {
  it('install 成功：active.id = dev，7 个种子落盘，一批只产生一个提交', () => {
    const home = tempHome('install')
    const host = new AgentHost(new Context())
    const dispose = host.install(devPack, { home })
    try {
      expect(host.active?.id).toBe('dev')
      expect(host.active?.runtime.sessionId).toBe('dev')

      const assetsDir = host.active?.runtime.assetsDir as string
      const skillDirs = readdirSync(join(assetsDir, 'skills')).sort()
      expect(skillDirs).toEqual([...SEED_SKILLS.map((skill) => skill.name)].sort())
      for (const skill of SEED_SKILLS) {
        expect(existsSync(join(assetsDir, 'skills', skill.name, 'SKILL.md'))).toBe(true)
      }

      expect(gitLast(assetsDir, '%an')).toBe(GIT_IDENTITY_NAME)
      const full = gitLast(assetsDir, '%B')
      expect(full).toContain('seed dev skills (domain bootstrap)')
      // 初始化仓库 1 个 + 本次批量 1 个。
      expect(gitCommitCount(assetsDir)).toBe(2)
    } finally {
      dispose()
    }
  })

  it('安装后人设为 Dev Leader；dispose 后恢复 core 兜底人设，资产保留', async () => {
    const sections: Array<{ name: string; order: number; text: string | ((ctx: unknown) => string) }> = []
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      section(section: (typeof sections)[number]) {
        sections.push(section)
        return () => {
          const index = sections.indexOf(section)
          if (index >= 0) sections.splice(index, 1)
        }
      },
    } as never)

    const home = tempHome('dispose')
    const host = new AgentHost(ctx)

    const deadline = Date.now() + 2000
    while (!sections.some((section) => section.name === 'rsi-agent:persona')) {
      if (Date.now() > deadline) throw new Error('persona section 未挂载')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const personaText = (): string => {
      const section = sections.find((item) => item.name === 'rsi-agent:persona')
      if (section === undefined) throw new Error('persona section 不存在')
      return typeof section.text === 'function' ? section.text({}) : section.text
    }

    const dispose = host.install(devPack, { home })
    const assetsDir = host.active?.runtime.assetsDir as string
    expect(personaText()).toContain('Dev Leader')
    expect(personaText()).not.toBe(loadCorePersonaMarkdown())

    dispose()

    expect(host.active).toBeUndefined()
    expect(personaText()).toBe(loadCorePersonaMarkdown())
    expect(existsSync(join(assetsDir, 'skills', 'dev-decompose', 'SKILL.md'))).toBe(true)

    await ctx.fiber.dispose()
  }, 20_000)

  it('坏种子（name 与目录不一致）→ install 抛错，且不产生提交', () => {
    const home = tempHome('negative')
    const host = new AgentHost(new Context())
    const broken: DomainPack = {
      ...devPack,
      assets: {
        types: devPack.assets.types,
        bootstrap(writer: AssetWriter) {
          writer.register([
            {
              type: 'skill',
              path: 'skills/dev-decompose/SKILL.md',
              content: '---\nname: wrong-name\ndescription: 坏种子\n---\n',
              message: 'seed dev skills (domain bootstrap)',
            },
          ])
        },
      },
    }

    expect(() => host.install(broken, { home })).toThrowError(/与目录名不一致|wrong-name/)
    const files = Object.keys(snapshotAssets(join(home, 'dev', 'assets')))
    expect(files.filter((path) => path.startsWith('skills/'))).toEqual([])
  })
})

/** 递归快照：相对路径 → 内容（跳过 `.git`，只看真实资产文件）。 */
function snapshotAssets(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(dir)) return result
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const absolute = join(current, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(absolute, relative)
      else result[relative] = readFileSync(absolute, 'utf8')
    }
  }
  walk(dir, '')
  return result
}

/* ------------------------------------------------------------------ *
 * 7. 源码卫生
 * ------------------------------------------------------------------ */

describe('源码卫生', () => {
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

  function sourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...sourceFiles(absolute))
      else if (entry.name.endsWith('.ts')) files.push(absolute)
    }
    return files
  }

  it('只 import core 的公开导出（禁止 dist-server / src 深层路径）', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      const content = readFileSync(file, 'utf8')
      if (/dsh-rsi-agent\/(dist-server|src|dist)/.test(content)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it("不出现 'skills/' + 字符串拼接（路径必须由 assetPath 派生）", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      if (file.endsWith('seeds.ts')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/['"`]skills\/['"`]\s*\+/.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
