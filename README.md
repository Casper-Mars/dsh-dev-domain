# dsh-dev-domain

> 在本仓库工作的 agent 请先读 [AGENTS.md](./AGENTS.md)。

开发领域包（dsh）：为 [`dsh-rsi-agent`](../dsh-rsi-agent) 提供 **Dev Leader 人设**、**10 个领域 Skill**
（3 个固件 + 7 个可进化种子）与 **3 个 agent preset**（Leader / Developer / Tester）。

## 设计边界

- **零工具**：`tools()` 返回空数组，`toolNames` 为空；文件 / 命令 / 技能 / 待办 / 子 agent 全部由 preset 组合 dsh 内置能力。
- **零状态文件**：领域不写业务数据，只在首次安装时通过 `assets.bootstrap` 注册 7 个可进化 Skill 种子与其参考文档。
- **单次提交**：bootstrap 只调用一次 `writer.register([...])`，12 个资产（7 个 `SKILL.md` + 5 个 `references/*.md`）落在**同一个** commit 里。
- **子 agent 隔离**：3 个 preset 的 persona 均声明 `complete: true`，子 agent 不继承 Leader 人设。

## 目录结构

```
.
├─ cordis.patch.yml          # bundle patch：rsi-agent + dev-domain + 3 preset + subagent 配置
├─ package.json              # dsh.bundle.patch 指向 cordis.patch.yml；files 含 skills/
├─ src/
│  ├─ index.ts               # 包入口
│  ├─ plugin.ts              # Cordis 插件（name / inject / apply；固件 Skill 静态注册 + 反注册）
│  ├─ pack.ts                # DomainPack：人设、资产类型与校验、固件 Skill 声明、bootstrap
│  ├─ firmware.ts            # 固件 SKILL 路径 / frontmatter 解析 / SkillRegistration 构造
│  └─ seeds.ts               # 7 个可进化 Skill 的种子正文 + 5 个 references（与 templates 逐字节一致）
├─ skills/                   # 固件 Skill（随包发布、只读、不参与进化）
│  ├─ dev-leader-rules/
│  ├─ dev-dispatch-contract/
│  └─ dev-quality-gate/
├─ templates/                # 7 个可进化 Skill 的种子模板（种子正文的真源）
│  ├─ dev-decompose/
│  ├─ dev-ralph-loop/
│  ├─ dev-worktree-git/
│  ├─ dev-test-strategy/     # 只做栈检测与路由
│  │  └─ references/         # 五栈参考：go / node-ts / react / harmony-arkts / python
│  ├─ dev-role-developer/
│  ├─ dev-role-tester/
│  └─ dev-retro/
├─ scripts/
│  ├─ copy-assets.mjs        # 把 cordis.patch.yml 等资源复制进 dist-server/
│  └─ verify-install.mjs     # 15 项安装后自检（CLI + 纯函数）
├─ tests/pack.spec.ts        # 契约 / bootstrap / 校验 / 真实 AgentHost 集成
├─ tests/firmware-registration.spec.ts  # 固件 Skill 注册 / 查重 / 卸载反注册 / 降级
├─ tests/verify-install.spec.ts         # 自检脚本的检查项 / 退出码 / 参数解析
├─ tsconfig.json / tsconfig.server.json / vitest.config.ts
├─ pnpm-workspace.yaml       # overrides: dsh-rsi-agent → link:../dsh-rsi-agent
├─ AGENTS.md                # 面向在本仓库工作的 agent 的操作手册
└─ .npmrc
```

## 安装

前置：dsh `0.2.1-rc.2`、Node ≥ `22.19.0`、pnpm ≥ `11.7.0`。

`dsh-rsi-agent` 尚未发布到 npm，因此**必须先把 core 与本仓库都编译**（`link:` 安装不会为被链接包
安装依赖，profile 端的 `main` 指向 `dist-server/index.js`，不编译则加载失败）：

```bash
cd /path/to/dsh-rsi-agent
pnpm install && pnpm build      # 产出 dist-server/

cd /path/to/dsh-dev-domain
pnpm install                    # workspace override 把 dsh-rsi-agent 链到 ../dsh-rsi-agent
pnpm build                      # 产出 dist-server/（含 cordis.patch.yml）
```

### 装进已有 profile（推荐）

```bash
dsh plugin --profile web add link:/path/to/dsh-dev-domain
cd "$DSH_HOME/profiles/web" && pnpm add link:/path/to/dsh-rsi-agent
dsh web
```

第二条命令是必需的：pnpm 不会为 `link:` 依赖安装它自己的依赖，profile 里必须先有
`dsh-rsi-agent` 才能解析 bundle patch 插入的 `rsi-agent` 行。这里用 `pnpm add` 而不是
`dsh plugin add`，是因为后者会把 core 也追加为**第二个 bundle**，导致 `rsi-agent` 重复插入。

### 装进全新 profile

`dsh plugin` 首次使用会自动初始化 profile，落地后 `dsh.bundle.patch` 会把
`rsi-agent` + `dev-domain` + 3 个 preset 一起插进组合树：

```bash
export DSH_HOME=/tmp/dsh-dev
dsh plugin --profile dev add link:/path/to/dsh-dev-domain
cd "$DSH_HOME/profiles/dev" && pnpm add link:/path/to/dsh-rsi-agent
dsh --profile dev --dump-config | grep -E "dev-domain|preset-dev-"
```

> 该 profile 只有 base 能力、没有 UI app；日常使用请走上面「已有 profile」的方式。

### 发布到 npm 后

```bash
dsh plugin --profile web add dsh-dev-domain
```

`dependencies.dsh-rsi-agent` 已声明 `^0.1.0`，正常依赖解析会一并装上 core，无需手动补第二条命令。

### 安装后自检

```bash
# 组合树里应出现 rsi-agent / dev-domain / 3 个 preset / tool-subagent 覆盖
dsh --profile web --dump-config | grep -E "dev-domain|preset-dev-|allowedAgentPresets"

# 资产目录应出现 7 个种子 Skill（默认会话 id = dev）
ls "$DSH_HOME/.dsh-rsi-agent/dev/assets/skills"

# 五栈参考文档应随种子落盘（路由可达）
ls "$DSH_HOME/.dsh-rsi-agent/dev/assets/skills/dev-test-strategy/references"

# 只应有一个种子提交（加上仓库初始化共 2 个）
git -C "$DSH_HOME/.dsh-rsi-agent/dev/assets" log --oneline
```

预期：`agentHost.active.id === 'dev'`、`agentHost.active.toolNames === []`；`skills.list()` 共
**13 条** = 7 个可进化种子 + 3 个领域固件（`dev-leader-rules` / `dev-dispatch-contract` /
`dev-quality-gate`）+ 3 个 core 固件（`rsi-evolution` / `skill-authorship` / `task-authorship`）；
3 个 preset 均无 `broken` 诊断；`agent_preset` 枚举为 `dev-developer` / `dev-tester`
（默认值为 `dev-tester`，见「3 个 preset」）；子 agent 的 system prompt 只含自己的角色措辞。

#### 自动化自检：`pnpm verify:install`

上面四条手工命令已固化为脚本 `scripts/verify-install.mjs`，安装后（或 CI 干净 checkout）
一次跑完 15 项检查：

```bash
DSH_HOME=/tmp/dsh-home pnpm verify:install       # 已安装态：读 $DSH_HOME/.dsh-rsi-agent/dev/assets/skills
pnpm verify:install                              # 未设置 DSH_HOME 时回退仓库 templates/
node scripts/verify-install.mjs --assets <资产根> --firmware <固件根>
```

- 输出 **15 行** `PASS` / `FAIL`：7 个可进化种子（`<资产根>/<name>/SKILL.md`）、
  5 个 references（`<资产根>/dev-test-strategy/references/<stack>.md`）、
  3 个固件（`<固件根>/<name>/SKILL.md`）；
- 任一 `FAIL` 会打印可定位路径并以**退出码 1** 结束，可直接用作门禁；
- 资产根优先级：`--assets` > `--home` > 环境变量 `DSH_HOME` > 仓库 `templates/`。
  前三者**任一显式给出**（`DSH_HOME` 非空即算）而目录不存在时，以**退出码 2** 报错并
  打印该路径，**不回退**——安装未完成必须显式失败，而不是被判「全 PASS」；
  只有三者都没有时才回退仓库 `templates/`，此时报告多一行 `# 仓库模板回退（…）：<路径>`；
- 参数：`--assets <dir>` 直接指定资产根；`--home <dir>` 指定 dsh home（脚本自动拼
  `.dsh-rsi-agent/dev/assets/skills`）；`--firmware <dir>` 指定固件根（默认包根 `skills/`）。

## 怎么用

装进 profile 后，主会话就是 **Dev Leader**。你给的是「需求 + 验收标准 + 约束」，不是逐行指令；
Leader 负责拆解、派发、验收和汇报。

### team 模式（默认）

直接把完整需求发给 Leader，例如：

```text
需求：给 dsh-finance 增加日线 MACD 背离检测，把信号输出成 CSV。
验收：
1. pnpm test 全绿，新增用例覆盖「有背离 / 无背离」两条路径；
2. 用仓库里的样例数据跑一次，能生成 CSV 且至少一行信号；
3. README 补一段用法，命令可直接复制执行。
约束：只改 packages/detector，不改公共 API，不新增运行时依赖，禁止 push。
```

期望流程：

1. Leader 读 `dev-leader-rules`，把验收标准编号成 AC1…ACn，跑写权限预检并判定 size；
2. 用 `dev-decompose` 拆成可独立验收的任务，`todo_write` 建一次任务清单；
3. 按 `dev-dispatch-contract` 填 10 字段卡片，派 `dev-developer`（显式传 `agent_preset`）；
4. Developer 交付后，Leader 先做 triage（文件、diff 范围、命令证据），**不把 triage 当验收**；
5. 再派 `dev-tester` 独立验收（独立副本 / 临时 worktree，自己跑命令并另写断言）；
6. Tester PASS 后交付：分支 + commit、每条 AC 的证据、未覆盖项与风险；
7. Leader 停下，等你说「继续 / 下一个」才推进下一任务。

如果需求含糊、验收标准缺失或需要生产凭据，Leader 应当先停下来问你，而不是猜。

### solo 模式（仅 size=S）

只有**同时**满足以下全部条件，且不属于安全 / 权限 / 支付 / 密钥 / 生产数据 / 数据迁移类，
才允许 Leader 自己动手（默认仍是 team）：

- 改动文件数 ≤ 2；
- diff 行数 ≤ 80；
- 无新增依赖；
- 不改公共 API / schema；
- 无数据迁移；
- 单条命令可判定验收。

solo 也必须：建 worktree + 分支、按仓库脚本跑 `typecheck` / `test` / `build`、逐条记录命令与退出码，
并在交付里声明「本次为 solo，无独立 Tester」+ 未覆盖项。实际 diff 一旦超出阈值，立即停手转 team。
判定不了就按 team 处理。

### 交付形态

派发卡片第 10 项必须写 `delivery_mode`：

| 形态 | 适用条件 | 交付物 |
|------|----------|--------|
| `commit`（默认） | 写权限预检为 `GIT_WRITE_OK`，能建 worktree / commit | 分支 + commit hash + 命令证据 |
| `workspace` | 预检为 `GIT_WRITE_BLOCKED`（如 linked worktree 的 `.git` 在 `workspaceRoot` 之外，`workspace-write` 沙箱拒绝写） | 当前工作区改动 + 基线 commit + `git diff` + 命令证据，明确「未提交 + 原因」 |

写权限预检、`GIT_WRITE_BLOCKED` 的两种恢复方式与「工作区交付」细则见
`dev-worktree-git`（安装后资产目录 `<assets>/skills/dev-worktree-git/SKILL.md`，真源
`templates/dev-worktree-git/SKILL.md`）。预检只在 Leader 启动 dsh 的
cwd 做一次；`GIT_WRITE_BLOCKED` 下不要反复重试或尝试提权。

### 验证纪律

- **triage ≠ 独立验收**：Leader 只读检查文件是否存在、diff 是否越界、证据是否齐全，不能作为交付依据；
- **编码任务必须跑三件套**：`typecheck` → `test` → `build`，按仓库实际脚本执行并记录退出码；
- **Tester 必须独立重跑**：`commit` 形态用临时 worktree，`workspace` 形态先
  `rsync -a --exclude node_modules --exclude .git <worktree>/ /tmp/verify-<task>-<ts>/`，
  只在副本内跑命令；至少写一条独立于 Developer 的断言；
- **原地验收无效**：在交付 worktree 里直接跑命令、报告里没有 `/tmp/verify-*` 副本路径，
  一律打回重验；
- 修完 FAIL 必须完整重跑，不只跑失败那条；测试被 `skip` / 放宽断言视为未通过。

## 开发

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest（56 个用例：契约 / 种子 / references / 校验 / 固件注册 / 真实 AgentHost 集成 / 安装后自检）
pnpm build         # 编译到 dist-server/ 并复制 cordis.patch.yml（内含 typecheck）
pnpm verify:install # 15 项安装后自检（DSH_HOME 已设置时校验安装态资产）
```

改种子请先改 `templates/<name>/`（含 `references/*.md`），再同步 `src/seeds.ts`——
测试会与 templates 逐字节比对，漂移会直接失败。

> `pnpm test` 带 `--passWithNoTests`：0 个用例也会退出 0。成功判据是 **56 passed**，不是只看退出码。

## 10 个领域 Skill（运行态 13 条）

运行时分三层，安装后 `skills.list()` 应为 **13 条**：

| 层 | 条数 | 来源 | 是否可进化 |
|----|------|------|------------|
| 可进化种子 | 7 | `assets.bootstrap` 落到 `<assets>/skills/` | 是 |
| 领域固件 | 3 | `src/plugin.ts` 调 `ctx.skills.register()` 静态注册 | 否 |
| core 固件 | 3 | core 自己注册：`rsi-evolution` / `skill-authorship` / `task-authorship` | 否 |

`skills.list()` 断言 13 条 = 7 + 3 + 3；少任何一层都说明安装或注册不完整。

| 类型 | 名称 | 作用 |
|------|------|------|
| 固件 | `dev-leader-rules` | Leader 只拆解 / 调度 / 验收 / 汇报 |
| 固件 | `dev-dispatch-contract` | 派发上下文卡片、preset、超时与返回格式 |
| 固件 | `dev-quality-gate` | 三维质量闸门与证据门槛 |
| 可进化 | `dev-decompose` | 需求拆解为可独立交付的任务 |
| 可进化 | `dev-ralph-loop` | 单任务执行循环（对齐 → 派发 → 自检 → 验证 → 交付） |
| 可进化 | `dev-worktree-git` | worktree / 分支 / commit 规范 |
| 可进化 | `dev-test-strategy` | 五栈检测与路由（具体命令在 `references/`） |
| 可进化 | `dev-role-developer` | Developer 角色规范 |
| 可进化 | `dev-role-tester` | Tester 角色规范 |
| 可进化 | `dev-retro` | 复盘与单变量改进 |

固件 Skill 随包发布：`pack.firmwareSkills` 是声明（契约校验 / 文档的真源），运行时由
`src/plugin.ts` 在 `agentHost.install()` 之后用 `ctx.skills.register()` **静态注册**
（core 只把 `firmwareSkills` 用于重名冲突校验，不注册其中的 markdown）；领域卸载时反注册。
7 个可进化 Skill 由 `assets.bootstrap` 落到 `assets/skills/`，之后可由进化引擎改写。
固件 Skill 不得占用 core 保留名（`rsi-evolution` / `skill-authorship` / `task-authorship`）。

## 五栈 references

`dev-test-strategy` 只做栈检测与路由，具体命令在安装后的
`assets/skills/dev-test-strategy/references/` 下（真源为 `templates/dev-test-strategy/references/`）：

| 文件 | 技术栈 | 检测信号 |
|------|--------|----------|
| `go.md` | Go | `go.mod` |
| `node-ts.md` | Node / TypeScript | `package.json` + `tsconfig.json`（无前端框架） |
| `react.md` | React | `react` 依赖 + `vite.config.*` / `next.config.*` |
| `harmony-arkts.md` | 鸿蒙 ArkTS | `build-profile.json5` / `oh-package.json5` |
| `python.md` | Python | `pyproject.toml` / `requirements.txt` |

每个文件统一包含：检测信号、环境准备、构建、静态检查、测试、最小样例、常见坑、失败判据。
references 随种子同批注册（同一个 commit）；`validate` 只放行 `skills/<dir>/references/<file>.md`
这一层，`..`、绝对路径、非 `.md` 与嵌套目录一律拒绝。

## 已知限制

- `dsh --profile <p> --dump-config-schema` 对含嵌套 `plugins` 的 preset 会在 stderr 报
  `unrecognized Loader tree carrier`（3 个 preset 各一条）并以退出码 1 结束；schema 本身
  仍会完整打印到 stdout。spike 同样表现，属 dsh 自身限制；`--dump-config` 正常（退出码 0），
  日常自检请用后者。
- 自检脚本里 `agentHost.active.toolNames` 仍为空数组（本领域零工具），文件 / 命令 /
  技能 / 待办 / 子 agent 能力全部来自 preset 组合的 dsh 内置插件。
- `await agentHost.skillProviderReady` 只表示 provider 已就绪，不保证 `skills.list()` 立刻
  包含全部种子：web profile 下首次 `list()` 可能只有固件条目（3 条），约 1s 后才有 13 条
  （`rsi-skills` 首轮扫描滞后）。断言请**轮询到条数稳定**（例如连续两次读到 13 条）再判定，
  不要只取首次结果。

## 3 个 preset

| preset | 用途 | 工具面 |
|--------|------|--------|
| `dev-leader` | 调度者（含 `subagent`，限深 1） | fs / bash / skill / todo / subagent |
| `dev-developer` | 编码执行者（写操作必须显式指定） | fs / bash / skill / todo |
| `dev-tester` | 验证执行者 | fs / bash / skill / todo |

档位语义：

- `agent-preset-registry.default: dev-tester` —— 子 agent 未显式指定时的兜底；
  选偏只读角色，是因为漏传 `agent_preset` 时不应落到可写角色。**写操作必须由 Leader
  显式传 `dev-developer`**，不要依赖默认值；
- `allowedAgentPresets: [dev-developer, dev-tester]`、`maxDepth: 1` —— Leader 只能派给
  Developer / Tester，子 agent 无法再向下派发（因此 `agent_preset` 枚举只有这两项，
  `dev-leader` 仍注册在 registry 里，但不作为可派发目标）；
- **关于子 preset 的 `subagent`**：Developer / Tester 的 preset 里**不额外挂载**
  `subagent`，但顶层补丁（`tool-subagent`）会让该工具在子 preset 的 scope 中可见；
  真正拦住递归的是 `maxDepth: 1`，而不是「工具不存在」。
- 每个 preset 的 `persona` 都是 `complete: true`，子 agent 的 system prompt 只保留自己的
  措辞，不含 Leader 的任何规则。

## License

Apache-2.0
