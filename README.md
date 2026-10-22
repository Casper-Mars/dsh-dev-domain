# dsh-dev-domain

开发领域包（dsh）：为 [`dsh-rsi-agent`](../dsh-rsi-agent) 提供 **Dev Leader 人设**、**10 个 Skill**（3 个固件 + 7 个可进化种子）与 **3 个 agent preset**（Leader / Developer / Tester）。

## 设计边界

- **零工具**：`tools()` 返回空数组，`toolNames` 为空；文件 / 命令 / 技能 / 待办 / 子 agent 全部由 preset 组合 dsh 内置能力。
- **零状态文件**：领域不写业务数据，只在首次安装时通过 `assets.bootstrap` 注册 7 个可进化 Skill 种子。
- **单次提交**：bootstrap 只调用一次 `writer.register([...])`，7 个种子落在**同一个** commit 里。
- **子 agent 隔离**：3 个 preset 的 persona 均声明 `complete: true`，子 agent 不会继承 Leader 人设。

## 目录结构

```
.
├─ cordis.patch.yml          # bundle patch：rsi-agent + dev-domain + 3 preset + subagent 配置
├─ src/
│  ├─ index.ts               # 包入口
│  ├─ plugin.ts              # Cordis 插件（name / inject / apply）
│  ├─ pack.ts                # DomainPack：人设、资产类型与校验、固件 Skill、bootstrap
│  └─ seeds.ts               # 7 个可进化 Skill 的种子正文（与 templates 逐字节一致）
├─ skills/                   # 固件 Skill（随包发布、只读、不参与进化）
│  ├─ dev-leader-rules/
│  ├─ dev-dispatch-contract/
│  └─ dev-quality-gate/
├─ templates/                # 7 个可进化 Skill 的种子模板
│  ├─ dev-decompose/
│  ├─ dev-ralph-loop/
│  ├─ dev-worktree-git/
│  ├─ dev-test-strategy/     # 含 references/（按技术栈路由，待任务-03/04 补全）
│  ├─ dev-role-developer/
│  ├─ dev-role-tester/
│  └─ dev-retro/
├─ scripts/copy-assets.mjs
├─ tests/pack.spec.ts
└─ tsconfig*.json / vitest.config.ts / pnpm-workspace.yaml / .npmrc
```

## 安装（本地 link）

前置：dsh `0.2.1-rc.2`、Node ≥ 22、pnpm 11。

```bash
# 1. 在本仓库安装依赖（workspace override 会把 dsh-rsi-agent 链到 ../dsh-rsi-agent）
pnpm install

# 2. 装进一个已有 app 的 dsh profile（示例：web profile）
dsh plugin --profile web add /path/to/dsh-dev-domain

# 3. 启动
dsh web
```

如果是**全新 profile**，先装 app 再装本包，顺序不要反（后装的 bundle 补丁后应用，
`agent-preset-registry` 的 `default: dev-developer` 才会生效）：

```bash
DSH_HOME=/tmp/dsh-dev dsh plugin --profile dev add /path/to/dsh-web-app
DSH_HOME=/tmp/dsh-dev dsh plugin --profile dev add /path/to/dsh-dev-domain
DSH_HOME=/tmp/dsh-dev dsh --profile dev
```

安装后检查：

```bash
# 组合树里应出现 rsi-agent / dev-domain / 3 个 preset
dsh --profile web --dump-config | grep -E "dev-domain|preset-dev-"

# 资产目录应出现 7 个 Skill（默认会话 id = dev）
ls "$DSH_HOME/.dsh-rsi-agent/dev/assets/skills"

# 只应有一个种子提交（加上仓库初始化共 2 个）
git -C "$DSH_HOME/.dsh-rsi-agent/dev/assets" log --oneline
```

> 说明：本包 `dependencies` 里的 `dsh-rsi-agent` 目前是发布态版本号；本地未发布时，
> `pnpm install` 通过 `pnpm-workspace.yaml` 的 `overrides` 链到同级仓库。
> `link:` 安装不会为被链接包安装依赖，因此仍需先在本仓库执行 `pnpm install`。

## 开发

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest（契约 / 种子 / 校验 / 真实 AgentHost 集成）
pnpm build         # 编译到 dist-server/ 并复制 cordis.patch.yml
```

## 10 个 Skill

| 类型 | 名称 | 作用 |
|------|------|------|
| 固件 | `dev-leader-rules` | Leader 只拆解 / 调度 / 验收 / 汇报 |
| 固件 | `dev-dispatch-contract` | 派发上下文卡片、preset、超时与返回格式 |
| 固件 | `dev-quality-gate` | 三维质量闸门与证据门槛 |
| 可进化 | `dev-decompose` | 需求拆解为可独立交付的任务 |
| 可进化 | `dev-ralph-loop` | 单任务执行循环 |
| 可进化 | `dev-worktree-git` | worktree / 分支 / commit 规范 |
| 可进化 | `dev-test-strategy` | 五栈测试路由（Go / Node-TS / React / 鸿蒙 ArkTS / Python） |
| 可进化 | `dev-role-developer` | Developer 角色规范 |
| 可进化 | `dev-role-tester` | Tester 角色规范 |
| 可进化 | `dev-retro` | 复盘与单变量改进 |

## 3 个 preset

| preset | 用途 | 工具面 |
|--------|------|--------|
| `dev-leader` | 调度者（含 `subagent`，限深 1） | fs / bash / skill / todo / subagent |
| `dev-developer` | 编码执行者（`subagent` 默认目标） | fs / bash / skill / todo |
| `dev-tester` | 验证执行者 | fs / bash / skill / todo |

`allowedAgentPresets: [dev-developer, dev-tester]`，`maxDepth: 1`：子 agent 不能再向下派发。

## License

Apache-2.0
