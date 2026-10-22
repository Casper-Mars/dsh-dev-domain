/**
 * `dsh-dev-domain` 的领域包定义。
 *
 * 设计边界（任务-02）：
 *   - **零工具**：`tools()` 返回空数组，`toolNames` 为空；
 *   - **零状态文件**：不写业务数据，只通过 `assets.bootstrap` 注册 7 个可进化
 *     Skill 种子与其 references 参考文档（由 core 落到 `<home>/assets/skills/`
 *     并产生一个 commit）；
 *   - **只用 dsh 内置能力**：文件 / 命令 / 技能 / 待办 / 子 agent 均由 preset
 *     组合提供，领域包不重复实现。
 *
 * 契约要点（全部来自 `dsh-rsi-agent` 的公开导出，不触碰 core 内部实现）：
 *   - 资产前缀只在 {@link ASSET_TYPES} 声明一次，路径一律由 `assetPath` 派生；
 *   - 资产内容校验放领域自己的 `validate`（纯函数、无 IO）；
 *   - `bootstrap` 必须**同步**，并且只调用**一次** `writer.register`，
 *     这样 core 只会产生一个 commit。
 */
import type {
  AssetSpec,
  AssetType,
  AssetWriter,
  DomainPack,
  FirmwareSkill,
} from 'dsh-rsi-agent'
import { loadFirmwareMarkdown, SKILL_FILE } from './firmware.js'
import { SEED_SKILLS } from './seeds.js'

/* ------------------------------------------------------------------ *
 * 常量（前缀 / 文件名的唯一真源）
 * ------------------------------------------------------------------ */

/** 领域资产类型名：可进化 SKILL。 */
const SKILL_TYPE = 'skill'
/** SKILL 资产前缀（相对资产根目录）。 */
const SKILL_PREFIX = 'skills/'
/** 参考文档目录名：skill 目录下唯一允许的子目录。 */
const REFERENCES_DIR = 'references'
/** 参考文档扩展名。 */
const REFERENCE_EXT = '.md'
/** 种子资产的统一提交说明（一次 register ⇒ 一个 commit）。 */
const SEED_MESSAGE = 'seed dev skills (domain bootstrap)'

/** 资产前缀读取：类型名 → 已声明前缀。 */
function assetPrefix(typeName: string): string {
  const found = ASSET_TYPES.find((item) => item.name === typeName)
  if (found === undefined) {
    throw new Error(`[dev] 未声明的资产类型："${typeName}"`)
  }
  return found.prefix
}

/** 由类型前缀派生资产路径（禁止调用方手拼前缀）。 */
function assetPath(typeName: string, ...segments: string[]): string {
  return assetPrefix(typeName) + segments.join('/')
}

/* ------------------------------------------------------------------ *
 * frontmatter（YAML 子集）解析 —— 纯字符串处理，不引入依赖、不做 IO
 * ------------------------------------------------------------------ */

const FRONTMATTER_FENCE = '---'

/**
 * 解析 `---` 包裹的 frontmatter，返回 `key → value` 映射。
 *
 * 只支持本领域需要的 YAML 子集：`key: value` 单行标量（可带成对引号）。
 * 缺 frontmatter（未以 `---` 开头或无结束行）时返回 `undefined`。
 */
function parseFrontmatter(content: string): Map<string, string> | undefined {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return undefined

  const fields = new Map<string, string>()
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (line.trim() === FRONTMATTER_FENCE) return fields
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    fields.set(key, value)
  }
  return undefined
}

/** 类型化描述一个未知值，用于错误信息里给出**实际值**。 */
function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined（缺失）'
  if (typeof value === 'string') return JSON.stringify(value)
  return `${typeof value} ${String(value)}`
}

/* ------------------------------------------------------------------ *
 * 资产内容校验（纯函数、无 IO；抛错即整批 register 失败）
 * ------------------------------------------------------------------ */

/** skill 资产路径的两种合法形状：SKILL.md 本体，或 skill 目录下的参考文档。 */
type SkillAssetShape =
  | { readonly kind: 'skill'; readonly dir: string }
  | { readonly kind: 'reference'; readonly dir: string }

/** 路径形状不合法的统一错误（消息里带实际路径，便于定位到具体资产）。 */
function invalidSkillPath(path: string): Error {
  return new Error(
    `[dev] skill 资产路径必须是 "${SKILL_PREFIX}<目录>/${SKILL_FILE}" 或 ` +
      `"${SKILL_PREFIX}<目录>/${REFERENCES_DIR}/<文件>${REFERENCE_EXT}"，实际为 "${path}"`,
  )
}

/**
 * 解析 skill 资产路径。
 *
 * 只接受两种形状：
 *   - `skills/<dir>/SKILL.md`
 *   - `skills/<dir>/references/<file>.md`（只允许一层、只允许 .md）
 *
 * 显式拒绝空段、`.`、`..`、反斜杠与绝对路径：这些是路径穿越入口。虽然上游
 * writer 已做白名单，领域侧仍自己兜一层，保证「校验失败可定位到具体路径」。
 */
function parseSkillAssetPath(path: string): SkillAssetShape {
  if (path.startsWith('/') || path.includes('\\')) throw invalidSkillPath(path)
  if (!path.startsWith(SKILL_PREFIX)) throw invalidSkillPath(path)

  const segments = path.slice(SKILL_PREFIX.length).split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') throw invalidSkillPath(path)
  }

  const dir = segments[0] as string
  if (segments.length === 2 && segments[1] === SKILL_FILE) {
    return { kind: 'skill', dir }
  }

  const file = segments[2] ?? ''
  if (
    segments.length === 3 &&
    segments[1] === REFERENCES_DIR &&
    file.length > REFERENCE_EXT.length &&
    file.endsWith(REFERENCE_EXT)
  ) {
    return { kind: 'reference', dir }
  }

  throw invalidSkillPath(path)
}

/**
 * skill 资产校验。
 *
 * - `SKILL.md`：frontmatter 必须存在，`name` 必须等于目录名，`description` 非空；
 * - `references/<file>.md`：只要求内容非空（参考文档没有 frontmatter 约定）。
 *
 * `name` 必须等于目录名：skill-filesystem provider 以**目录名**发布技能，
 * 而 frontmatter.name 是模型侧看到的技能名；两者不一致会让「磁盘上叫 A、
 * 调用时叫 B」，属于领域语义错误。
 */
function validateSkillAsset(path: string, content: string): void {
  const shape = parseSkillAssetPath(path)

  if (shape.kind === 'reference') {
    if (content.trim() === '') {
      throw new Error(`[dev] skill 参考文档 "${path}" 内容为空`)
    }
    return
  }

  const dir = shape.dir
  const frontmatter = parseFrontmatter(content)
  if (frontmatter === undefined) {
    throw new Error(
      `[dev] skill 资产 "${path}" 缺少 YAML frontmatter（必须以 "${FRONTMATTER_FENCE}" 开头并以 "${FRONTMATTER_FENCE}" 结束）`,
    )
  }

  const name = frontmatter.get('name')?.trim()
  if (name === undefined || name === '') {
    throw new Error(
      `[dev] skill 资产 "${path}" 的 frontmatter 缺少非空 name 字段，实际为 ${describeValue(frontmatter.get('name'))}`,
    )
  }
  if (name !== dir) {
    throw new Error(
      `[dev] skill 资产 frontmatter.name 与目录名不一致：name=${describeValue(name)}、目录名=${describeValue(dir)}（路径 "${path}"）`,
    )
  }

  const description = frontmatter.get('description')?.trim()
  if (description === undefined || description === '') {
    throw new Error(
      `[dev] skill 资产 "${path}" 的 frontmatter 缺少非空 description 字段，实际为 ${describeValue(frontmatter.get('description'))}`,
    )
  }
}

/**
 * 资产类型声明。
 *
 * 本领域只有一种资产：可进化 Skill。前缀只在这里出现一次。
 */
const ASSET_TYPES: readonly AssetType[] = [
  { name: SKILL_TYPE, prefix: SKILL_PREFIX, validate: validateSkillAsset },
]

/* ------------------------------------------------------------------ *
 * 固件 Skill（随包发布、只读、不参与进化）
 * ------------------------------------------------------------------ */

/**
 * 3 个固件 Skill：name 必须 kebab-case，且不得占用 core 保留名。
 *
 * 声明本身仍是契约校验与文档的真源；**运行时注册**由 `src/plugin.ts` 用
 * `ctx.skills.register()` 完成（core 只消费 `firmwareSkills` 做重名校验，
 * 不注册这里的 markdown）。
 */
const FIRMWARE_SKILLS: readonly FirmwareSkill[] = [
  {
    name: 'dev-leader-rules',
    description: 'Leader 拆解、调度、验收、汇报；team 模式不编码不测试，solo 仅限 size=S。',
    markdown: loadFirmwareMarkdown('dev-leader-rules'),
  },
  {
    name: 'dev-dispatch-contract',
    description: '派发上下文卡片、preset 选择、超时与返回格式的契约。',
    markdown: loadFirmwareMarkdown('dev-dispatch-contract'),
  },
  {
    name: 'dev-quality-gate',
    description: '内容 / 格式 / 逻辑三维质量闸门与证据门槛。',
    markdown: loadFirmwareMarkdown('dev-quality-gate'),
  },
]

/* ------------------------------------------------------------------ *
 * 人设
 * ------------------------------------------------------------------ */

/**
 * Dev Leader 人设（主会话注入）。
 *
 * 只写「身份 + 硬约束 + 流程指针」，细节留在 3 个固件 Skill 与 7 个可进化
 * Skill 里，避免 system prompt 膨胀；子 agent 通过 preset 的 `complete: true`
 * 使用各自人设，不继承这里的 Leader 规则。
 */
const LEADER_PERSONA = [
  '# Dev Leader',
  '',
  '你是开发领域的 Leader。职责固定为：拆解需求、调度或受控执行、验收产出、向用户汇报。执行方式按 team / solo 两种模式区分。',
  '',
  '## 硬约束',
  '',
  '- `team` 模式（默认）：你不写业务代码，也不自己执行验收测试；编码任务派给 `dev-developer`，验证任务派给 `dev-tester`。',
  '- `solo` 模式：仅当任务满足 `dev-leader-rules` 的全部 size=S 条件（且不属于安全 / 权限 / 支付 / 密钥 / 数据迁移类）时才允许。此时由你自己建 worktree，跑 typecheck / test / build，逐条记录命令与退出码，并在交付里声明「本次为 solo，无独立 Tester」并列出未覆盖项。',
  '- 判定不了，或任一项超出 size=S：一律按 `team` 处理。',
  '- 一次只推进一个任务；任务完成并得到用户确认后，才进入下一个。',
  '- 需求或验收标准不明确时先问用户，不臆造。',
  '',
  '## 工作方式',
  '',
  '1. 读完整任务说明，提取可验证的验收标准。',
  '2. 按「派发契约」组装上下文卡片，再调用 `subagent`。',
  '3. 子 agent 返回后先做完整性检查，再派 Tester 独立验证。',
  '4. 交付时给出证据与未覆盖项，然后停下等用户确认。',
  '',
  '详细规则见固件 Skill：`dev-leader-rules`、`dev-dispatch-contract`、`dev-quality-gate`。',
  '可进化 Skill（`dev-decompose`、`dev-ralph-loop`、`dev-worktree-git`、`dev-test-strategy`、`dev-role-developer`、`dev-role-tester`、`dev-retro`）按需读取。',
  '',
  '始终使用中文回复。结论先行，不啰嗦。',
].join('\n')

/* ------------------------------------------------------------------ *
 * 领域包
 * ------------------------------------------------------------------ */

/** `dev` 领域包。 */
export const devPack: DomainPack = {
  apiVersion: 1,
  id: 'dev',
  displayName: 'Dev Domain',
  version: '0.1.0',
  defaultSessionId: 'dev',
  persona: {
    markdown: () => LEADER_PERSONA,
  },
  assets: {
    types: ASSET_TYPES,
    /**
     * 注册式资产入口：**一次** `register([...])` 写入 7 个可进化 Skill 与其参考文档。
     *
     * core 会先全量校验（含上面的 `validate`），全部通过才落盘，并且只产生
     * **一个** commit。必须同步；抛错会让 core 回滚整个 install。
     */
    bootstrap(writer: AssetWriter) {
      const specs: AssetSpec[] = []
      for (const skill of SEED_SKILLS) {
        specs.push({
          type: SKILL_TYPE,
          path: assetPath(SKILL_TYPE, skill.name, SKILL_FILE),
          content: skill.content,
          message: SEED_MESSAGE,
        })
        for (const reference of skill.references ?? []) {
          specs.push({
            type: SKILL_TYPE,
            path: assetPath(SKILL_TYPE, skill.name, reference.path),
            content: reference.content,
            message: SEED_MESSAGE,
          })
        }
      }
      // 单次 register：12 个资产（7 个 SKILL + 5 个 references）同批落盘，只产生一个 commit。
      writer.register(specs)
    },
  },
  firmwareSkills: FIRMWARE_SKILLS,
  // 本领域不定义工具：文件 / 命令 / 技能 / 待办 / 子 agent 全部由 preset 组合。
  tools: () => [],
  toolNames: [],
  scheduler: {
    timezone: 'Asia/Shanghai',
  },
  evolutionPolicy: {
    window: '30d',
    independentCases: 3,
  },
}
