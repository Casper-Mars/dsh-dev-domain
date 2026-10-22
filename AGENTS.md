# AGENTS.md

面向**在本仓库工作的 agent**。人类安装与使用说明见 [README.md](./README.md)。

## 1. 这个仓库是什么

`dsh-dev-domain` 是一个 dsh 领域包（DomainPack + Cordis 插件），**产物是 Skill 资产与 agent preset，不是业务应用**。

- **零工具**：`devPack.tools()` 返回 `[]`，`toolNames` 为 `[]`。文件 / 命令 / 技能 / 待办 / 子 agent 能力全部由 `cordis.patch.yml` 的 preset 组合 dsh 内置插件提供。
- **零状态文件**：领域不写业务数据。唯一写入是 `assets.bootstrap` 把 12 个资产（7 个种子 `SKILL.md` + 5 个 `references/*.md`）落到 `<home>/assets/skills/`，并且只产生 **1 个 commit**。
- **运行态 3 层 Skill，共 13 条**：7 个可进化种子 + 3 个领域固件 + 3 个 core 固件。
- **环境基线**：dsh `0.2.1-rc.2`、Node ≥ `22.19.0`、pnpm ≥ `11.7.0`。

改代码前先确认改的是哪一层：

| 层 | 位置 | 性质 |
|----|------|------|
| 可进化种子 | `templates/` → `src/seeds.ts` | 安装后落到 assets，可被进化引擎改写 |
| 领域固件 | `skills/` + `src/pack.ts` / `src/plugin.ts` | 随包只读，不参与进化 |
| core 固件 | 不在本仓库 | `rsi-evolution` / `skill-authorship` / `task-authorship` |

## 2. 命令表

在仓库根目录执行。所有命令都应在实现改动后重跑，不能只看历史结果。

| 命令 | 做什么 | 成功判据 |
|------|--------|----------|
| `pnpm install` | 按 `pnpm-workspace.yaml` 的 override 把 `dsh-rsi-agent` 链到 `../dsh-rsi-agent` | 退出码 0，生成 `node_modules/`；需同级存在 core 仓库 checkout（`worktrees/dsh-rsi-agent` 符号链接） |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit` | 退出码 0，无类型错误输出 |
| `pnpm test` | `vitest run`，3 个 spec 文件 | **57 passed**、退出码 0；注意脚本带 `--passWithNoTests`，0 个用例也会退出 0，不能只看退出码 |
| `pnpm build` | `clean` → `typecheck` → `tsc -p tsconfig.server.json` → `copy-assets.mjs` | 退出码 0，产出 `dist-server/index.js` 与 `dist-server/cordis.patch.yml` |
| `pnpm verify:install` | 校验 7 个种子 + 5 个 references + 3 个固件 | 15 行 `PASS`、退出码 0；有 `FAIL` 退出码 1；参数或环境错误退出码 2 |

`pnpm verify:install` 的资产根优先级：`--assets` > `--home` > `DSH_HOME` > 仓库 `templates/`。
未设置 `DSH_HOME` 时它校验的是**仓库模板**，不是安装态；要验安装结果必须显式给 `DSH_HOME`
或 `--assets`。

## 3. 目录职责

| 路径 | 职责 | 改动规则 |
|------|------|----------|
| `src/index.ts` | 包入口，导出插件三要素与 `devPack` | 只做 re-export |
| `src/plugin.ts` | Cordis 插件：`name` / `inject` / `apply`，领域安装与固件 Skill 注册/反注册 | `name` / `inject` 必须与 `cordis.patch.yml` 逐项一致 |
| `src/pack.ts` | `DomainPack`：人设、资产类型与校验、`firmwareSkills` 声明、`bootstrap` | 资产前缀只在此声明；校验保持纯函数、无 IO |
| `src/firmware.ts` | 固件 `SKILL.md` 路径推导、frontmatter 解析、`SkillRegistration` 构造 | 只解析 `name` / `description` / `whenToUse` |
| `src/seeds.ts` | 7 个种子正文 + 5 个 references 的字符串常量 | 必须与 `templates/` **逐字节一致** |
| `skills/` | 3 个领域固件 Skill | 随包只读，不参与进化；不要擅自改 |
| `templates/` | 7 个种子 Skill 的**真源** | 改种子先改这里 |
| `scripts/verify-install.mjs` | 15 项安装后自检 | 检查清单是唯一真源，测试直接断言 |
| `tests/` | 契约 / 种子漂移 / 校验 / 固件注册 / 真实 AgentHost / 自检脚本 | 改契约或数量必须同步断言 |
| `cordis.patch.yml` | bundle patch：core + 领域 + 3 个 preset + 顶层 `tool-subagent` | 改 preset / 默认值必须跑测试并装一次验证 |

## 4. 硬规则（违反即返工）

1. **`templates/**` 是真源**：`src/seeds.ts` 必须与 `templates/` 逐字节一致。`tests/pack.spec.ts` 会对 7 个 `SKILL.md` 和 5 个 `references/*.md` 做逐字节比对，漂移直接失败。
2. **frontmatter 只有三个字段**：`name` / `description` / `whenToUse`，且只能是**单行扁平标量**（可带成对引号）。正文不得残留 frontmatter；`name` 必须等于目录名。
3. **资产路径只有两种合法形状**：`skills/<dir>/SKILL.md` 与 `skills/<dir>/references/<file>.md`。references 只允许 `.md`、只允许一层；`..`、绝对路径、反斜杠、空段、嵌套目录一律拒绝（`src/pack.ts` 的 `parseSkillAssetPath`）。
4. **`bootstrap` 必须同步，且只调用一次 `writer.register`**。async 会让 core 判安装失败；多次调用会变成多个 commit。测试会断言调用次数为 1、返回值是 `undefined`、函数不是 `AsyncFunction`。
5. **零工具**：不得新增 `tools()` 返回值，不得新增 `toolNames` 条目。需要能力就改 preset 组合，不要在领域包里实现工具。
6. **固件 Skill 只读**：`skills/` 随包发布、不参与进化；不得占用 core 保留名 `rsi-evolution` / `skill-authorship` / `task-authorship`（core 会做重名冲突校验）。
7. **不改 core**：本仓库只通过 `dsh-rsi-agent` 的公开导出交互；需要 core 改动时停下来上报，不要修改 `../dsh-rsi-agent`。

## 5. 改哪里怎么改

### 配方 A：改一个种子 Skill

1. 改 `templates/<name>/SKILL.md`（真源）；
2. 把同样的正文同步到 `src/seeds.ts` 对应 `content` 模板字符串；
3. `pnpm test`（至少跑 `tests/pack.spec.ts` 的逐字节比对）。

> `src/seeds.ts` 用模板字符串存正文：正文里的反引号要写成 `` \` ``，`${` 要转义成 `\${`。漏转义会直接编译失败或内容漂移。

### 配方 B：加 / 改 references

1. 在 `templates/dev-test-strategy/references/<stack>.md` 新增或修改文件；
2. 同步 `src/seeds.ts` 中 `dev-test-strategy` 的 `references` 数组（`path` 形如 `references/go.md`，`content` 为全文）；
3. 新增文件时同步 `scripts/verify-install.mjs` 的 `EXPECTED_REFERENCE_STACKS`（检查项总数随之变化）；
4. 同步数量断言：`tests/pack.spec.ts` 的 references 条数（当前 5）、
   `tests/verify-install.spec.ts` 的两个字面量断言：`toBe(15)` 与 `toHaveLength(14)`；
5. `pnpm test` + `pnpm verify:install`。

### 配方 C：新增一个可进化 Skill

1. 新建 `templates/<new-name>/SKILL.md`（frontmatter 三字段，`name` = 目录名）；
2. 在 `src/seeds.ts` 的 `SEED_SKILLS` 增加条目；
3. 同步 `scripts/verify-install.mjs` 的 `EXPECTED_SEED_SKILLS`（检查项总数会从 15 变化）；
4. 同步数量断言：`tests/pack.spec.ts`（当前 12 个资产 / 7 个 SKILL / 5 个 references）与
   `tests/verify-install.spec.ts`（当前为 `toBe(15)` 与 `toHaveLength(14)` 两个字面量断言）；
5. 同步 README 的 Skill 表与「运行态 13 条」的分层说明；
6. `pnpm typecheck && pnpm test && pnpm build && pnpm verify:install`。

### 配方 D：改 preset / 默认 preset

1. 改 `cordis.patch.yml`；
2. `pnpm test`（会校验两条**独立**路径：① **主会话**——`agent-preset-registry.default` 必须是
   `dev-leader`，且不得是 `dev-developer` / `dev-tester`；② **子 agent 漏传兜底**——**两处**
   `tool-subagent.agentPreset`（Leader preset 内 + 顶层补丁）必须是 `dev-tester`；
   另校验 3 个 preset 都 `complete: true`、`allowedAgentPresets` 不含 `dev-leader`、
   `tool-subagent` 恰好两处、`maxDepth: 1`）；
3. 用全新 `DSH_HOME` 安装一次，跑 `dsh --profile <p> --dump-config` 核对组合树（不要用 `--dump-config-schema`，见常见坑）；
4. 同步 README 的「3 个 preset」小节。

## 6. Skill 写作规范

每个 Skill（种子与固件都一样）必须包含：

1. `## 触发条件`：什么情况下必须读它；
2. 流程节（`## 步骤` / `## 第一步…` / `## 阶段 1…` 等）：可执行的动作顺序；
3. `## 禁止项`：明确列不能做的事；
4. `## 检查清单`：可勾选的验收项。

写作要求：

- 写**具体命令、路径、阈值、字段名**，禁止「注意质量」「符合规范」「按最佳实践」这类无法判定的抽象话；
- 引用 references 时必须能落到真实文件（`references/<stack>.md` 必须在 `templates/dev-test-strategy/references/` 存在）；
- 阈值用表格或列表给出数值，不用「小 / 大 / 简单」描述；
- 角色边界写清楚「做什么 / 不做什么」，不要让子 agent 自行推断；
- 中文正文，结论先行，不写营销文案。

## 7. 提交规范

- 使用 Conventional Commits：`<type>(<scope>): <描述>`，`type` ∈ `feat|fix|docs|test|chore`；
- 一次逻辑改动一个 commit（种子与 seeds 同步属于同一个逻辑改动）；
- 提交前 `git status --short` 与 `git diff --stat`：只应有预期文件；
- 不提交 `node_modules/`、`dist/`、`dist-server/`、日志、临时文件；
- **不 push**、不改主线分支、不改 core 仓库；需要推送时由 Leader 明确授权。

## 8. 常见坑

1. **`skillProviderReady` 就绪 ≠ `list()` 立刻齐全**：web profile 下首轮扫描可能只返回固件条目，约 1s 后才有 13 条。断言要轮询到条数稳定（例如连续两次读到 13 条），不要只取首次结果。
2. **linked worktree + 默认 `workspace-write` 沙箱**：worktree 的 `.git` 在主仓库、位于工作区之外时，`git switch -c` / `git commit` / `git worktree add` 都会报 `Operation not permitted`。开工前先跑 `dev-worktree-git` 的写权限预检；`GIT_WRITE_BLOCKED` 时不要反复重试或提权，改用 `delivery_mode=workspace`（当前工作区 + `git diff` 交付）。
3. **`pnpm link:` 不会为被链接包装依赖**：把本包装进 profile 后，还要在 profile 目录单独 `pnpm add link:<core>`；否则 bundle patch 插入的 `rsi-agent` 行解析不到。
4. **`--dump-config-schema` 对嵌套 `plugins` 报错**：3 个 preset 各报一条 `unrecognized Loader tree carrier` 并以退出码 1 结束（dsh 自身限制）。schema 仍会打印到 stdout；日常核对组合树用 `--dump-config`（退出码 0）。
5. **子 agent 不会自动加载 Skill**：派发卡片必须点名角色 Skill（Developer：`dev-role-developer` + `dev-test-strategy`；Tester：`dev-role-tester` + `dev-test-strategy`），并要求回报 `STACK=… REF=… DETECT=…`。只写「按规范执行」等于没有约束。
6. **`pnpm test` 的 `--passWithNoTests`**：测试文件被误删或 include 配错时仍会退出 0。判据是 57 passed，不是退出码。

## 9. 交付前检查清单

- [ ] `pnpm typecheck` → exit 0
- [ ] `pnpm test` → exit 0，且 **57 passed**（数量随改动更新时，以真实输出为准）
- [ ] `pnpm build` → exit 0，`dist-server/index.js` 与 `dist-server/cordis.patch.yml` 存在
- [ ] 改过种子 / references 时：`templates/` 与 `src/seeds.ts` 逐字节一致（`pnpm test` 已验证）
- [ ] 改过资产数量时：`scripts/verify-install.mjs` 的期望清单、测试断言、README 已同步
- [ ] `git diff --stat` 无越界改动、无临时文件、无构建产物
- [ ] 文档与实现一致：README / AGENTS.md 里引用的路径与命令都真实存在
- [ ] 未 push、未改 core、未改固件 Skill（除非任务明确要求）
- [ ] 交付汇报含：分支 + commit、命令与退出码、未覆盖项与残余风险

## 10. 文档维护规则

以下任一变化，必须在**同一个 commit** 里同步 `README.md` 与 `AGENTS.md`：

- 默认 preset 或 preset 的工具面；
- `package.json` 的脚本 / 命令；
- 资产数量（种子、references、固件）或安装后 Skill 总数；
- 已知限制（`--dump-config-schema`、`skillProviderReady`、沙箱写权限）；
- 安装方式或 `DSH_HOME` 路径约定。

只改代码不改文档 = 交付不完整；文档里出现未验证的命令或路径 = 直接返工。
