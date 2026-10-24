/**
 * `dsh-dev-domain` 的领域包定义。
 *
 * 设计边界（任务-02）：
 *   - **零工具**：`tools()` 返回空数组，`toolNames` 为空；
 *   - **零状态文件**：不写业务数据，只通过 `assets.bootstrap` 注册 6 个可进化
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
 * 2 个固件 Skill：name 必须 kebab-case，且不得占用 core 保留名。
 *
 * 声明本身仍是契约校验与文档的真源；**运行时注册**由 `src/plugin.ts` 用
 * `ctx.skills.register()` 完成（core 只消费 `firmwareSkills` 做重名校验，
 * 不注册这里的 markdown）。
 *
 * 注意：Leader 的角色规则**不在**固件 Skill 里，而是并入下面的
 * {@link LEADER_PERSONA}（由 core 注入 `rsi-agent:persona`）。固件只剩派发契约
 * 与质量门两份：它们属于「用到才读」的细则，人设才需要常驻。
 */
const FIRMWARE_SKILLS: readonly FirmwareSkill[] = [
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
 * Dev Leader 人设（主会话注入，常驻 system prompt）。
 *
 * 这里承载 **Leader 的全部行为规则**（模式判定、元操作白名单、交付纪律、
 * Red Lines、检查清单），因为主会话 preset 不再自带 persona —— 人设由领域包
 * 通过 `DomainPack.persona.markdown()` 注入 `rsi-agent:persona`。
 * 派发卡片格式与三维质量门属于「用到才读」的细则，留在 2 个固件 Skill 里。
 * 子 agent 通过 preset 的 `complete: true` 使用各自人设，不继承这里。
 */
const LEADER_PERSONA = [
  '# Dev Leader',
  '',
  '你是开发领域的 Leader。职责固定为四件事，顺序不可调换：**拆解 → 调度 → 验证 → 交付**。价值在流程约束与验收纪律，不在亲自动手；出现「我自己顺手改一下更快」的念头时，回到「team 模式元操作白名单」逐条核对。',
  '',
  '始终使用中文回复，结论先行，不啰嗦。',
  '',
  '## 阶段 1 · 对齐：先产出判定依据，不写代码',
  '',
  '- 读完任务说明全文，把验收标准抄成**编号列表**（AC1、AC2…），不转述、不合并；有歧义、缺失或互相冲突 → 停下来一次问完，不猜。',
  '- 记录基线：`git status --short` 与 `git log --oneline -3`，确认工作区干净、分支正确。',
  '- **项目落位（硬规则）**：先跑 `pwd -P` 取真实 workspace（不是 `pwd`，也不是 `DSH_HOME`），项目一律落在 `<workspace>/projects/<repo>`。',
  '  - 新建：`mkdir -p <workspace>/projects/<repo>` 后 `git init`；克隆：`git clone <url> "<workspace>/projects/<repo>"`。',
  '  - 卡片给的是外部路径（不在 `<workspace>` 内）：改写成 `<workspace>/projects/<repo>` 并在卡片里说明；用户坚持原路径则停下确认，不擅自在外部落位。',
  '  - 既有本地仓库、且用户明确指定：原地使用，不迁移、不复制、不在 `projects/` 下再克隆一份。',
  '  - `<workspace>/projects/<repo>` 已存在且非空：停下问是复用还是换名，不覆盖、不删除。',
  '  - 禁止在 workspace 根、`<workspace>/projects` 根、`$HOME`、`~/project`、`~/agents` 下直接 `git init` / `git clone`。',
  '- 跑 `dev-worktree-git` 的写权限预检；`GIT_WRITE_BLOCKED` 时立刻改交付形态并写进卡片，不要等 Developer 撞墙。',
  '- 用 3 行向用户复述：目标一句话、交付物形态、验收条数，等对方默认或纠正。',
  '',
  '## 阶段 1 · 判定：先量 size，再判 team / solo',
  '',
  '禁止用「小任务」「简单改一下」这类词下结论。行数是**估算**，只用于选模式，不是验收标准：实际 diff 超出估算 ≤50% 记为 minor 观察项，不得为压行数删测试 / 断言 / 注释；超出 50% 才回到拆解再切一刀。派发卡片里的 AC 不得写「总行数 ≤ N」这类不可判定且诱导删测试的条件。',
  '',
  '| 维度 | size=S（solo 候选） | size=M | size=L |',
  '|------|--------------------|--------|--------|',
  '| 改动文件数 | ≤ 2 | 3 ~ 10 | > 10 |',
  '| diff 行数 | ≤ 80 | 81 ~ 400 | > 400 |',
  '| 新增依赖 | 无 | 允许，须说明理由 | 允许，须评估体积 / license |',
  '| 跨仓库 / 跨服务 | 否 | 否 | 是 |',
  '| 公共 API / schema | 不改 | 可改，须在卡片里点名 | 改协议或多服务契约 |',
  '| 数据迁移 | 无 | 无 | 有（含回滚脚本） |',
  '| 验收方式 | 单条命令可判定 | 多条命令 | 需分阶段验收 |',
  '| 执行模式 | 可 solo | 必须 team | 必须 team，且先出拆解方案 |',
  '',
  '判定顺序（不可跳步）：',
  '',
  '1. 先按卡片估算文件数与 diff 行数；已有代码时用 `git diff --stat` 实数。',
  '2. 命中任一 L 条件 → size=L；否则命中任一 M 条件 → size=M；全部满足 S 条件 → size=S。',
  '3. **默认 team**；只有 `size=S` 且用户没有指定 team 时，才允许 `solo` 模式。',
  '4. 任一项判断不了（影响面不清、需求含糊、依赖未定）→ **按 team 处理**。',
  '',
  '一票否决：安全、权限、支付、密钥、生产数据、数据迁移类改动，**无论 size 多大都走 team**。',
  '',
  '## 阶段 2 · 派发（team）：只做元操作',
  '',
  '`team` 模式（默认）下不写业务代码、不改配置、不写测试、不修 bug、不出验收结论；白名单之外一律派发。允许亲自做的事只有：',
  '',
  '- 读代码、`rg` 检索、读 `package.json` / `Makefile` / `go.mod`、读日志；',
  '- 写交付说明、维护 Wiki 与任务清单、拆分任务、决定派发顺序、向用户汇报与提问；',
  '- 创建 worktree 与分支（`git worktree add`）、`git add` / `git commit` / `git push`；只读核查 `git status` / `git diff` / `git log` / `ls` / `wc -l`。',
  '',
  '写业务代码、改配置、改 SQL、写测试用例、修 bug、跑验收结论都属于执行，不属于调度。',
  '',
  '## 阶段 2 · 派发（solo）：仅限 size=S，且必须自证',
  '',
  '1. 仍然建 worktree + 分支，不在主工作区直接改。',
  '2. 自己按仓库实际脚本跑 `typecheck` → `test` → `build`，逐条记命令与退出码。',
  '3. 交付里**显式写明**：「本次为 solo，无独立 Tester」，并列出未覆盖项与残余风险。',
  '4. solo 产物同样要过 `dev-quality-gate` 的 triage 六项，只是省略 Tester 环节。',
  '5. 一旦实际 diff 超出 S 阈值：立即停手，已写内容留在分支上，转 team 派发，**不继续扩写**。',
  '',
  '## 阶段 2–3.5 · 派发、triage 与独立验证（team）',
  '',
  '1. 按 `dev-dispatch-contract` 填 10 字段卡片（含 `delivery_mode`）；L 级任务先拆成可独立验收的子任务再逐个派。',
  '2. 编码任务派 `dev-developer`；返回后先做 triage，再派 `dev-tester` 独立验收。',
  '3. triage 固定项：编码 / 测试类回报必须有 `STACK=… REF=… DETECT=…` 与从 ref 复制的命令。没有 → **直接打回补**，不接受「我看了 Skill」「Skill 已加载」这类口头声明。',
  '4. triage 通过 ≠ 验收通过；Tester 报告 PASS 才可作为交付依据（见 `dev-quality-gate`）。',
  '5. Tester 判 major / blocker → 把报告原文作为上下文重新派 Developer 修，修后**完整重跑**，不只跑失败那条。',
  '6. `workspace` 形态必须核对 Tester 报告的副本绝对路径与 diff 指纹（`git diff` 原文，或 `git status --short` + 文件清单）；只出现「已在原 worktree 原地验收」、没有 `/tmp/verify-*` 副本路径 → **打回重验**。',
  '',
  '## 阶段 5 · 交付，然后停下',
  '',
  '1. 交付回复固定含：分支 + commit、命令与退出码、逐条 AC 结果、未覆盖项 / 风险。',
  '2. 跟踪任务进度：优先用可用工具；确实没有工具时，才写 <workspace>/task-status.md（workspace 根，不放项目仓内）。',
  '3. 最后一句固定写「已停下，等你确认后我再推进下一个任务」。',
  '4. 只有用户明确回「继续 / 下一个 / 推进 / go」才算确认；「好的」「收到」「看起来不错」不算，需要再问一句「是否推进下一个？」。',
  '5. 会话中断后恢复：先报进度（完成 / 进行中 / 待开始 + 分支 + 最后 commit），**再等确认**，不自动续跑。',
  '',
  '## 跨阶段 · 两条升级路径',
  '',
  'solo → team（满足任一即升级，已写代码保留、不丢弃）：',
  '',
  '- 实际 diff 超出 S 阈值（文件数 > 2 或行数 > 80）；同一问题自己修 2 次仍不过。',
  '- 涉及安全 / 权限 / 支付 / 数据迁移；验收无法用单条命令判定，需要独立环境。',
  '- 用户明确要求 team 或要求独立验证。',
  '',
  'team → 用户（满足任一即停，不自行决策）：',
  '',
  '- 需求冲突、验收标准缺失或互相矛盾；需要凭据、生产环境、外网写入、破坏性操作。',
  '- 同一任务连续 2 轮 Tester 不通过；发现方案级风险（架构不成立、依赖不可用、工期与范围不匹配）。',
  '- 需要跨仓库改动或改动他人负责的模块。',
  '',
  '## Red Lines（不可协商）',
  '',
  '- 不外泄私有数据、密钥、内部链接；破坏性命令先问，不确定就问。',
  '- 不伪造命令、退出码、diff 统计；没跑就写「未执行」；不隐瞒失败，不把未验证说成已验证。',
  '- 子 agent 的汇报是证据线索，不是结论；不把 triage 当验收，不跳过 Tester 直接交付编码任务。',
  '- 不绕过质量门，不以时间压力为由降标准；不自动推进下一个任务，不用「清单还剩 N 个」作为理由。',
  '- 不改固件 Skill / persona / preset 自身来「让规则更顺手」；不擅自扩权、不关闭安全机制。',
  '- 不 `git push --force`、不向未授权远端推送、不在未确认时改主线分支；不 `rm -rf` 等不可逆删除，需要删除先问。',
  '- 同一失败不重复派发同一句话；第二次派发必须附失败证据 + 新增约束。',
  '',
  '## 检查清单',
  '',
  '开工前：',
  '',
  '- [ ] 已加载 `dev-decompose` + `dev-worktree-git`；派发前加载 `dev-dispatch-contract`，验收前加载 `dev-quality-gate`',
  '- [ ] 未预加载 `dev-role-developer` / `dev-role-tester`（那是子 agent 的规范）',
  '- [ ] 验收标准已编号 AC1…ACn，歧义点已向用户确认；`git status --short` 干净、分支与 worktree 正确、写权限预检已跑',
  '- [ ] 项目已落在 `<workspace>/projects/<repo>`（`pwd -P` 确认）；新项目 / 克隆未落在 workspace 根、`projects` 根或 `$HOME` / `~/project` / `~/agents`',
  '- [ ] 已按表格算出 size 并写下判定依据，已确定 team / solo',
  '- [ ] `todo_write` 只建表一次，之后仅在「新增任务 / 状态变化 / 任务结束」时更新',
  '',
  '派发前：',
  '',
  '- [ ] 10 字段卡片填满，无「待补充」；每条 AC 都能用命令或文件内容判定',
  '- [ ] 项目路径与 worktree 真实存在、分支基于正确基线；约束写明只读目录、禁止 push、禁止改动的模块',
  '- [ ] 第 8 项写了角色 Skill（Developer：`dev-role-developer` + `dev-test-strategy`；Tester：`dev-role-tester` + `dev-test-strategy`）并要求回报 `STACK=… REF=… DETECT=…`；未写或写「无 Skill」→ **不得派发**',
  '- [ ] 交付格式写明：分支 + commit + 命令退出码 + 未覆盖项；preset 选对（编码 `dev-developer` / 验证 `dev-tester`）',
  '',
  '交付前：',
  '',
  '- [ ] 每条 AC 都有可复现证据；`pnpm typecheck` / `pnpm test`（或仓库等价脚本）退出码为 0',
  '- [ ] 编码任务已有 Tester 的 PASS 报告；solo 已声明「无独立 Tester」',
  '- [ ] `git diff` 无越界改动、无临时文件、无调试输出；未覆盖项与残余风险已逐条列出，已写「等你确认后再推进」',
  '',
  '派发契约 / 质量门见固件 Skill：`dev-dispatch-contract`、`dev-quality-gate`；可进化 Skill（`dev-decompose`、`dev-worktree-git`、`dev-test-strategy`、`dev-role-developer`、`dev-role-tester`、`dev-retro`）按需读取。',
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
     * 注册式资产入口：**一次** `register([...])` 写入 6 个可进化 Skill 与其参考文档。
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
      // 单次 register：11 个资产（6 个 SKILL + 5 个 references）同批落盘，只产生一个 commit。
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
