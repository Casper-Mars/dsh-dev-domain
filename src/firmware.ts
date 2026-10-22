/**
 * 固件 SKILL 的加载、解析与 `ctx.skills.register()` 参数构造。
 *
 * 背景（任务-02 修复）：core 的 `registerFirmwareSkills()` 只注册 **core 自己**
 * 的 3 个固件 SKILL（`rsi-evolution` / `skill-authorship` / `task-authorship`），
 * `pack.firmwareSkills` 仅用于**重名冲突校验** —— core **不会**注册领域声明的
 * markdown。因此领域侧必须自己把这 2 个固件 SKILL 静态注册进 `ctx.skills`，
 * 否则挂载后 `skills.get('dev-dispatch-contract')` 拿不到任何东西。
 *
 * 注：Leader 的行为规则不在固件里，而是并入 `src/pack.ts` 的 `LEADER_PERSONA`
 * （由 core 注入 `rsi-agent:persona`）。
 *
 * 本模块只做三件事（全部无副作用、可单测）：
 *   1. 从 `import.meta.url` 推导 `SKILL.md` 绝对路径（源码态 / dist 态同一语义）；
 *   2. 解析 frontmatter 三字段（name / description / whenToUse）并**剥离** frontmatter；
 *   3. 构造 `SkillRegistration`（source=runtime、resourceBase=SKILL 目录、双端可调用）。
 */
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { FirmwareSkill } from 'dsh-rsi-agent'

/** SKILL 文件名（上游 skill-filesystem provider 只认这个文件名）。 */
export const SKILL_FILE = 'SKILL.md'

/** frontmatter 围栏。 */
const FRONTMATTER_FENCE = '---'

/** `---\n...\n---\n` 整块（含 BOM 容错）。 */
const FRONTMATTER_PATTERN = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** 解析后的固件 SKILL：frontmatter 三字段 + 去掉 frontmatter 的正文。 */
export interface ParsedFirmwareSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
}

/** 去掉成对引号（YAML 子集）。 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * 解析 SKILL.md：frontmatter 三字段必填，正文不含 frontmatter。
 *
 * 刻意不引入 YAML 依赖（与 core 同策略）：固件 SKILL 的 frontmatter 只有三个
 * 扁平标量，轻量解析足够，也避免为一个字段引入完整解析器的攻击面。
 *
 * @param markdown SKILL.md 原文。
 * @param source 出错时用于定位的来源（通常是文件路径）。
 * @throws {Error} 缺 frontmatter 或三字段任一缺失时。
 */
export function parseFirmwareSkillMarkdown(
  markdown: string,
  source = '<inline>',
): ParsedFirmwareSkill {
  const normalized = markdown.replace(/^\uFEFF/, '')
  const match = FRONTMATTER_PATTERN.exec(normalized)
  if (match === null) {
    throw new Error(
      `[dev] 固件 SKILL "${source}" 缺少 YAML frontmatter（必须以 "${FRONTMATTER_FENCE}" 开头并以 "${FRONTMATTER_FENCE}" 结束）`,
    )
  }

  const fields = new Map<string, string>()
  for (const rawLine of (match[1] as string).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = unquote(line.slice(separator + 1).trim())
    if (key !== '') fields.set(key, value)
  }

  for (const key of ['name', 'description', 'whenToUse'] as const) {
    const value = fields.get(key)?.trim()
    if (value === undefined || value === '') {
      throw new Error(`[dev] 固件 SKILL "${source}" 的 frontmatter 缺少非空字段 "${key}"`)
    }
  }

  return {
    name: (fields.get('name') as string).trim(),
    description: (fields.get('description') as string).trim(),
    whenToUse: (fields.get('whenToUse') as string).trim(),
    content: normalized.slice(match[0].length),
  }
}

/**
 * 固件 SKILL 的 `SKILL.md` 绝对路径。
 *
 * 路径相对 `import.meta.url`：源码态 `src/firmware.ts` → `<包根>/skills/`；
 * 编译态 `dist-server/firmware.js` → 同样是 `<包根>/skills/`（`files` 已包含
 * `skills/`），因此两种形态共用一条路径语义。
 */
export function firmwareSkillPath(name: string): string {
  return fileURLToPath(new URL(`../skills/${name}/${SKILL_FILE}`, import.meta.url))
}

/** 读取固件 SKILL 原文；失败时点名路径（构建期资源缺失属于打包错误）。 */
export function loadFirmwareMarkdown(name: string): string {
  const path = firmwareSkillPath(name)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`[dev] 无法读取固件 SKILL "${path}"：${reason}`)
  }
}

/**
 * 构造 `ctx.skills.register()` 的入参。
 *
 * - `description` / `whenToUse` / `content` 来自 SKILL.md 的 frontmatter 与正文
 *   （正文**不含** frontmatter，避免把元数据塞进模型可见内容）；
 * - `path` = SKILL.md 的绝对路径，`resourceBase` 指向其所在目录（供相对资源解析）；
 * - `source: 'runtime'`：与 core 的静态注册同口径，走 dsh-skill 的 runtime provider；
 * - 双端可调用（模型 + 用户）。
 *
 * @throws {Error} frontmatter 缺字段，或 frontmatter.name 与声明名不一致时。
 */
export function buildFirmwareSkillRegistration(skill: FirmwareSkill): SkillRegistration {
  const path = firmwareSkillPath(skill.name)
  const parsed = parseFirmwareSkillMarkdown(skill.markdown, path)
  if (parsed.name !== skill.name) {
    throw new Error(
      `[dev] 固件 SKILL 声明名与 frontmatter.name 不一致：声明 "${skill.name}"、frontmatter "${parsed.name}"（${path}）`,
    )
  }

  return {
    name: skill.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    path,
    source: 'runtime',
    resourceBase: { kind: 'directory', path: dirname(path) },
    content: parsed.content,
    invocation: { modelInvocable: true, userInvocable: true },
  }
}

/** 被跳过的固件 SKILL 及原因。 */
export interface SkippedFirmwareSkill {
  readonly name: string
  /** `duplicate-declaration`：声明里重名；`already-registered`：注册表已有同名条目。 */
  readonly reason: 'duplicate-declaration' | 'already-registered'
}

/** 注册计划：待注册项 + 跳过项。 */
export interface FirmwareSkillPlan {
  readonly registrations: readonly SkillRegistration[]
  readonly skipped: readonly SkippedFirmwareSkill[]
}

/** 计划选项。 */
export interface PlanFirmwareSkillOptions {
  /** 返回 `true` 表示注册表已有同名条目，跳过并 warn（避免重复注册）。 */
  readonly skip?: (name: string) => boolean
}

/**
 * 把 `pack.firmwareSkills` 收敛成一份可执行的注册计划（纯函数）。
 *
 * 两层查重：
 *   1. 声明内部重名 → `duplicate-declaration`；
 *   2. 调用方 `skip(name)` 命中的（注册表已存在）→ `already-registered`。
 *
 * @param skills `pack.firmwareSkills`（可缺省）。
 * @param options 查重回调。
 */
export function planFirmwareSkillRegistrations(
  skills: readonly FirmwareSkill[] | undefined,
  options: PlanFirmwareSkillOptions = {},
): FirmwareSkillPlan {
  const registrations: SkillRegistration[] = []
  const skipped: SkippedFirmwareSkill[] = []
  const declared = new Set<string>()

  for (const skill of skills ?? []) {
    if (declared.has(skill.name)) {
      skipped.push({ name: skill.name, reason: 'duplicate-declaration' })
      continue
    }
    declared.add(skill.name)
    if (options.skip?.(skill.name) === true) {
      skipped.push({ name: skill.name, reason: 'already-registered' })
      continue
    }
    registrations.push(buildFirmwareSkillRegistration(skill))
  }

  return { registrations, skipped }
}
