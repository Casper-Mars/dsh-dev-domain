/**
 * 7 个可进化 Skill 的种子正文（assets/skills/<name>/SKILL.md 与 references/<stack>.md）。
 *
 * 为什么用字符串常量而不是运行时读盘：`assets.bootstrap` 在安装期同步执行，
 * 不能依赖仓库相对路径（编译态 / 发布包 / 不同 cwd 都可能变）。
 *
 * 真源是仓库根的 `templates/<name>/`；本文件与之一一对应（SKILL.md 与
 * references/*.md 均逐字节比对），`tests/pack.spec.ts` 会校验；改种子请先改
 * templates 再同步本文件。
 */

/** 单个种子附带的参考文档（相对 skill 目录的 posix 路径，固定一层 `references/`）。 */
export interface SeedReference {
  /** 相对 skill 目录的路径，形如 `references/go.md`。 */
  readonly path: string
  /** 文件全文。 */
  readonly content: string
}

/** 单个种子 Skill：目录名 + SKILL.md 全文 + 可选参考文档。 */
export interface SeedSkill {
  /** 目录名，必须与 frontmatter.name 一致。 */
  readonly name: string
  /** SKILL.md 全文（含 frontmatter）。 */
  readonly content: string
  /** 随种子落盘的参考文档（安装后位于 `skills/<name>/references/`）。 */
  readonly references?: readonly SeedReference[]
}

/** 7 个可进化 Skill 种子（顺序稳定，便于 review diff）。 */
export const SEED_SKILLS: readonly SeedSkill[] = [
  {
    name: 'dev-decompose',
    content: `---
name: dev-decompose
description: 把需求拆成可独立交付的任务：验收标准、依赖 DAG、边界与优先级，产出 Leader 可直接派发的任务卡片。
whenToUse: 收到包含多个目标的需求、Issue 或任务清单，需要先拆解再调度时使用。
---

# 需求拆解

拆解的目标不是「把需求写长」，而是让每个任务都能被一个子 agent 在一次会话内做完，
并且能被另一个子 agent 用命令判定通过或不通过。

## 触发条件

- 用户给的需求包含两个以上可独立验收的目标；
- 需求里出现「顺便」「同时」「重构一下」这类会扩大范围的词；
- 任务预计改动超过 3 个模块，或单次会话无法完成；
- 已有任务卡片被 Tester 判为「无法验证」。

## 第一步：提取 Why / How / Do What

先写三段话，写不出来就是需求没读透，不要开工。

| 段落 | 要回答的问题 | 不合格的样子 |
|------|--------------|--------------|
| Why | 为什么现在做？不做会怎样？谁受益？ | 「老板要求」 |
| How | 用什么手段达成？改动落在哪一层？有什么约束？ | 「用最好的方案」 |
| Do What | 做完之后，用户/系统能观察到什么变化？ | 「优化了架构」 |

约束要具体到可执行：目标平台、依赖版本、不能改的模块、性能/兼容性底线。
例如「不能改 core，只能改 dev domain」「必须兼容 Node 22」「API 响应结构不变」。

## 第二步：切分任务粒度

按「一次交付一个可验证增量」切，不按文件、不按技术分层切。

一个内聚的小特性（≤4 个文件、单一验收面、一次会话可完成）**允许就是 1 个任务**；
不要为了凑数量把它拆成不能独立验收的碎片。拆解数量按「可独立验收的增量」计数，不按文件数计数。

> 行数是**估算**，只用于选模式与粒度，不是验收标准。实际 diff 超出估算 ≤50% 时记录为 minor 观察项，
> 不得为压行数删除测试、断言或关键注释；超出 50% 才回到拆解，把任务再切一刀。

合格的粒度：

- 一个任务 = 一个分支 = 一个 PR（或一次交付）；
- 单个任务预期改动 ≤ 10 个文件、≤ 400 行 diff；
- 任务完成后，仓库处于可构建、可测试状态（不留半截接口）；
- 任务之间的接口在拆解阶段就写清楚（函数签名、HTTP 路径、数据结构）。

切不动时用这两种手法：

1. **纵切**：先做「一条最窄的端到端链路」（一个接口 + 一个用例），再横向补宽度；
2. **先骨架后填充**：任务 A 只建接口与空实现 + 契约测试，任务 B/C 各自填实现。

## 第三步：写验收标准

每条验收标准必须是「命令 + 期望输出」或「操作 + 可观察结果」，一条一行。

合格：

- \`pnpm test tests/pack.spec.ts\` 退出码 0，新增用例名含 \`references\`；
- \`curl -s localhost:3000/health\` 返回 \`{"status":"ok"}\`；
- 安装到全新 \`DSH_HOME\` 后，\`git log --oneline\` 只有 1 个 seed commit。

不合格：

- 「功能正常」「没有报错」「体验流畅」「代码质量高」；
- 只写「测试通过」而不写跑哪条命令、覆盖哪个行为。

每个任务至少包含：1 条正向验收 + 1 条反向/边界验收（错误输入被拒、失败路径有提示）。
验收标准里要写清**验证环境**（哪个 worktree、哪个分支、哪个 env 变量）。

## 第四步：画依赖 DAG

用文本画出依赖，禁止只写「有依赖」而不写方向：

\`\`\`
T1 契约/类型
 ├─ T2 后端实现 ── T4 集成测试
 └─ T3 前端接入 ──┘
T5 文档（依赖 T2、T3）
\`\`\`

规则：

- 箭头方向 = 数据/接口就绪方向，上游没合并，下游不开工；
- 同一层内的任务必须能并行且**不碰同一个文件**；
- 出现循环依赖 → 说明切分错了，回到第二步；
- 关键路径上的任务优先派发，非关键路径可以后置。

## 第五步：补全派发补充信息

任务卡片缺这些信息，子 agent 只能猜，猜错就是返工：

- 代码路径：要改的目录/文件（不确定就写「先用 rg 定位，报告候选」）；
- 接口契约：函数名、参数、返回结构、错误码；
- 数据：表结构、字段含义、样例数据位置；
- 环境：启动命令、依赖安装方式、需要的中间件；
- 边界：明确「不要改什么」，比「要改什么」更能防跑偏。

## 第六步：填任务卡片

\`\`\`markdown
### 任务 <编号>：<动词开头的名称>

- 背景：<为什么做，1~2 句>
- 目标：<做完后的可观察结果>
- 范围：<要改的路径>；不涉及：<明确排除项>
- 验收标准：
  1. <命令/操作> → <期望结果>
  2. <反向用例> → <期望拒绝方式>
- 依赖：<前置任务编号，或「无」>
- 补充信息：<接口/数据/环境>
- 执行者：developer / tester
\`\`\`

## 拆分质量判据

- 每个任务都能独立回滚，不牵连其他任务；
- 每个任务都有至少一条可执行命令作为验收证据；
- 任务数量按「可独立验收的增量」算：1~6 个；单个内聚小特性允许就是 1 个，多于 6 个说明在按文件切；
- 任意两个任务的 diff 交集为空（共享文件必须先抽成前置任务）；
- 拿给一个没参与讨论的人看，他能说出「先做哪个、做完怎么验」。

## 反模式

| 反模式 | 后果 | 正确做法 |
|--------|------|----------|
| 按文件拆（「改 a.ts」「改 b.ts」） | 接口对不上，无法单独验收 | 按可交付增量拆 |
| 验收标准写「功能正常」 | Tester 无法判定，只能口头通过 | 写成命令 + 期望输出 |
| 把调研和实现塞进一个任务 | 调研结论变了，实现要重做 | 调研单独出一个 ADR/结论任务 |
| 任务过大（跨 5 个模块） | 子 agent 超时、上下文丢失 | 纵切成端到端最窄链路 |
| 依赖不标 | 并行任务互相覆盖 | 画 DAG 并标注方向 |
| 只写「要改什么」 | 顺手重构、范围蔓延 | 同时写「不涉及」清单 |

## 禁止项

- 禁止在需求有歧义时自行脑补后拆解——先向用户确认，再拆；
- 禁止把「重构」「升级依赖」混进功能任务，除非它就是任务目标；
- 禁止拆出没有验收标准的任务；
- 禁止一次拆出超过 8 个任务而不做优先级排序；
- 禁止替子 agent 决定实现细节（那是执行者的事），只定接口与验收。

## 检查清单

- [ ] Why / How / Do What 三段都写了，且具体到可执行；
- [ ] 任务数 1~6 个（内聚小特性允许 1 个），每个 ≤ 10 文件 / ≈400 行（行数仅估算，不作为验收条件）；
- [ ] 每个任务至少 1 条正向 + 1 条反向验收标准；
- [ ] 验收标准是可复制执行的命令，不是形容词；
- [ ] 依赖 DAG 已画，无循环，同层任务无文件交集；
- [ ] 每个任务都写了「不涉及」的范围排除；
- [ ] 补充信息含路径 / 接口 / 数据 / 环境四类中所有相关项；
- [ ] 任务卡片按编号排序，P0 在前。
`,
  },
  {
    name: 'dev-ralph-loop',
    content: `---
name: dev-ralph-loop
description: 单任务的 Ralph Loop 执行循环：对齐、派发、自检、独立验证、交付，失败则带证据迭代，并给出典型反例。
whenToUse: 开始推进任意一个已拆解任务时使用，确保不跳步、不假交付、不在失败时重复同一句指令。
---

# Ralph Loop（单任务循环）

一次只跑一个任务。每个阶段有明确的入口条件、产物和禁止项；阶段之间靠**证据**推进，
不靠「应该可以」。

## 触发条件

- Leader 准备派发一个已拆解的任务；
- 子 agent 返回结果，需要判断是交付还是迭代；
- 任务连续失败两次，需要换策略而不是重试。

## 循环结构

\`\`\`
对齐 → 派发 → 自检 → 独立验证 → 交付
              ↑         │
              └── 迭代 ←┘（带失败证据）
\`\`\`

## 阶段 1：对齐

**做什么**

1. 复述目标：一句话说清「做完之后什么会不一样」；
2. 逐条抄下验收标准，标出哪条无法用命令验证（这类要先找用户确认口径）；
3. 确认边界：项目路径、分支、允许改的目录、明确不能改的模块；
4. 确认环境：依赖安装方式、需要的中间件、跑测试的命令。

**禁止什么**

- 禁止带着「大概是这样」开工；
- 禁止自行扩大范围（顺手重构、顺手升级依赖）；
- 禁止在验收标准缺失时用「跑通就行」代替。

**出口条件**：能用三句话说清「给谁、做什么、怎么算做完」。

## 阶段 2：派发

**做什么**

1. 组装上下文卡片：背景 / 目标 / 验收标准 / 路径 / 接口 / 环境 / 禁止项；
2. 选对 preset：编码给 \`dev-developer\`，验证给 \`dev-tester\`；
3. 给足超时，并在卡片里要求「返回命令与退出码」；
4. 一次只派一个任务，不并发写同一片代码。

**禁止什么**

- 禁止把整篇 PRD 直接丢给子 agent（信息过载 → 抓错重点）；
- 禁止让 Developer 自己宣布「已验证」；
- 禁止在派发卡片里写「注意质量」这类不可执行的要求。

**出口条件**：卡片里的每条验收标准都能被对方照着重跑。

## 阶段 3：自检

**做什么**

1. 核对产物是否存在（文件、分支、commit）；
2. 亲自跑一遍最小验证命令，记录命令与退出码；
3. 检查 diff 范围：是否只改了任务允许的路径；
4. 检查是否有产物/密钥/临时文件被提交。

**禁止什么**

- 禁止只看子 agent 的文字总结就放行；
- 禁止把「命令没报错」当成「行为正确」——要看断言是否真的覆盖新行为；
- 禁止在同一轮里既改代码又改验收标准。

**出口条件**：能贴出命令 + 退出码 + 关键输出行。

## 阶段 4：独立验证

**做什么**

1. 交给 Tester，按验收标准逐条复跑；
2. 要求 Tester 给出 pass/fail + 证据 + 未覆盖项；
3. fail 时收集：失败命令、错误输出、复现步骤、影响面。

**禁止什么**

- 禁止 Leader 自己代替 Tester 出结论（自证不算验证）；
- 禁止 Tester 修改业务代码让测试变绿；
- 禁止跳过反向用例（错误输入、边界值）。

**出口条件**：每条验收标准都有 pass/fail 与证据。

## 阶段 5：交付

**做什么**

1. 汇报：分支 + commit hash、命令与退出码、逐条验收证据、未覆盖项、残余风险；
2. 明确「没有做什么」，避免用户误以为全覆盖；
3. 停下等用户确认，再进入下一个任务。

**禁止什么**

- 禁止自动开始下一个任务；
- 禁止用「已完成」掩盖部分通过；
- 禁止在未确认前 push / 合并 / 发布。

## 迭代规则

- 失败 → 带着**具体失败证据**回到阶段 2，指令必须比上一轮更具体；
- 同一类失败连续两次 → 停止重试，先修流程（补规范、补测试、补环境），再继续；
- 每轮只改必要范围，diff 只增不减地蔓延说明方向错了；
- 迭代上限 3 轮，超过则升级给用户决策，不无限重试；
- 每轮记录：改了什么、为什么、预期哪条验收会从 fail 变 pass。

## 三个典型反例

### 反例 1：用「本地跑过了」代替独立验证

- **现象**：Developer 回报「\`pnpm test\` 全绿」，Leader 直接标记交付；两天后 CI 挂了。
- **为什么错**：Developer 在自己的 worktree、自己的环境里跑，可能漏装依赖、跳过用例、
  或只跑了改动的测试文件；自证无法发现「环境差异」和「验收标准漏项」。
- **正确做法**：Leader 派 Tester 在干净环境按验收标准逐条复跑，要求贴出
  \`pnpm test\` 的完整汇总行（\`Tests 41 passed\`）与退出码；差异项单独立缺陷。

### 反例 2：失败后用同一句指令重试

- **现象**：测试失败，Leader 再发一次「请修复测试」，子 agent 改了两行又失败，循环三轮。
- **为什么错**：没有新增信息，等于让模型抽奖；重复同一指令还会覆盖掉上一轮的上下文，
  子 agent 不知道已经试过什么。
- **正确做法**：把失败输出原文、复现命令、已尝试的改法、怀疑点一起塞回卡片；
  若两轮同因失败，先补一条能稳定复现的测试，再改实现。

### 反例 3：一轮里同时改代码和验收标准

- **现象**：测试断言失败，于是把断言从「返回 400」改成「返回 200」，测试变绿就交付。
- **为什么错**：验收标准是需求契约，改它等于改需求；同时改两边无法判断是修好了还是掩盖了。
- **正确做法**：验收标准只能由用户在需求层变更；实现侧必须让行为符合原断言。
  确属断言写错时，单独提一个任务说明「原断言与需求不符」，附需求原文，经确认后再改。

## 状态追踪

跨会话以文件为准维护任务表（编号 / 状态 / commit / 证据一行一条）。状态只能前进，
每次推进都要有证据：\`待开始 → 进行中 → 已验证 → 已交付\`；回退必须写明原因。

## 禁止项

- 跳过独立验证直接交付；
- 用「应该可以」替代命令输出；
- 一个任务未确认就自动开始下一个；
- 用注释掉/跳过测试的方式让流水线变绿。

## 检查清单

- [ ] 阶段 1 的三句话能说清（给谁 / 做什么 / 怎么算完）；
- [ ] 派发卡片含验收标准、路径、环境、禁止项；
- [ ] 自检跑的是最小验证命令，且记录了退出码；
- [ ] diff 范围未越界，无产物 / 密钥入库；
- [ ] Tester 已独立复跑，逐条给 pass/fail；
- [ ] 交付包含「未覆盖项」与「残余风险」；
- [ ] 迭代每轮都有新证据且未超过 3 轮，任务状态表已更新。
`,
  },
  {
    name: 'dev-worktree-git',
    content: `---
name: dev-worktree-git
description: Git worktree 与分支/提交规范：分支命名、worktree 路径约定、Conventional Commits、清理流程与禁止 force push。
whenToUse: 开始编码前创建 worktree、提交代码、处理冲突或清理工作目录时使用。
---

# Worktree 与 Git 规范

目标：每个任务有独立目录、独立分支、可追溯的提交；任何时刻主仓库都不被污染。

## 触发条件

- 接到一个新任务，准备写第一行代码；
- 需要提交、修订提交或整理历史；
- 任务结束，需要回收目录与分支；
- 发现当前目录里有别人的改动或未提交文件。

## 零、开工前写权限预检（必须，30 秒）

dsh 默认 \`workspace-write\` 沙箱只允许写当前工作目录。linked worktree 的 git 元数据在主仓库
\`.git/\`，经常在工作目录之外；不预检就直接 \`git worktree add\` / \`git switch -c\` / \`git commit\`
会得到 \`Operation not permitted\`，且 headless 模式没有审批通道，无法升级权限。

\`\`\`bash
# 只在 Leader 启动 dsh 的那个 cwd 执行一次；子 agent 不要在自己的 cwd 重跑（会误判）。
root=$(git rev-parse --show-toplevel)
common=$(git rev-parse --git-common-dir)
case "$common" in /*) ;; *) common="$root/$common" ;; esac
common=$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")
ws=$(pwd -P)          # dsh workspaceRoot = 启动 dsh 时的 cwd
case "$common" in
  "$ws"/*) echo "GIT_WRITE_OK" ;;
  *) echo "GIT_WRITE_BLOCKED: git-common-dir=$common outside workspace=$ws" ;;
esac
\`\`\`

| 结果 | 处理 |
|------|------|
| \`GIT_WRITE_OK\` | 按下面的规范建 worktree / 提交 |
| \`GIT_WRITE_BLOCKED\` | 不要反复重试，也不要尝试提权。二选一：<br>A. 让 Leader 以**包含主仓库与 worktree 的父目录**作为 dsh 的 cwd 重新启动（推荐，\`workspaceRoot\` 随 cwd 扩大）；<br>B. 受信任仓库下用 \`DSH_PERMISSION_MODE=danger-full-access\` 启动 dsh，并在交付里声明该风险。 |
| 两者都不可行 | 切换「工作区交付」：不建 worktree、不 commit，交付 \`git status --short\` + \`git diff\` + 建议 commit message；Tester 按 \`dev-role-tester\` 的「工作区交付」路径验收。 |

> 禁止在 \`GIT_WRITE_BLOCKED\` 下假装已建分支/已提交；也禁止把 \`git switch -c\` 失败后的重试当成进展。
> 预检只做一次，结果写进任务卡第 5 项与第 10 项。

## 一、创建 worktree（仅 \`GIT_WRITE_OK\` 时）

\`\`\`bash
cd <项目根目录>
git worktree add -b <type>/<任务号>-<描述> \\
  <项目根目录>/../worktrees/<项目名>-<type>-<任务号>-<描述>
\`\`\`

要点：

- \`-b\` 一次完成「建分支 + 关联新 worktree」，不需要先 \`checkout\`；
- 起点必须是明确的 ref：\`git worktree add -b <branch> <path> <base-ref>\`，
  默认从当前 HEAD 拉，容易带上别人未合并的改动；
- 创建后立刻执行 \`git -C <path> status\` 与 \`git -C <path> log --oneline -1\`，
  确认分支与基点正确再开工。

## 二、分支命名

格式：\`<type>/<任务号>-<短描述>\`，短描述用小写 kebab-case，2~5 个词。

| type | 用途 |
|------|------|
| \`feat\` | 新功能、新资产、新能力 |
| \`fix\` | 修 bug、修回归 |
| \`docs\` | 仅文档 |
| \`refactor\` | 不改外部行为的重构 |
| \`chore\` | 依赖、构建、配置、脚本 |
| \`test\` | 仅测试 |

示例：

\`\`\`
feat/task-04-evolvable-skills
fix/task-03-firmware-register-race
docs/readme-install-steps
chore/bump-vitest-3-2
\`\`\`

禁止：\`dev\`、\`test\`、\`tmp\`、\`my-branch\`、中文分支名、带空格、带大写。

## 三、worktree 路径约定

\`\`\`
<项目根目录>/../worktrees/<项目名>-<type>-<任务号>-<描述>
\`\`\`

- 所有 worktree 平铺在 \`worktrees/\` 下，不放嵌套目录；
- 目录名 = 项目名 + 分支名（\`/\` 换成 \`-\`），一眼能从目录反推分支；
- 不共用目录：同一个 worktree 同时只服务一个任务，不借给他人跑验证；
- 依赖装在 worktree 内（\`pnpm install\` / \`go mod download\`），不依赖全局环境。

## 四、Conventional Commits

格式：

\`\`\`
<type>(<scope>): <一句话说明>

<可选正文：为什么改、影响范围、验证方式>
\`\`\`

- 标题 ≤ 72 字符，祈使句，结尾不加句号；
- \`scope\` 用模块名（\`pack\`、\`seeds\`、\`tests\`、\`readme\`），可省略；
- 正文写「为什么」，不写「改了什么」——改了什么看 diff；
- 破坏性变更用 \`!\`（\`feat(pack)!: ...\`）并在正文写迁移方式。

示例：

\`\`\`
feat(task-04): 扩写 7 个可进化 Skill 与五栈 references

- templates/ 为真源，seeds.ts 同步生成，测试逐字节比对
- bootstrap 改为一次 register 注册 12 个资产（7 SKILL + 5 ref）
- 验证：pnpm typecheck / pnpm test / pnpm build 均 exit 0
\`\`\`

\`\`\`
fix(task-03): 固件 Skill 在 provider 就绪前不可见

原因：ctx.skills.register 在 install 之后异步执行……
验证：pnpm test tests/firmware-registration.spec.ts（14 passed）
\`\`\`

## 五、何时拆分 commit

拆：

- 内容改动与「让内容生效的机制改动」分开（例：先提 templates/seeds，再提 pack/bootstrap）；
- 格式化/重命名与逻辑改动分开；
- 修 bug 的「复现测试」与「修复」可以同 commit，但要在正文说明测试先红后绿；
- diff 超过 400 行且明显分成两个主题。

不拆：

- 拆开后单独一个 commit 无法通过 \`pnpm typecheck\` / \`pnpm test\`（破坏可 bisect 性）；
- 纯粹为了凑数量把同一个逻辑切碎。

## 六、提交前检查

\`\`\`bash
git status --short           # 只应有预期文件
git diff --stat              # 确认没有产物、锁文件意外变更
git diff --cached            # 逐行看将要提交的内容
\`\`\`

- 不提交：\`node_modules/\`、\`dist/\`、\`dist-server/\`、\`.env\`、日志、编辑器临时文件；
- 不提交密钥、token、个人绝对路径；
- 提交信息用中文正文可以，但 \`type(scope)\` 前缀必须是英文小写。

## 七、清理

任务合并或放弃后，按顺序执行：

\`\`\`bash
git -C <项目根目录> worktree remove <worktree 路径>   # 目录干净时
git -C <项目根目录> worktree remove --force <路径>    # 仅确认改动已丢弃时
git -C <项目根目录> worktree prune                    # 清理已失效的元数据
git -C <项目根目录> branch -d <branch>                # 已合并用 -d
\`\`\`

- 启动过中间件：\`docker compose -p <worktree目录名> down -v\`；
- 删除分支用 \`-d\`，\`-D\` 只在确认提交已备份时使用；
- 定期 \`git worktree list\` 检查是否有遗留目录。

## 禁止项

- **禁止 \`git push --force\` / \`--force-with-lease\`**（除非用户明确要求且已确认目标分支无人使用）；
- 禁止 rebase 已推送的公共分支；
- 禁止 \`git add .\` 盲加（先看 \`git status\`，按路径添加）；
- 禁止在主干分支上直接提交；
- 禁止把多个任务的改动塞进一个 worktree；
- 禁止用 \`git checkout -- .\` 丢弃自己没看懂的改动（先 \`git stash\` 或 \`git diff\` 存档）。

## 检查清单

- [ ] 开工前已跑写权限预检，结果（\`GIT_WRITE_OK\` / \`GIT_WRITE_BLOCKED\`）与所选交付形态已记录；
- [ ] worktree 路径符合 \`<项目名>-<type>-<任务号>-<描述>\`；
- [ ] 分支名符合 \`<type>/<任务号>-<描述>\`，type 在允许列表内；
- [ ] 起点 ref 明确，\`git log -1\` 已确认；
- [ ] commit 标题符合 \`type(scope): 说明\`，正文写了为什么与验证方式；
- [ ] \`git diff --stat\` 无产物 / 锁文件意外变更；
- [ ] 未提交密钥与个人路径；
- [ ] 交付信息含分支名 + commit hash；
- [ ] 任务结束已 \`worktree remove\` + \`prune\`，中间件已 \`down -v\`。
`,
  },
  {
    name: 'dev-test-strategy',
    content: `---
name: dev-test-strategy
description: 测试策略只做栈检测与路由：按清单文件判断技术栈，指向对应 references/<stack>.md，并给出通用测试原则与未识别栈兜底。
whenToUse: 需要为一次改动确定测试范围、找到构建与测试命令，或判断"测够了没有"时使用。
---

# 测试策略（检测 → 路由）

本 Skill **只负责判断技术栈并把你送到对应参考文档**，不在这里堆五套命令。
具体命令、最小样例、常见坑全在 \`references/<stack>.md\`。

## 触发条件

- 拿到一个新仓库，不知道该跑什么命令；
- 改动跨了配置层（依赖/构建脚本/CI）需重新确认验证方式，或判断「测够了没有」缺少依据。

## 第一步：栈检测（按顺序判定，命中即停）

在仓库根目录看清单文件，按下表从上到下匹配，**只选一个主栈**：

| 顺序 | 检测信号（文件） | 技术栈 | 路由 |
|------|------------------|--------|------|
| 1 | \`build-profile.json5\` 或 \`oh-package.json5\` | 鸿蒙 ArkTS | \`references/harmony-arkts.md\` |
| 2 | \`go.mod\` | Go | \`references/go.md\` |
| 3 | \`pyproject.toml\` 或 \`requirements.txt\` | Python | \`references/python.md\` |
| 4 | \`package.json\` + \`react\` 依赖（且存在 \`vite.config.*\` / \`next.config.*\` / \`react-scripts\`） | React | \`references/react.md\` |
| 5 | \`package.json\`（无前端框架） | Node / TypeScript | \`references/node-ts.md\` |

补充判定：

- 多栈仓库（monorepo）按**改动落点**选：改了 \`packages/api\` 就只看它自己的 \`package.json\`；
  同时有 \`react\` 与后端代码时看本次 diff 触及的目录；
- 命中两条以上且无法区分 → 向用户确认，不要两套命令都跑。

## 第二步：读对应参考（硬要求）

先在你的进度消息里写一行路由声明，再读文件：

\`\`\`text
STACK=<stack> REF=references/<stack>.md DETECT=<命中的清单文件>
\`\`\`

\`\`\`
read references/<stack>.md
\`\`\`

未写出这一行、或未从 ref 复制至少 1 条命令到执行记录，视为未完成本步；Leader/Tester 应打回。
参考文档固定包含：检测信号、环境准备、构建、静态检查、测试、最小样例、常见坑、失败判据。
读完应当能直接复制命令执行，不需要再猜。

路由路径相对本 SKILL.md 所在目录；安装后位于
\`<assets>/skills/dev-test-strategy/references/<stack>.md\`。

## 第三步：最小验证优先

先跑仓库**已有**的最快验证命令（typecheck / lint / 单测），再决定是否补用例。
顺序：静态检查 → 单测 → 集成 → e2e。前一层红着就不要往下跑。

## 第四步：按金字塔补用例

- **单元**：纯函数、边界、错误分支，覆盖新增逻辑的每个分支；
- **集成**：跨模块契约、真实依赖的最小组合（真实数据库/文件系统优先于 mock）；
- **端到端**：只覆盖关键用户路径，不追求数量。

新增行为至少一个正例 + 一个失败/边界例；修 bug 先有能复现的用例。

## 通用测试原则

- 测试必须可重复：不依赖当前时间、网络、随机数、执行顺序；
- 一个用例只断言一个行为，失败信息能直接指向原因；
- 断言行为而不是实现（不断言私有函数调用次数）；
- 测试数据就地构造，跨用例共享状态是 flaky 的主因；
- 跑不过就修，禁止注释掉、跳过或放宽断言来变绿。

## 未识别栈的兜底

没有命中任何信号时，按以下顺序处理，并把结论写进交付说明：

1. 找仓库自述文件（\`README*\`、\`Makefile\`、\`package.json\` 的 \`scripts\`）里的验证命令；
2. 找 CI 配置（\`.github/workflows/*.yml\`、\`.gitlab-ci.yml\`）里实际执行的命令，**以 CI 为准**；
3. 两者都没有 → 只做「改动可运行」的最小验证（构建 + 手工调用），并在报告中标注
   「无自动化测试基线」，不要凭空编造测试命令。

## 禁止项

- 禁止在本文件里堆具体栈的构建/测试命令（会与 references 漂移）；
- 禁止在没跑通最小验证前写新用例；禁止为通过而降低断言强度；
- 禁止跳过失败用例直接跑下一层。

## 检查清单

- [ ] 已按检测表命中唯一主栈，并记录了依据文件；
- [ ] 已写出路由声明 \`STACK=… REF=… DETECT=…\`，并已 \`read\` 对应 \`references/<stack>.md\`；
- [ ] 已从 ref 复制至少 1 条命令到执行记录；
- [ ] 最小验证命令已跑通，退出码为 0；
- [ ] 新增行为有正例 + 边界例；
- [ ] 测试可重复，无外部随机依赖；
- [ ] 未识别栈时已在报告中标注兜底依据。
`,
    references: [
      { path: 'references/go.md', content: `# Go 技术栈参考

适用：仓库根有 \`go.mod\` 的纯 Go 模块 / 服务。检测到其它栈信号时以 \`dev-test-strategy\` 的优先级表为准。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| \`go.mod\` | 必存在，\`module\` 行给出模块路径 |
| \`go.sum\` | 依赖锁定；缺失说明从未构建过 |
| \`*.go\` 文件 | 包内源文件 |
| \`Makefile\` / \`Taskfile.yml\` | 可能有 \`make test\` 之类的封装，**优先看它** |
| \`cmd/<name>/main.go\` | 服务/CLI 入口惯例 |

版本以 \`go.mod\` 的 \`go\` 行与 \`toolchain\` 行为准：

\`\`\`bash
head -5 go.mod
go version
\`\`\`

## 2. 环境准备

\`\`\`bash
go version                      # 需 ≥ go.mod 声明的版本
go env GOMODCACHE GOPATH        # 确认缓存路径
go mod download                 # 预下载依赖（CI 常用）
go mod verify                   # 校验依赖未被篡改
\`\`\`

- 私有模块需 \`GOPRIVATE\` / \`GONOSUMDB\`，否则 \`go mod download\` 报 404；国内网络可设
  \`GOPROXY=https://goproxy.cn,direct\`（以团队规范为准）；
- 不要 \`go get -u\` 全量升级，依赖变更必须单独成 commit。

### 2.1 沙箱 / CI 缓存兜底（默认缓存不可写时）

\`\`\`bash
export GOCACHE="\${GOCACHE:-$PWD/.cache/go-build}"
export GOMODCACHE="\${GOMODCACHE:-$PWD/.cache/gomod}"
mkdir -p "$GOCACHE" "$GOMODCACHE"
go env GOCACHE GOMODCACHE
\`\`\`

默认缓存位于 \`$HOME/Library/Caches/go-build\` 或 \`/root/.cache/go-build\`，沙箱下常在工作目录外，
表现为 \`go build: operation not permitted\`；此时先设上面的变量，**不要**以此判定代码有问题。

依赖有变更时补 \`go mod tidy\`，并单独 commit \`go.mod\` / \`go.sum\`；不要把 \`go mod tidy\` 混进功能 diff。

## 3. 构建

\`\`\`bash
go build ./...                              # 编译所有包（不产出文件，最快的编译校验）
go build -o bin/<name> ./cmd/<name>         # 编译单个可执行文件
go build -trimpath -ldflags "-s -w" -o bin/<name> ./cmd/<name>   # 发布态
\`\`\`

产物路径：\`bin/<name>\`（或 \`./<name>\`，取决于 \`-o\`）。\`go build ./...\` 不写产物到磁盘，
适合在 CI 里做编译门禁。

交叉编译：

\`\`\`bash
GOOS=linux GOARCH=amd64 go build -o bin/<name>-linux-amd64 ./cmd/<name>
\`\`\`

## 4. 静态检查

\`\`\`bash
gofmt -l .                # 列出未格式化的文件；有输出即失败
go vet ./...              # 官方静态检查，必跑
\`\`\`

可选（仓库有配置时才跑）：

\`\`\`bash
golangci-lint run ./...   # 需已安装；配置见 .golangci.yml
staticcheck ./...         # 需已安装
\`\`\`

自动化格式修正：\`gofmt -w .\`（只改格式，单独提交）。

## 5. 测试

\`\`\`bash
go test ./...                       # 全部单测
go test ./... -race -cover          # 竞态检测 + 覆盖率（推荐门禁）
go test ./... -count=1 -coverprofile=cover.out && go tool cover -func=cover.out | tail -1
\`\`\`

单条用例复跑：

\`\`\`bash
go test ./internal/pack -run TestValidateSkillAsset -v
go test ./... -run 'TestSeed/name_mismatch' -v    # 子测试用 / 分隔
\`\`\`

只跑失败过的包：\`go test ./internal/pack ./cmd/server -count=1\`。

基准与集成：

\`\`\`bash
go test ./... -bench=. -benchmem -run '^$'
go test -tags=integration ./...     # 仅当仓库定义了 build tag
\`\`\`

## 6. 最小样例

\`\`\`go
// go.mod: module example.com/mini  /  go 1.22
package mini

import "testing"

func Add(a, b int) int { return a + b }

func TestAdd(t *testing.T) {
	cases := []struct{ a, b, want int }{
		{1, 2, 3},
		{-1, 1, 0},
	}
	for _, c := range cases {
		if got := Add(c.a, c.b); got != c.want {
			t.Fatalf("Add(%d,%d)=%d, want %d", c.a, c.b, got, c.want)
		}
	}
}
\`\`\`

验证：

\`\`\`bash
go build ./... && go vet ./... && go test ./... -race -cover
\`\`\`

## 7. 常见坑

1. **\`go test\` 命中缓存**：输出里出现 \`(cached)\` 说明没真跑。门禁加 \`-count=1\`。
2. **\`-race\` 在 cgo 关闭时不可用**：需 \`CGO_ENABLED=1\` 且有 C 工具链；macOS 默认可用，
   精简容器里常失败——失败时记录原因并降级为 \`go test ./...\`。
3. **包级 \`init()\` 读环境变量**：单测并行时互相污染；测试内用 \`t.Setenv\`，不要 \`os.Setenv\`。
4. **\`go vet\` 对 \`%w\`/\`%v\` 很敏感**：格式化字符串不匹配会直接失败，不要用 \`//nolint\` 掩盖。
5. **\`./...\` 会包含 \`vendor/\` 之外的测试辅助包**：若仓库有 \`testdata\` 或 \`tools\` 模块，
   用 \`go test ./internal/... ./cmd/...\` 缩小范围。
6. **模块路径与目录不一致**：\`go build\` 报 \`cannot find module\` 时先看 \`go.mod\` 的 \`module\` 行。

## 8. 失败判据

以下任一情况判 **不通过**：

- \`go build ./...\` 非 0 退出；
- \`go vet ./...\` 有输出；
- \`gofmt -l .\` 列出任何文件；
- \`go test ./...\` 有用例 FAIL，或 \`-race\` 报 \`DATA RACE\`；
- 测试被 \`t.Skip\` 跳过且无 issue/原因说明，或覆盖率较基线下降且无说明。
` },
      { path: 'references/harmony-arkts.md', content: `# 鸿蒙 ArkTS 技术栈参考

适用：HarmonyOS / OpenHarmony 应用或元服务工程，根目录有 \`build-profile.json5\` 与
\`oh-package.json5\`。**注意**：该栈强依赖 DevEco Studio / HarmonyOS SDK，纯 CLI 能力有限，
检测不到 SDK 时必须降级（见第 2、8 节）。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| \`build-profile.json5\` | 工程级构建配置（products / modules / signingConfigs） |
| \`oh-package.json5\` | 依赖清单（ohpm 管理，不是 npm） |
| \`hvigorfile.ts\` | 构建脚本入口（hvigor 任务定义） |
| \`entry/\` \`feature/\` \`entry/src/main/ets/\` | 模块目录与 ArkTS 源码 |
| \`entry/src/ohosTest/\` | 仪器化测试（Hypium） |
| \`oh-package-lock.json5\` | 依赖锁定 |

\`\`\`bash
ls build-profile.json5 oh-package.json5 hvigorfile.ts oh-package-lock.json5 2>/dev/null
\`\`\`

## 2. 环境准备

必需：DevEco Studio（或 Command Line Tools，提供 hvigor / SDK / 签名工具）、HarmonyOS SDK
（\`$DEVECO_SDK_HOME\` 指向 SDK 目录）、ohpm、Node.js（版本以 \`hvigor/hvigor-config.json5\` 为准）。

\`\`\`bash
echo "$DEVECO_SDK_HOME" && which ohpm hvigorw hdc node && ohpm --version
\`\`\`

工程内构建入口是**工程自带的 wrapper**（\`hvigorw\` / \`hvigorw.bat\`），不要用全局 hvigor：

\`\`\`bash
./hvigorw --version           # 打印 hvigor 版本（首次会下载依赖）
ohpm install                  # 安装 oh-package.json5 中的依赖
\`\`\`

依赖源与证书配置在 \`~/.ohpm/\`（Windows 为 \`%USERPROFILE%\\.ohpm\\\`）；私有仓需 \`.ohpmrc\`，不提交个人 token。

### 2.0 工程完整性检查（先于 SDK 检查）

\`\`\`bash
for f in hvigorw hvigorfile.ts hvigor/hvigor-config.json5 \\
         entry/src/main/module.json5 entry/src/main/ets/entryability/EntryAbility.ets; do
  [ -e "$f" ] || echo "MISSING $f"
done
\`\`\`

缺任一文件 = 工程脚手架不完整，**不要**退回全局 \`hvigorw\` 硬跑（会得到 \`00304004 Not Found\`）；
按「无法构建」记录，不得把 255 解释为代码错误。

### 检测不到 SDK 时（降级）

\`\`\`bash
if [ -z "$DEVECO_SDK_HOME" ] || ! command -v ohpm >/dev/null; then
  echo "SKIP: 无 HarmonyOS SDK，无法执行构建/测试"
fi
\`\`\`

降级顺序：① 校验两个 json5 配置为合法 JSON5；② 按第 7 节人工检查 ArkTS 约束；
③ 交由具备 DevEco 环境的 Tester 复跑，不自行宣布通过。

## 3. 构建

\`\`\`bash
ohpm install
./hvigorw clean
./hvigorw assembleHap --mode module -p product=default
\`\`\`

- \`assembleHap\` 产出 HAP；\`--mode module\` 表示按模块构建；\`-p product=default\` 对应
  \`build-profile.json5\` 中 \`products\` 的产品名，多产品时改这里；
- 产物路径：\`<module>/build/default/outputs/default/<module>-default-signed.hap\`
  （未签名时为 \`-unsigned.hap\`）；
- 需要 APP 包时用 \`assembleApp\`——任务名以 \`./hvigorw --help\` 的实际输出为准，不要臆造子命令。

签名：本地调试可用 DevEco 自动签名；CI 需 \`signingConfigs\` + 证书，证书**不入库**。

## 4. 静态检查

- ArkTS 编译器在 \`assembleHap\` 阶段做类型检查：**构建通过 = 类型通过**；IDE 的 Code Linter
  有独立 CLI，但纯命令行环境常不可用，不要假设存在；
- 手工检查：\`@State\` / \`@Prop\` / \`@Link\` 是否符合状态管理约束；是否存在 \`any\`、\`eval\`、
  动态属性访问、结构化类型等 ArkTS 严格模式禁止的写法。

\`\`\`bash
rg -n ": any\\b|as any|eval\\(" entry/src/main/ets || true
\`\`\`

## 5. 测试

\`\`\`bash
./hvigorw test                      # 运行工程定义的测试任务（需 SDK）
\`\`\`

- 单元测试在 \`entry/src/test/\`，仪器化测试在 \`entry/src/ohosTest/\`（Hypium 框架）；
- 单条用例复跑：DevEco Studio 中右键运行；CLI 侧测试 HAP 的安装执行能力因版本而异，
  以 \`./hvigorw tasks\` 的实际输出为准；覆盖率走 DevEco 的 Test Coverage 面板，
  CLI 无稳定等价命令，不要编造参数；
- 设备验证：

\`\`\`bash
hdc list targets                                    # 确认设备已连接
hdc shell aa start -a EntryAbility -b <bundleName>  # 拉起应用做手工验证
\`\`\`

## 6. 最小样例

\`entry/src/main/ets/utils/Sum.ets\`：

\`\`\`ts
export function sum(a: number, b: number): number {
  return a + b
}
\`\`\`

\`entry/src/test/Sum.test.ets\`（Hypium）：

\`\`\`ts
import { describe, expect, it } from '@ohos/hypium'
import { sum } from '../main/ets/utils/Sum'

export default function sumTest() {
  describe('sum', () => {
    it('adds numbers', 0, () => {
      expect(sum(1, 2)).assertEqual(3)
      expect(sum(-1, 1)).assertEqual(0)
    })
  })
}
\`\`\`

验证：\`ohpm install && ./hvigorw assembleHap --mode module -p product=default && ./hvigorw test\`。

## 7. 常见坑

1. **用 npm/pnpm 装依赖**：鸿蒙用 \`ohpm\`，\`package.json\` 的依赖不被识别，构建报
   \`Cannot find module '@ohos/...'\`。
2. **用全局 hvigor**：版本与 \`hvigor/hvigor-config.json5\` 不一致 → 任务缺失或 DSL 报错，
   必须用工程内 \`./hvigorw\`。
3. **漏掉 \`-p product=default\`**：多产品工程报 \`product not found\`，或构建出错误渠道的包。
4. **ArkTS 严格模式误用 TS 特性**：对象字面量类型断言、\`any\`、动态 key 访问都会编译失败，
   改用显式 \`interface\` / \`class\`。
5. **签名缺失/过期、SDK 版本不匹配**：分别报 \`signature verify failed\` 与 \`The SDK version is not supported\`（后者改 \`compatibleSdkVersion\` 或换 SDK）。
6. **\`oh-package-lock.json5\` 漂移**：\`ohpm install\` 会改锁文件，验证环境需保持一致。

## 8. 失败判据

- \`ohpm install\` 非 0，或 \`oh-package-lock.json5\` 被改写；\`./hvigorw assembleHap\` 非 0，或产物 HAP 不存在；
- \`./hvigorw test\` 有用例失败；
- 应用安装/启动崩溃（\`hdc shell hilog\` 出现 FATAL / JS Crash）；
- 关键交互无响应、状态不刷新，或 **无 SDK 导致的未验证被记为 pass**。
` },
      { path: 'references/node-ts.md', content: `# Node / TypeScript 技术栈参考

适用：有 \`package.json\`、但**没有**前端框架依赖（React/Vue/Svelte）的库、CLI、服务端项目。
前端项目请看 \`react.md\`。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| \`package.json\` | 必存在；先读 \`scripts\` 与 \`packageManager\` |
| \`tsconfig.json\` | 存在即 TypeScript 项目 |
| \`pnpm-lock.yaml\` / \`package-lock.json\` / \`yarn.lock\` | 决定包管理器 |
| \`.nvmrc\` / \`.node-version\` | Node 版本约束 |
| \`vitest.config.*\` / \`jest.config.*\` | 测试框架已定 |
| \`src/**/*.ts\` | 源码目录 |

包管理器判定（按锁文件，不按个人习惯）：

\`\`\`bash
ls pnpm-lock.yaml package-lock.json yarn.lock 2>/dev/null
node -e "console.log(require('./package.json').packageManager)"
\`\`\`

若有 \`packageManager\` 字段，必须用对应版本（corepack 会校验）。

## 2. 环境准备

\`\`\`bash
node --version                  # 对照 .nvmrc / engines
cat .nvmrc 2>/dev/null
corepack enable                 # 需要时
pnpm install --frozen-lockfile  # 有 pnpm-lock.yaml
npm ci                          # 只有 package-lock.json
\`\`\`

- \`--frozen-lockfile\` 保证锁文件不被改写，CI 与验证环境必须加；
- 需要重新解析依赖时才用 \`pnpm install\`（会改锁文件，单独 commit）；
- monorepo 用 \`pnpm install\` 在根目录执行，不要在各子包重复装。

## 3. 构建

**优先用仓库脚本**，不要猜：

\`\`\`bash
node -e "console.log(Object.keys(require('./package.json').scripts))"
pnpm run build
\`\`\`

无 \`build\` 脚本时的等价做法：

\`\`\`bash
pnpm exec tsc -p tsconfig.json          # 类型 + 产物（看 tsconfig 的 outDir）
pnpm exec tsc --noEmit                  # 仅类型检查
\`\`\`

典型产物：\`dist/\`、\`dist-server/\`、\`lib/\`（以 \`tsconfig.outDir\` 与 \`package.json.files\` 为准）。
产物目录必须在 \`.gitignore\` 中。

## 4. 静态检查

\`\`\`bash
pnpm exec tsc --noEmit          # 无 typecheck 脚本时的类型检查
pnpm run typecheck              # 有脚本时优先
pnpm exec eslint .              # 有 eslint 配置时
pnpm exec prettier --check .    # 有 prettier 配置时
\`\`\`

顺序：typecheck → lint。类型错修完再管风格，否则会反复改同一文件。

## 5. 测试

| 场景 | 命令 |
|------|------|
| 跑全部（脚本存在） | \`pnpm test\` |
| 跑全部（vitest 直接用） | \`pnpm exec vitest run\` |
| 监听模式（本地调试） | \`pnpm exec vitest\` |
| 单个文件 | \`pnpm exec vitest run tests/pack.spec.ts\` |
| 单个用例 | \`pnpm exec vitest run -t "bootstrap 只调用一次 register"\` |
| 覆盖率 | \`pnpm exec vitest run --coverage\` |
| jest 项目 | \`pnpm exec jest --ci\`、\`pnpm exec jest path/to.spec.ts -t "name"\` |

失败用例复跑要点：

- 加 \`--no-file-parallelism\` 排除并发干扰；
- 用 \`-t\` 精确到用例名，确认是稳定失败还是 flaky；
- 记录 \`Tests X passed / Y failed\` 汇总行作为证据。

## 6. 最小样例

\`package.json\`：

\`\`\`json
{
  "name": "mini",
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
\`\`\`

\`src/sum.ts\` 与 \`tests/sum.spec.ts\`：

\`\`\`ts
export function sum(a: number, b: number): number {
  return a + b
}
\`\`\`

\`\`\`ts
import { expect, it } from 'vitest'
import { sum } from '../src/sum'

it('sum 处理正数与负数', () => {
  expect(sum(1, 2)).toBe(3)
  expect(sum(-1, 1)).toBe(0)
})
\`\`\`

验证：\`pnpm exec tsc --noEmit && pnpm exec vitest run\`。

## 7. 常见坑

1. **没区分 \`tsc --noEmit\` 与 \`build\`**：\`noEmit\` 不产出文件，\`build\` 可能因 \`composite\`/\`references\`
   报错；两者都要跑。
2. **ESM/CJS 混用**：\`"type": "module"\` 下 \`require\` 不可用；测试里 import 相对路径要带扩展名
   （视 \`moduleResolution\` 而定）。
3. **\`pnpm test\` 的 \`--passWithNoTests\`**：测试文件未被 include 时也会「绿」。新增用例后必须核对
   用例数是否真的增加。
4. **锁文件漂移**：\`pnpm install\` 不加 \`--frozen-lockfile\` 会改锁文件，混进 diff 后难 review。
5. **\`tsconfig\` 排除了测试目录**：\`include\` 只含 \`src\` 时，测试文件的类型错误不会被 typecheck 发现，
   需另跑 \`vitest --typecheck\` 或在测试 tsconfig 中覆盖。
6. **watch 模式挂住 CI**：脚本里出现裸 \`vitest\` / \`jest\` 会导致进程不退出，CI 必须用 \`run\` / \`--ci\`。

## 8. 失败判据

- \`pnpm exec tsc --noEmit\` 非 0 退出，或输出任何 \`error TS\`；
- 测试失败数 > 0，或用例总数较基线下降（说明被删/被跳过）；
- 出现 \`skipped\` 且无原因说明；
- 构建产物中包含源码未引用的旧文件（未 clean）；
- 锁文件在验证过程中被修改（环境不稳定）。
` },
      { path: 'references/python.md', content: `# Python 技术栈参考

适用：仓库根有 \`pyproject.toml\` 或 \`requirements.txt\` 的库、CLI、服务。
有 \`go.mod\` / \`package.json\` 时先按 \`dev-test-strategy\` 的优先级表判定。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| \`pyproject.toml\` | 现代项目配置（PEP 621）；看 \`[project]\` 与 \`[tool.*]\` |
| \`requirements.txt\` | 旧式依赖清单 |
| \`uv.lock\` / \`poetry.lock\` / \`Pipfile.lock\` | 决定包管理器 |
| \`.python-version\` | 版本约束（pyenv / uv） |
| \`tox.ini\` / \`noxfile.py\` | 多环境测试矩阵 |
| \`tests/\` + \`conftest.py\` | pytest 项目 |
| \`mypy.ini\` / \`[tool.mypy]\` | 已配类型检查 |

\`\`\`bash
ls pyproject.toml requirements.txt uv.lock poetry.lock .python-version 2>/dev/null
python3 --version
python3 -c "import sys;print(sys.version)"
\`\`\`

## 2. 环境准备

按锁文件选包管理器，**不要混用**：

| 锁文件 | 安装命令 |
|--------|----------|
| \`uv.lock\` | \`uv sync\` |
| \`poetry.lock\` | \`poetry install\` |
| \`Pipfile.lock\` | \`pipenv install --deploy\` |
| 只有 \`requirements.txt\` | \`python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt\` |

\`\`\`bash
uv sync                       # 推荐；会创建 .venv 并按锁文件安装
uv run python -V              # 在项目环境里执行，避免用错解释器
\`\`\`

- 一律在虚拟环境内操作，不往系统 Python 装包；开发依赖（如 \`requirements-dev.txt\`）按仓库实际文件名装；
- 版本以 \`.python-version\` / \`requires-python\` 为准，不匹配时先切版本。

## 3. 构建

纯 Python 库通常无构建步骤；需要打包时：

\`\`\`bash
uv build                      # 产出 dist/*.whl 与 dist/*.tar.gz
python3 -m build              # 未用 uv 时的等价命令
\`\`\`

服务/CLI 的「构建」= 可导入性检查：

\`\`\`bash
uv run python -c "import <package>; print(<package>.__file__)"
\`\`\`

产物路径：\`dist/\`（需在 \`.gitignore\` 中）。

## 4. 静态检查

\`\`\`bash
uv run ruff check .           # lint（快，替代 flake8/isort）
uv run ruff format --check .  # 格式检查，不写文件
uv run mypy .                 # 类型检查（需已配置）
\`\`\`

无 uv 时直接执行 \`ruff check .\` 与 \`mypy .\`。

- \`mypy\` 未配置时默认很宽松，判断标准以 \`pyproject.toml\` 的 \`[tool.mypy]\` 为准；
- 不要为了让检查通过而全局加 \`# type: ignore\`。

## 5. 测试

\`\`\`bash
uv run pytest -q                              # 全部
uv run pytest -q --cov=<package> --cov-report=term-missing   # 覆盖率
uv run pytest tests/test_pack.py -q            # 单文件
uv run pytest tests/test_pack.py::test_seed -q # 单用例
uv run pytest -q -k "references and not slow"  # 按名字筛选
uv run pytest -q -x                            # 首个失败即停
uv run pytest -q --lf                          # 只跑上次失败的
\`\`\`

失败复跑要点：上面的命令在无 uv 环境下把 \`uv run\` 换成激活虚拟环境后的直接命令。
- \`-q\` 保留汇总行（\`X passed, Y failed\`）作为证据；\`--lf\` 定位 flaky：连跑 3 次结果不一致即为 flaky，需修而不是重试；
- 集成测试常带 marker：\`uv run pytest -q -m integration\`（以 \`pyproject.toml\` 的 markers 为准）。

无 uv 时把 \`uv run\` 换成激活虚拟环境后的直接命令（\`pytest -q\`）。

## 6. 最小样例

\`pyproject.toml\`：

\`\`\`toml
[project]
name = "mini"
version = "0.1.0"
requires-python = ">=3.11"
\`\`\`

\`src/mini/sum.py\` 与 \`tests/test_sum.py\`：

\`\`\`python
def sum_two(a: int, b: int) -> int:
    return a + b
\`\`\`

\`\`\`python
from mini.sum import sum_two

def test_sum_two_positive() -> None:
    assert sum_two(1, 2) == 3

def test_sum_two_negative() -> None:
    assert sum_two(-1, 1) == 0
\`\`\`

验证：\`uv run pytest -q\`（或 \`pytest -q\`）。包未安装时用 \`PYTHONPATH=src pytest -q\`。

## 7. 常见坑

1. **用错解释器**：\`pytest\` 来自系统 Python，导入失败或跑的是旧版本代码。始终 \`uv run\` 或显式
   \`.venv/bin/pytest\`。
2. **\`src/\` 布局未安装**：\`ModuleNotFoundError\`，需 \`uv sync\`（项目自身以 editable 安装）或设
   \`PYTHONPATH=src\`。
3. **\`conftest.py\` 路径魔法**：依赖 cwd 的 fixture 在别的目录跑就失败，用 \`tmp_path\` 与绝对路径。
4. **可变默认参数**：\`def f(items=[])\` 跨用例共享状态，是隐性 flaky 源。
5. **\`mypy\` 与 \`ruff\` 规则冲突**：行长、import 排序以 \`pyproject.toml\` 配置为准，不各自为政。
6. **测试污染真实资源**：连了真实数据库/网络，CI 不稳定；用 \`tmp_path\`、mock、或标记为 integration。
7. **\`assert\` 被 \`-O\` 优化掉**：不要用 \`assert\` 做运行时校验（生产代码用显式 raise）或依赖 cwd 路径。

## 8. 失败判据

- \`ruff check .\` 有输出（E/F 类必须为 0）；
- \`mypy .\` 有 error；
- \`pytest\` 有 failed / error，或被 \`skip\` 且无原因；
- 覆盖率较基线下降且无说明；
- 测试依赖网络/真实外部服务（不可重复）；
- \`pyproject.toml\` / 锁文件在验证过程中被修改。
` },
      { path: 'references/react.md', content: `# React 技术栈参考

适用：\`package.json\` 里有 \`react\` 依赖，且有 \`vite.config.*\` / \`next.config.*\` /
\`react-scripts\`（CRA）之一。仅 SSR 后端或纯组件库也按本文件处理。

## 1. 检测信号

| 信号 | 说明 | 结论 |
|------|------|------|
| \`react\` + \`vite.config.ts\` | Vite SPA | \`pnpm build\` → \`dist/\` |
| \`react\` + \`next.config.*\` | Next.js | \`pnpm build\` → \`.next/\` |
| \`react\` + \`react-scripts\` | CRA（旧） | \`pnpm build\` → \`build/\` |
| \`react-dom\` + \`@testing-library/react\` | 组件测试已配 | 用 RTL 写断言 |
| \`playwright.config.*\` / \`cypress.config.*\` | e2e 已配 | 跑真实浏览器 |
| \`vite.config.*\` 里的 \`test\` 段 | Vitest 复用 vite 配置 | 直接 \`vitest run\` |

\`\`\`bash
node -e "const p=require('./package.json');console.log(p.scripts);console.log(Object.keys({...p.dependencies,...p.devDependencies}).filter(k=>/react|vite|next|playwright|cypress|vitest|jest/.test(k)))"
\`\`\`

## 2. 环境准备

\`\`\`bash
node --version                  # 对照 .nvmrc / engines
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # 仅当需要 e2e
\`\`\`

- e2e 依赖浏览器二进制，首次安装较慢；CI 里用 \`--with-deps\`（Linux）；
- Next.js 需要 \`.env.local\` 时，从 \`.env.example\` 复制，**不要**提交 \`.env.local\`。

## 3. 构建

\`\`\`bash
pnpm build                      # 以 package.json scripts 为准
\`\`\`

框架差异：

| 框架 | 命令 | 产物 | 说明 |
|------|------|------|------|
| Vite SPA | \`pnpm build\`（= \`vite build\`） | \`dist/\` | 需 \`vite preview\` 才能验证产物 |
| Next.js | \`pnpm build\`（= \`next build\`） | \`.next/\` | 构建期会做 SSG/类型检查 |
| CRA | \`pnpm build\`（= \`react-scripts build\`） | \`build/\` | 已废弃，仅维护 |

产物验证（可选但推荐）：\`pnpm exec vite preview --port 4173\`，再访问首页确认 200。

## 4. 静态检查

\`\`\`bash
pnpm exec tsc --noEmit          # 或 pnpm run typecheck
pnpm exec eslint . --max-warnings=0
\`\`\`

- Next.js 的 \`next build\` 已内含类型检查，但本地快速反馈仍用 \`tsc --noEmit\`；
- \`--max-warnings=0\` 是否强制以仓库 CI 为准，不要单方面放宽。

## 5. 测试

**单元 / 组件（Vitest + Testing Library）**

\`\`\`bash
pnpm exec vitest run
pnpm exec vitest run src/components/Button.test.tsx
pnpm exec vitest run -t "点击后调用 onSubmit"
pnpm exec vitest run --coverage
\`\`\`

**e2e（Playwright）**

\`\`\`bash
pnpm exec playwright test
pnpm exec playwright test tests/e2e/login.spec.ts
pnpm exec playwright test --headed          # 本地观察
pnpm exec playwright test --project=chromium
pnpm exec playwright show-report            # 看 HTML 报告
\`\`\`

e2e 前置：先起应用（\`pnpm dev\` 或 \`pnpm preview\`），或用 Playwright 的 \`webServer\` 配置自动拉起。

**Cypress 项目**：\`pnpm exec cypress run\`（无头）/ \`pnpm exec cypress open\`（本地）。

## 6. 最小样例

\`src/Greeting.tsx\`：

\`\`\`tsx
export function Greeting({ name }: { name: string }) {
  return <p role="status">你好，{name || '陌生人'}</p>
}
\`\`\`

\`src/Greeting.test.tsx\`：

\`\`\`tsx
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Greeting } from './Greeting'

it('有名字时显示名字，空名字时回退', () => {
  const { rerender } = render(<Greeting name="小明" />)
  expect(screen.getByRole('status').textContent).toContain('小明')
  rerender(<Greeting name="" />)
  expect(screen.getByRole('status').textContent).toContain('陌生人')
})
\`\`\`

验证：\`pnpm exec vitest run src/Greeting.test.tsx\`。

## 7. 常见坑

1. **断言实现而非行为**：断言 className / state 内部值，重构就红。用 role、可见文本、可访问名称。
2. **缺少 \`jsdom\` 环境**：RTL 测试报 \`document is not defined\`，需 \`test.environment: 'jsdom'\`。
3. **未清理副作用**：多个用例共用 DOM 导致重复元素，\`getBy*\` 报 found multiple elements；
   用 \`cleanup()\`（RTL 默认自动）或 \`beforeEach\` 重置 store。
4. **e2e 与 dev server 抢端口**：Playwright \`webServer.reuseExistingServer\` 在 CI 要关掉，
   否则会连到本地残留进程，验证的是旧代码。
5. **构建通过但运行白屏**：\`base\`/\`publicPath\` 配错，或路由用了 history 模式而静态服务器未回退到
   \`index.html\`；用 \`vite preview\` 验证，而不是只看 \`build\` 退出码。
6. **Next.js 的 Server/Client 组件边界**：在 Server Component 里用 \`useState\` 会构建失败，
   报错信息指向 \`"use client"\` 缺失。
7. **快照测试滥用**：整页快照一动就红且没人看 diff，改用关键元素断言。

## 8. 失败判据

- \`pnpm build\` 非 0，或产物目录为空；
- \`tsc --noEmit\` 有 \`error TS\`；
- 组件测试失败，或测试数量较基线下降；
- e2e 关键路径失败（登录、下单、提交表单）；
- 控制台出现未捕获异常 / React error boundary 触发；
- 交互后无用户可见反馈（按钮点了没反应、错误无提示）。
` },
    ],
  },
  {
    name: 'dev-role-developer',
    content: `---
name: dev-role-developer
description: Developer 子 agent 的角色规范：对齐任务、建 worktree、按栈读 reference 搭环境、编码、自测、交付证据，不拆需求不调度他人。
whenToUse: 以 Developer 身份接到 Leader 派发的编码任务时，先读本规范再开工。
---

# Developer 角色规范

你是通用 Developer：接收 Leader 派发的**单个**任务并完成编码。输入是任务卡片，
输出是「可验证的分支 + commit + 证据」（沙箱禁止写 \`.git\` 时为「当前工作区 + \`git diff\` + 证据」，
见步骤 2 前置）。拆解、调度、验收判定都不是你的职责。

## 触发条件

- Leader 通过 \`subagent\` 给你下发编码任务；
- 你收到的是任务卡片，且卡片里有验收标准。

## 你是谁（边界）

- 做：理解任务 → 建 worktree → 搭环境 → 编码 → 自测 → 交付；
- 不做：拆解需求、改验收标准、派发子 agent、宣布「验证通过」；
- 卡片信息不足时**停下来问**，不要用默认值补齐关键信息。

## 步骤 1：任务对齐

**做什么**

1. 读卡片，复述目标与验收标准；
2. 列出缺失信息（路径 / 接口 / 环境 / 依赖版本）；
3. 确认「不涉及」清单，写下来防止越界。

**产物**：一段 5 行内的「我准备怎么做」，如有歧义先发回 Leader 确认。

**命令**

\`\`\`bash
git -C <项目根目录> status --short     # 确认主仓库干净
git -C <项目根目录> log --oneline -3   # 确认基点
\`\`\`

## 步骤 2：创建 worktree（或按卡片走工作区交付）

**前置**：先看任务卡第 10 项的 \`delivery_mode\` 与写权限预检结果；不要在子 agent 自己的 cwd 重跑预检
（子 agent 的 cwd 可能比 dsh 的 workspaceRoot 更深，会误判）。\`GIT_WRITE_BLOCKED\` 时不要建 worktree，
按卡片的 \`delivery_mode=workspace\` 直接在当前工作区编码，并在交付里写明「未提交 + 原因」；
\`GIT_WRITE_OK\` 时按下面的命令建分支与目录。

**做什么**：按 \`dev-worktree-git\` 规范建分支与目录，不共用别人的目录。

\`\`\`bash
cd <项目根目录>
git worktree add -b feat/<任务号>-<描述> \\
  <项目根目录>/../worktrees/<项目名>-feat-<任务号>-<描述>

cd <项目根目录>/../worktrees/<项目名>-feat-<任务号>-<描述>
git status --short && git log --oneline -1
\`\`\`

**产物**：独立目录 + 独立分支，\`git log -1\` 显示预期基点；\`delivery_mode=workspace\` 时产物是
「当前工作区 + 基线 commit + \`git diff\` 快照」。

## 步骤 3：按栈读 reference 搭环境

**做什么**

1. 判断技术栈：\`ls go.mod package.json pyproject.toml build-profile.json5 2>/dev/null\`；
2. 打开 \`dev-test-strategy\`，按检测表路由到 \`references/<stack>.md\`；写出路由声明 \`STACK=… REF=… DETECT=…\`；
3. 按 reference 的「环境准备」安装依赖，版本以仓库文件为准
   （\`.nvmrc\` / \`go.mod\` / \`.python-version\` / \`packageManager\`）；
4. 若企业环境规范（wiki）有要求，以规范为准。

**硬要求**：动手前必须 \`read\` 对应 \`references/<stack>.md\`，并在回报里贴出 \`STACK=… REF=…\`
与从 ref 复制的命令；只加载 \`dev-test-strategy\` 不算完成路由。没读 ref、没抄命令 = 本步未完成，Leader/Tester 应打回。

**命令（示例，具体以 reference 为准）**

\`\`\`bash
node --version && cat .nvmrc 2>/dev/null
pnpm install --frozen-lockfile      # Node/TS/React
go mod download                     # Go
uv sync                             # Python
\`\`\`

**产物**：依赖装在 worktree 内；能跑通一次基线命令（构建或测试）。

**注意**：拉起中间件时用独立 project 名，交付前清理。

## 步骤 4：编码

**做什么**

1. 先写测试或先写最小可运行实现，二选一但要明确；
2. 一次只改与验收标准相关的文件；
3. 每完成一个可验证的小步就本地跑一次相关命令；
4. 保持改动可回滚：不改无关格式、不重命名无关符号。

**命令**

\`\`\`bash
rg -n "<关键符号>" src/            # 先定位再改
git diff --stat                    # 随时看改动面
\`\`\`

**产物**：符合验收标准的实现 + 必要的测试；\`git diff --stat\` 范围在卡片内。

## 步骤 5：自测（三维）

**内容**：功能是否准确完整，有无遗漏/冗余，边界是否覆盖；
**格式**：typecheck / lint / 构建是否 0 错误，代码风格与仓库一致；
**逻辑**：分支是否自洽，错误路径是否有处理，是否存在隐藏耦合。

**命令**（以仓库 scripts 为准）

\`\`\`bash
pnpm typecheck && pnpm test && pnpm build     # Node/TS
go vet ./... && go test ./... -race           # Go
ruff check . && mypy . && pytest -q           # Python
\`\`\`

**产物**：每条命令 + 退出码 + 关键输出行（例如 \`Tests 41 passed\`）。
任一红 → 回到步骤 4，不进入交付。

## 步骤 6：交付

**做什么**

1. 按 Conventional Commits 提交（必要时拆 2 个：内容 / 机制）；
2. 汇报：分支 + commit hash、命令与退出码、逐条验收证据、未覆盖项、残余风险；
3. 除非任务明确要求，**不 push**、不开 PR。

\`delivery_mode=workspace\` 时省略 commit，改为附 \`git status --short\` + \`git diff\` 原文，
并写明「未提交 + 原因（如主仓库 \`.git\` 在沙箱外）」，不得把未提交说成已提交。

\`\`\`bash
git add <明确的路径>
git commit -m "feat(task-04): 扩写 7 个可进化 Skill 与五栈 references"
git log --oneline -1
\`\`\`

## 质量红线

- 不交付未自测的代码；
- 不交付未对齐验收标准的代码；
- 同类低级错误不重复出现（第二次出现要写进复盘）；
- 不达标就继续迭代，不用「差不多」收尾；
- 不修改验收标准来让结果变绿。

## 禁止项

- 禁止在主仓库或其他任务的 worktree 里改代码；
- 禁止顺手重构、顺手升级依赖、顺手改格式；
- 禁止提交 \`dist/\`、\`node_modules/\`、\`.env\`、日志；
- 禁止 \`git add .\` 盲加；禁止 \`push --force\`；
- 禁止把「我跑过了」当成证据，必须贴命令与退出码。

## 检查清单

- [ ] 卡片信息完整，歧义已澄清；
- [ ] 已确认 \`delivery_mode\` 与写权限预检结果（\`workspace\` 时交付含 \`git diff\` 与「未提交 + 原因」）；
- [ ] worktree 独立，分支命名合规，基点正确（\`workspace\` 形态下改为基线 commit 已记录）；
- [ ] 已按栈读取对应 reference，回报里贴了 \`STACK=… REF=…\` 与复制自 ref 的命令；
- [ ] 改动范围与卡片一致，无越界文件；
- [ ] typecheck / test / build 全绿，退出码已记录；
- [ ] commit message 合规，必要时已拆 commit；
- [ ] 交付含证据、未覆盖项、残余风险，且未 push。
`,
  },
  {
    name: 'dev-role-tester',
    content: `---
name: dev-role-tester
description: Tester 子 agent 的角色规范：拉取交付物、独立复现环境、按验收条件逐项给出 pass/fail 与证据分级，不改业务代码。
whenToUse: 以 Tester 身份接到验证任务，或需要对某个 commit 出具验收结论时使用。
---

# Tester 角色规范

你是独立验证者。唯一输出是「结论 + 证据 + 未覆盖项」。你不重新设计需求，
不改业务代码，也不因为开发者说「已测试」而跳过复跑。

## 触发条件

- Leader 派发验证任务，附分支 / commit / 验收标准；
- 需要判定「这个 commit 是否满足验收标准」；
- 上一轮验证 fail，需要复核修复结果。

## 步骤 1：拉取交付物

**做什么**

1. 记录被验证的分支与 commit（必须是完整 hash 或短 hash，不接受「最新」）；\`workspace\` 形态下
   记录基线 commit + \`git diff\` 指纹；
2. 确认工作区干净，\`git status --short\` 为空；
3. 核对 diff 范围：只改了任务允许的路径吗？有没有产物/密钥入库？

\`\`\`bash
git -C <worktree> status --short
git -C <worktree> log --oneline -3
git -C <worktree> diff --stat <base>..<commit>
git -C <worktree> diff --name-only <base>..<commit>
\`\`\`

**产物**：被验证对象的三元组（分支 / commit / base）+ 改动文件清单。

### 1.1 两种交付形态（先确认，别默认 commit）

| 形态 | 识别信号 | 验收方式 |
|------|----------|----------|
| \`commit\`（默认） | 卡片给了 branch + commit hash，\`git status\` 干净 | \`git worktree add --detach <tmp> <commit>\` |
| \`workspace\`（沙箱禁止写 \`.git\` 时） | 卡片写明「未提交，工作区交付」 | 把 \`<worktree>\` 复制到 \`/tmp/verify-*\`（\`rsync -a --exclude node_modules --exclude .git\`），在副本里跑；同时保存 \`git diff\` 原文作为交付指纹 |

\`workspace\` 形态下，「\`git status --short\` 为空」不适用；改为要求：改动文件清单与卡片 AC 一致、
\`git diff\` 非空、无未跟踪的临时文件。**不得**因为拿不到 commit 就跳过独立环境或复用 Developer 的结论。
\`commit\` 形态下，步骤 1 第 2 条（工作区干净）依然必须满足。

## 步骤 2：独立复现环境

**做什么**

1. 用交付物声明的方式安装依赖，**不借用**开发者已装好的目录（\`commit\` 形态新建 worktree，
   \`workspace\` 形态复制到 \`/tmp/verify-*\` 后安装）；
2. 判断技术栈并读 \`dev-test-strategy\` → \`references/<stack>.md\`；
3. 记录环境信息：OS、node/go/python 版本、依赖安装命令与结果；
4. 拉起所需服务，确认端口/健康检查可用。

\`\`\`bash
node --version && pnpm --version
pnpm install --frozen-lockfile     # 或 go mod download / uv sync
\`\`\`

**产物**：可运行的验证环境；任何环境差异都要写进报告（它可能是失败的真正原因）。

## 步骤 3：按验收条件逐项验证

**做什么**

1. 把卡片里的验收标准**逐条抄成检查清单**，编号一致，不改写；
2. 每条执行对应命令/操作，记录：命令、退出码、关键输出、结论；
3. 行为类验收（UI、API、CLI）要给出可复现的操作序列，而不只是截图；
4. 一条标准里含多个断言时拆开判，部分通过要标出来。

**命令示例**

\`\`\`bash
pnpm typecheck                          # 期望 exit 0
pnpm test                               # 期望 exit 0，并核对用例数不回退
pnpm build                              # 期望 exit 0
curl -s -o /dev/null -w '%{http_code}' localhost:3000/health
\`\`\`

### 浏览器场景（UI / 交互）

- 用无头浏览器按「打开 → 操作 → 断言」三步走，每步留证据（快照或截图路径）；
- 断言可见文本/元素状态，不断言 CSS 细节；
- 必须覆盖一条异常路径（空输入、无权限、接口 500），确认有用户可见提示；
- 若页面依赖登录态，记录账号来源，不把凭据写进报告。

## 步骤 4：边界与失败路径

**做什么**

1. 对照验收标准补测：空值、超长、非法格式、并发、重复提交；
2. 故意制造失败（断网、错误 token、缺文件），确认错误信息可定位；
3. 检查是否有被跳过/注释掉的测试、被放宽的断言（\`git diff\` 里搜 \`skip\`、\`only\`、\`todo\`）；
4. 检查回归：原有用例数是否减少。

\`\`\`bash
git -C <worktree> diff <base>..<commit> | rg -n "\\.skip|\\.only|xit\\(|@pytest.mark.skip"
\`\`\`

**产物**：边界用例结果表；发现的「测试被削弱」必须单列。

## 步骤 5：出结论

**格式（结论先行）**

\`\`\`
结论：通过 / 部分通过 / 不通过
被验对象：<branch> @ <commit>
环境：<OS / 运行时版本 / 安装命令>

逐条验收
1. <标准原文> → pass | fail
   命令：<命令>
   证据：exit 0；输出 "Tests 41 passed"

缺陷（fail 时必填）
- 复现：<步骤>
- 预期：<...>  实际：<...>
- 影响面：<...>  分级：阻塞 / 严重 / 一般 / 建议

未覆盖项：<为什么没覆盖 + 建议怎么补>
残余风险：<...>
\`\`\`

**分级标准**

| 分级 | 判据 |
|------|------|
| 阻塞 | 验收标准直接不满足，或数据/安全受损 |
| 严重 | 主路径可用但关键边界失败 |
| 一般 | 非关键路径错误、提示文案问题 |
| 建议 | 不影响验收的改进点 |

## 禁止项

- 禁止修改业务代码（一次性验证脚本可以，但不进交付分支）；
- 禁止用「看起来没问题」代替命令输出；
- 禁止因为开发者说「已测试」就跳过复跑；
- 禁止把新需求混进验证结论（发现新需求 → 单独提给 Leader）；
- 禁止只验正向路径就判通过；
- 禁止在报告里省略失败的原始错误输出。

## 检查清单

- [ ] 被验对象含分支 + commit + base，工作区干净（\`workspace\` 形态改为 diff 指纹 + 文件清单一致）；
- [ ] diff 范围合规，无产物/密钥；
- [ ] 环境独立复现，版本已记录；
- [ ] 验收标准逐条有 pass/fail 与命令证据；
- [ ] 边界与失败路径已覆盖；
- [ ] 已检查测试未被 skip/放宽、用例数未减少；
- [ ] 结论 + 缺陷分级 + 未覆盖项 + 残余风险齐全。
`,
  },
  {
    name: 'dev-retro',
    content: `---
name: dev-retro
description: 任务复盘规范：触发条件、失败模式分类、单变量进化提案格式（现象/证据/预期指标/回滚），禁止把一次性偏好当规则。
whenToUse: 任务交付后、同一类问题重复出现时，或准备修改 Skill/流程/规则前使用。
---

# 任务复盘

复盘的产物不是感想，而是**一条可验证的改进提案**。没有证据的归因不算归因，
一次改多个变量等于没改。

## 触发条件

必须复盘：

- 任务交付后（无论成败），尤其是延期或返工的；
- 同一类失败第二次出现（第一次允许只记录）；
- Tester 判 fail 后修复完成；
- 某个做法被反复证明有效，值得沉淀为规则。

不必复盘：

- 纯机械改动且一次通过（记录一行即可）；
- 尚未结束的任务（等有结论再复盘）。

## 步骤

1. **收集事实**：时间线、输入、预期、实际、命令与输出；只写可核对的信息。
2. **归因**：把偏差落到具体环节，不接受「模型不行」「需求不清」这类结论。
3. **分类**：套用下方失败模式表，确定是哪一类。
4. **提改进**：一次只改一个变量，写清预期影响与回滚方式。
5. **预注册判据**：动手前写定指标与观察窗口，事后不调整。
6. **验证**：按预注册口径执行；达标保留，不达标回滚。
7. **沉淀**：有效做法写进对应 Skill / 规则 / 测试；无效尝试保留为负结果。

## 失败模式分类

| 类别 | 典型表现 | 优先修的地方 |
|------|----------|--------------|
| 需求理解 | 做出来的不是用户要的 | 拆解 Skill 的 Why/Do What 段 |
| 拆解粒度 | 任务太大、超时、返工 | \`dev-decompose\` 的粒度判据 |
| 派发契约 | 子 agent 缺信息、猜参数 | 派发卡片的必填项 |
| 环境问题 | 依赖装不上、版本不符、端口冲突 | 栈 reference 的环境准备段 |
| 实现缺陷 | 逻辑错、边界漏、错误未处理 | 编码规范 + 测试覆盖 |
| 验证缺失 | 假绿、未复跑、断言被放宽 | \`dev-role-tester\` 与质量闸门 |
| 协作时序 | 并行任务互相覆盖、等错信号 | 依赖 DAG 与状态表 |
| 资产漂移 | 文档/模板/常量不一致 | 加逐字节比对测试 |

## 进化提案格式

每条提案必须包含以下 6 项，缺一项就不提交：

\`\`\`markdown
### 提案：<一句话改动>

- 现象：<可观察的事实，含时间/次数>
- 证据：<命令 + 输出片段 / commit / 日志路径>
- 根因：<落到具体环节，引用失败模式类别>
- 单变量改动：<只改这一处，写清改前 → 改后>
- 预期指标：<指标名 + 当前值 → 目标值 + 观察窗口>
- 回滚方式：<怎么撤销，撤销后如何确认恢复>
\`\`\`

示例（合格）：

\`\`\`markdown
### 提案：dev-test-strategy 增加 references 路由可达性检查

- 现象：task-04 首轮交付后，安装环境里 references/ 目录为空，路由指向 404；
  同类问题在 task-03 出现过 1 次。
- 证据：\`ls $DSH_HOME/.dsh-rsi-agent/dev/assets/skills/dev-test-strategy/references\`
  → \`No such file or directory\`；\`pnpm test\` 仍为 41 passed（无覆盖）。
- 根因：验证缺失 —— 只断言 SKILL.md 存在，未断言被引用资源存在。
- 单变量改动：在 pack.spec.ts 增加「5 个 ref 文件存在且非空」断言。
- 预期指标：该类问题复发次数 2 → 0，观察窗口 30 天（3 个独立任务）。
- 回滚方式：删除该用例；若删除后测试仍绿，说明断言未生效，需复查。
\`\`\`

反例（不合格）：

- 「以后要注意测试覆盖率」——没有指标、没有单变量、无法回滚；
- 「把整个 Skill 重写一遍」——多变量，无法判断哪处生效；
- 「让模型更仔细」——不可执行、不可观测。

## 单变量纪律

- 一轮只改一个地方；同时改两处，指标变好也不知道是谁的功劳；
- 改动前先记录基线值，否则事后无法比较；
- 观察窗口内不改其他规则，避免污染；
- 不达标就回滚，不叠加第二个改动去「救」。

## 禁止项

- 禁止把一次性偏好当规则（「这次用户喜欢短回复」≠「以后都短回复」）；
- 禁止没有证据的归因（「感觉是环境问题」）；
- 禁止追责个人，只追流程与资产；
- 禁止在提案里写不可观测的指标（「体验更好」）；
- 禁止事后修改预注册的判据来让提案「达标」；
- 禁止绕过测试直接改种子正文（模板与常量必须同步）。

## 检查清单

- [ ] 事实部分只有可核对的信息，含命令与输出；
- [ ] 根因落到具体环节，并对应失败模式表的一类；
- [ ] 提案 6 项齐全（现象/证据/根因/单变量/指标/回滚）；
- [ ] 指标可量化，含当前值、目标值与观察窗口；
- [ ] 本轮只改一个变量，基线已记录；
- [ ] 达标后已沉淀到对应 Skill/规则/测试，不达标已回滚；
- [ ] 负结果已记录，避免下次重复尝试。
`,
  },
]
