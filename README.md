# dsh-dev-domain

开发领域包（dsh）：为 [`dsh-rsi-agent`](../dsh-rsi-agent) 提供 **Dev Leader 人设**、**10 个 Skill**
（3 个固件 + 7 个可进化种子）与 **3 个 agent preset**（Leader / Developer / Tester）。

## 设计边界

- **零工具**：`tools()` 返回空数组，`toolNames` 为空；文件 / 命令 / 技能 / 待办 / 子 agent 全部由 preset 组合 dsh 内置能力。
- **零状态文件**：领域不写业务数据，只在首次安装时通过 `assets.bootstrap` 注册 7 个可进化 Skill 种子。
- **单次提交**：bootstrap 只调用一次 `writer.register([...])`，7 个种子落在**同一个** commit 里。
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
│  └─ seeds.ts               # 7 个可进化 Skill 的种子正文（与 templates 逐字节一致）
├─ skills/                   # 固件 Skill（随包发布、只读、不参与进化）
│  ├─ dev-leader-rules/
│  ├─ dev-dispatch-contract/
│  └─ dev-quality-gate/
├─ templates/                # 7 个可进化 Skill 的种子模板（种子正文的真源）
│  ├─ dev-decompose/
│  ├─ dev-ralph-loop/
│  ├─ dev-worktree-git/
│  ├─ dev-test-strategy/     # 含 references/（按技术栈路由，待任务-03/04 补全）
│  ├─ dev-role-developer/
│  ├─ dev-role-tester/
│  └─ dev-retro/
├─ scripts/copy-assets.mjs   # 把 cordis.patch.yml 等资源复制进 dist-server/
├─ tests/pack.spec.ts        # 契约 / bootstrap / 校验 / 真实 AgentHost 集成
├─ tests/firmware-registration.spec.ts  # 固件 Skill 注册 / 查重 / 卸载反注册 / 降级
├─ tsconfig.json / tsconfig.server.json / vitest.config.ts
├─ pnpm-workspace.yaml       # overrides: dsh-rsi-agent → link:../dsh-rsi-agent
└─ .npmrc
```

## 安装

前置：dsh `0.2.1-rc.2`、Node ≥ 22、pnpm 11。

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

# 资产目录应出现 7 个 Skill（默认会话 id = dev）
ls "$DSH_HOME/.dsh-rsi-agent/dev/assets/skills"

# 只应有一个种子提交（加上仓库初始化共 2 个）
git -C "$DSH_HOME/.dsh-rsi-agent/dev/assets" log --oneline
```

预期：`agentHost.active.id === 'dev'`、`agentHost.active.toolNames === []`；`skills.list()` 含
3 个固件 Skill（`dev-leader-rules` / `dev-dispatch-contract` / `dev-quality-gate`）与 7 个种子
（共 10 个领域 Skill，另加 core 自带的 3 个固件 Skill）；3 个 preset 均无 `broken` 诊断；
`agent_preset` 枚举为 `dev-developer` / `dev-tester`；子 agent 的 system prompt 只含自己的角色措辞。

## 开发

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest（41 个用例：契约 / 种子 / 校验 / 固件注册 / 真实 AgentHost 集成）
pnpm build         # 编译到 dist-server/ 并复制 cordis.patch.yml
```

改种子请先改 `templates/<name>/SKILL.md`，再同步 `src/seeds.ts`——测试会逐字节比对两者。

## 10 个 Skill

| 类型 | 名称 | 作用 |
|------|------|------|
| 固件 | `dev-leader-rules` | Leader 只拆解 / 调度 / 验收 / 汇报 |
| 固件 | `dev-dispatch-contract` | 派发上下文卡片、preset、超时与返回格式 |
| 固件 | `dev-quality-gate` | 三维质量闸门与证据门槛 |
| 可进化 | `dev-decompose` | 需求拆解为可独立交付的任务 |
| 可进化 | `dev-ralph-loop` | 单任务执行循环（对齐 → 派发 → 自检 → 验证 → 交付） |
| 可进化 | `dev-worktree-git` | worktree / 分支 / commit 规范 |
| 可进化 | `dev-test-strategy` | 五栈测试路由（Go / Node-TS / React / 鸿蒙 ArkTS / Python） |
| 可进化 | `dev-role-developer` | Developer 角色规范 |
| 可进化 | `dev-role-tester` | Tester 角色规范 |
| 可进化 | `dev-retro` | 复盘与单变量改进 |

固件 Skill 随包发布：`pack.firmwareSkills` 是声明（契约校验 / 文档的真源），运行时由
`src/plugin.ts` 在 `agentHost.install()` 之后用 `ctx.skills.register()` **静态注册**
（core 只把 `firmwareSkills` 用于重名冲突校验，不注册其中的 markdown）；领域卸载时反注册。
7 个可进化 Skill 由 `assets.bootstrap` 落到 `assets/skills/`，之后可由进化引擎改写。

## 已知限制

- `dsh --profile <p> --dump-config-schema` 对含嵌套 `plugins` 的 preset 会在 stderr 报
  `unrecognized Loader tree carrier`（3 个 preset 各一条）并以退出码 1 结束；schema 本身
  仍会完整打印到 stdout。spike 同样表现，属 dsh 自身限制；`--dump-config` 正常（退出码 0），
  日常自检请用后者。
- 自检脚本里 `agentHost.active.toolNames` 仍为空数组（本领域零工具），文件 / 命令 /
  技能 / 待办 / 子 agent 能力全部来自 preset 组合的 dsh 内置插件。
- `await agentHost.skillProviderReady` 只表示 provider 已就绪，不保证 `skills.list()` 立刻
  包含全部种子：web profile 下首次 `list()` 可能只有固件条目（3 条），约 1s 后才有 13 条
  （`rsi-skills` 首轮扫描滞后）。自动化自检请轮询到条数稳定再断言，不要只取首次结果。

## 3 个 preset

| preset | 用途 | 工具面 |
|--------|------|--------|
| `dev-leader` | 调度者（含 `subagent`，限深 1） | fs / bash / skill / todo / subagent |
| `dev-developer` | 编码执行者（`subagent` 默认目标） | fs / bash / skill / todo |
| `dev-tester` | 验证执行者 | fs / bash / skill / todo |

档位语义：

- `agent-preset-registry.default: dev-developer` —— 子 agent 未显式指定时的兜底；
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
