---
name: dev-dispatch-contract
description: Leader 派发契约：10 字段上下文卡片、preset 选择表、Developer/Tester 边界、派发即结束本轮与失败回报格式。
whenToUse: 准备调用 subagent 派发任务之前，或收到子 agent 回报需要核对格式时使用。
---

# 派发契约（固件）

本 Skill 是固件：随 `dsh-dev-domain` 发布，只读，不参与进化。

## 触发条件

- 准备调用 `subagent` 工具派发 Developer 或 Tester 之前（组卡片、选 preset）；
- 收到子 agent 完成通知 / 失败回报，需要核对是否符合回报格式；
- 任务需要拆分、改派、打回重修时；
- 用户临时插入新需求，需要判断能否塞进当前派发时（结论：不能，另开一条）。

## 步骤

### 1. 选 preset

| 任务类型 | `agent_preset` | 说明 |
|----------|----------------|------|
| 编码、改文件、写测试、改配置 | `dev-developer` | 所有写操作都走这里 |
| 独立验证、验收重跑、对抗性测试 | `dev-tester` | 编码任务交付前必过一次 |
| 文档 / 脚本类仓库改动 | `dev-developer` | 与代码同等要求 |
| 需求拆解、进度汇报、`git commit` / `push`、Wiki 维护 | 不派发 | Leader 元操作，自己做 |

- `subagent` 的 `agent_preset` 枚举只有 `dev-developer` / `dev-tester` 两项，`dev-leader` 不可作为派发目标。
- `maxDepth: 1`：子 agent 无法再向下派发。需要多人协作时，由 Leader 串行拆成多次派发，禁止让子 agent「自己找人」。
- 一次派发只装一个可独立验收的任务；两个不相关任务塞一张卡片 = 返工。

### 2. 填 10 字段卡片（直接复制改写）

```markdown
📋 任务上下文

1. 任务编号与名称：任务-03 / 固件 Skill 内容补全
2. 领域 / 技术栈：node-ts（Node 22 + TypeScript 5 + pnpm 11）
3. 背景：为什么做；关联文档链接 / Issue / 上一轮结论（写链接，不写「见上」）
4. 目标（一句话交付物）：把 3 个 SKILL.md 从骨架扩写成含四节的完整规则
5. 路径与分支：
   - 项目根：/abs/path/to/repo
   - worktree：/abs/path/to/worktrees/<repo>-<type>-<task>
   - 分支：feat/task-03-firmware-skills（基于 45a1443）
6. 验收标准（逐条可判定）：
   - [ ] AC1 三个文件均含 `## 触发条件` / `## 步骤` / `## 禁止项` / `## 检查清单`
   - [ ] AC2 `pnpm typecheck` exit 0
   - [ ] AC3 `pnpm test` exit 0，41 条不回退
7. 约束：只改 skills/<name>/SKILL.md；禁止 push；禁止改 src/ tests/ templates/；frontmatter 只允许单行 key: value
8. 相关关键词与 Skill：Wiki 检索「固件 skill / 派发契约」；本任务无需加载业务 Skill
9. 交付格式：分支 + commit hash；每条命令 + 退出码；AC 逐条证据；未覆盖项与风险
10. 交付形态与环境限制：`delivery_mode: commit|workspace`；不可写路径（如主仓库 `.git/`）、
    无审批通道、网络/凭据限制、必须降级的命令
```

字段硬要求：

- 第 6 项每条都要能被一条命令或一次文件检查判定，禁止「体验良好」「符合规范」。
- 第 7 项必须显式写「禁止 push」，否则子 agent 可能自行推送。
- 第 8 项没有可加载的 Skill 时写「无」，不要留空导致子 agent 自行发挥。
- 第 10 项必须显式写 `delivery_mode`；`workspace` 时还要写清「Tester 如何取得交付物」（复制路径/忽略目录）。
- 路径写绝对路径；相对路径在子 agent 的 cwd 里可能解析不到。

### 3. 调用方式

```text
subagent({
  description: "任务-03 固件 Skill 补全",   // 3~5 个词，用于列表展示
  prompt: "<上面 10 字段卡片全文>",
  agent_preset: "dev-developer",
  cwd: "/abs/path/to/worktree"
})
```

- `description` 必填，3~5 个词；`prompt` 必填，装整张卡片；`cwd` 指向 worktree，避免子 agent 在错误目录操作。
- 工具会立刻返回 `subagentId`，完成时由运行时推送通知，没有「同步等待」模式。

### 4. 派发后立刻结束本轮

- 派发即结束回合，不写 `sleep`、不轮询 `process poll`、不反复 `git status` 看有没有产物、不发消息追问进度。
- 等待期间**不要**改同一批文件（会与子 agent 冲突），也不要提前开始下一个任务的编码。
- 允许做的事：与本次派发无关的文档 / 记忆维护；或者什么都不做，直接结束回合。
- 完成通知会自动回到本会话，届时再进入第 5 步。

### 5. 收到回报后核对

1. 对照卡片里的 AC 逐条读证据，不读结论句。
2. `git -C <worktree> status --short` 与 `git diff --stat`：改的文件是否在允许范围内。
3. 命令与退出码是否齐全、是否可复现（必要时自己重跑一条只读命令）。
4. 有越界改动 / 缺证据 / 结论与退出码矛盾 → 打回，不进入 Tester。
5. 通过则按 `dev-quality-gate` 走 triage → Tester。

## 禁止项

- 禁止只给一句「按需求实现」就派发；卡片缺字段等于让子 agent 猜。
- 禁止不传 `agent_preset`（会落到默认 preset，角色与任务不匹配）。
- 禁止不传 `cwd` 让子 agent 继承 Leader 目录后在主工作区改动。
- 禁止把多个不相关任务塞进同一次派发。
- 禁止派发后 `sleep` / 轮询 / 反复查状态；也禁止中途改同一批文件。
- 禁止让子 agent 自行决定验收标准、自行放宽断言、自行 push。
- 禁止在子 agent 回报「完成」后不做 triage 就转交 Tester 或直接交付。
- 禁止把 Tester 报告当结论而不看证据（报告也可能错）。

### Developer 边界（写进卡片第 7 项「约束」）

- 不拆解需求：卡片给什么做什么，范围外发现的问题写进「未覆盖项」，不顺手改。
- 不调度：不派发其他 agent，需要协作时回报 Leader。
- 不改验收标准：AC 有异议先回报，不自行下调。
- 不 push、不改主线分支、不改他人 worktree。
- 不夹带：格式化全仓库、升级依赖、重命名无关文件一律禁止。

### Tester 边界（写进测试卡片）

- 不改业务代码：发现问题只出报告，不提交修复。
- 不放宽断言：测试必须按 AC 写，不能为了绿灯改预期值。
- 不复用被测方的验证脚本作为唯一证据：至少另写一条独立断言。
- 不替 Developer 修 bug，不替 Leader 做交付决定。
- 不隐瞒失败：跑挂了就写 FAIL + 原始输出。

### 失败回报格式（子 agent 必须按此回）

```text
❌ 任务-03 未完成

1. 卡在哪一步：第 4 步「跑 pnpm test」，tests/pack.spec.ts:280 断言失败
2. 已尝试：重跑 2 次（均 exit 1）；清理 node_modules 重装后仍失败
3. 证据：
   $ pnpm test
   exit 1
   FAIL tests/pack.spec.ts > 固件 Skill > frontmatter.name 与固件名一致
4. 需要 Leader 决策：A) 放宽断言（不推荐） B) 改 SKILL.md 的 name 字段 C) 先修测试
5. 建议下一步：选 B，我改 frontmatter 后重跑；预计 10 分钟
```

- 五段缺一不可：卡点、已尝试、证据、待决策项、建议下一步。
- 待决策项最多 3 个，每个带选项与推荐，不让 Leader 做开放式问答。
- 禁止只回「失败了」「环境有问题」「需要更多时间」；这类回报视为无效，直接打回重报。

### Leader 收到失败后的处理

| 症状 | 处理 |
|------|------|
| 卡片缺信息 | 补齐字段，原 preset 重新派发 |
| 环境缺失（依赖 / 中间件） | 派 `dev-developer` 装依赖或起中间件，再重派原任务 |
| 代码错误 / AC 不达标 | 附失败证据打回 `dev-developer`，不自己修 |
| Tester FAIL | 回 Developer 修，修后完整重跑 typecheck/test/build |
| 超时 / 无产出 | 查 `git status` / `git diff`：有产物走 triage，无产物缩范围重派 |
| 越界改动 | 打回并要求回退越界部分，保留有效改动 |

## 检查清单

### 派发前

- [ ] 10 个字段全部填满，无「待补充」「见上」
- [ ] 每条 AC 可判定，附了判定方式（命令 / 文件检查）
- [ ] 项目路径与 worktree 真实存在（`ls` 过）
- [ ] 分支已建，基线 commit 写进卡片
- [ ] 约束写明只读目录、禁止 push、禁止改动的模块
- [ ] 交付格式写明分支 + commit + 命令退出码 + 未覆盖项
- [ ] 第 10 项 `delivery_mode` 已确认（`workspace` 时写明 Tester 的取物方式）
- [ ] `agent_preset` 与任务类型匹配，`cwd` 指向 worktree
- [ ] 只装了一个可独立验收的任务

### 收到回报后

- [ ] AC 逐条对照证据，而不是看「已完成」三个字
- [ ] `git status` / `git diff --stat` 已看，改动在允许范围内
- [ ] 命令与退出码齐全，关键一条已复现
- [ ] 未覆盖项与风险已列出，没有「应该没问题」
- [ ] 已决定下一步：进 Tester / 打回 / 升级给用户
