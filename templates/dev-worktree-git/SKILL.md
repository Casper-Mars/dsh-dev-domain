---
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

dsh 默认 `workspace-write` 沙箱只允许写当前工作目录。linked worktree 的 git 元数据在主仓库
`.git/`，经常在工作目录之外；不预检就直接 `git worktree add` / `git switch -c` / `git commit`
会得到 `Operation not permitted`，且 headless 模式没有审批通道，无法升级权限。

```bash
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
```

| 结果 | 处理 |
|------|------|
| `GIT_WRITE_OK` | 按下面的规范建 worktree / 提交 |
| `GIT_WRITE_BLOCKED` | 不要反复重试，也不要尝试提权。二选一：<br>A. 让 Leader 以**包含主仓库与 worktree 的父目录**作为 dsh 的 cwd 重新启动（推荐，`workspaceRoot` 随 cwd 扩大）；<br>B. 受信任仓库下用 `DSH_PERMISSION_MODE=danger-full-access` 启动 dsh，并在交付里声明该风险。 |
| 两者都不可行 | 切换「工作区交付」：不建 worktree、不 commit，交付 `git status --short` + `git diff` + 建议 commit message；Tester 按 `dev-role-tester` 的「工作区交付」路径验收。 |

> 禁止在 `GIT_WRITE_BLOCKED` 下假装已建分支/已提交；也禁止把 `git switch -c` 失败后的重试当成进展。
> 预检只做一次，结果写进任务卡第 5 项与第 10 项。

## 一、创建 worktree（仅 `GIT_WRITE_OK` 时）

```bash
cd <项目根目录>
git worktree add -b <type>/<任务号>-<描述> \
  <项目根目录>/../worktrees/<项目名>-<type>-<任务号>-<描述>
```

要点：

- `-b` 一次完成「建分支 + 关联新 worktree」，不需要先 `checkout`；
- 起点必须是明确的 ref：`git worktree add -b <branch> <path> <base-ref>`，
  默认从当前 HEAD 拉，容易带上别人未合并的改动；
- 创建后立刻执行 `git -C <path> status` 与 `git -C <path> log --oneline -1`，
  确认分支与基点正确再开工。

## 二、分支命名

格式：`<type>/<任务号>-<短描述>`，短描述用小写 kebab-case，2~5 个词。

| type | 用途 |
|------|------|
| `feat` | 新功能、新资产、新能力 |
| `fix` | 修 bug、修回归 |
| `docs` | 仅文档 |
| `refactor` | 不改外部行为的重构 |
| `chore` | 依赖、构建、配置、脚本 |
| `test` | 仅测试 |

示例：

```
feat/task-04-evolvable-skills
fix/task-03-firmware-register-race
docs/readme-install-steps
chore/bump-vitest-3-2
```

禁止：`dev`、`test`、`tmp`、`my-branch`、中文分支名、带空格、带大写。

## 三、worktree 路径约定

```
<项目根目录>/../worktrees/<项目名>-<type>-<任务号>-<描述>
```

- 所有 worktree 平铺在 `worktrees/` 下，不放嵌套目录；
- 目录名 = 项目名 + 分支名（`/` 换成 `-`），一眼能从目录反推分支；
- 不共用目录：同一个 worktree 同时只服务一个任务，不借给他人跑验证；
- 依赖装在 worktree 内（`pnpm install` / `go mod download`），不依赖全局环境。

## 四、Conventional Commits

格式：

```
<type>(<scope>): <一句话说明>

<可选正文：为什么改、影响范围、验证方式>
```

- 标题 ≤ 72 字符，祈使句，结尾不加句号；
- `scope` 用模块名（`pack`、`seeds`、`tests`、`readme`），可省略；
- 正文写「为什么」，不写「改了什么」——改了什么看 diff；
- 破坏性变更用 `!`（`feat(pack)!: ...`）并在正文写迁移方式。

示例：

```
feat(task-04): 扩写 7 个可进化 Skill 与五栈 references

- templates/ 为真源，seeds.ts 同步生成，测试逐字节比对
- bootstrap 改为一次 register 注册 12 个资产（7 SKILL + 5 ref）
- 验证：pnpm typecheck / pnpm test / pnpm build 均 exit 0
```

```
fix(task-03): 固件 Skill 在 provider 就绪前不可见

原因：ctx.skills.register 在 install 之后异步执行……
验证：pnpm test tests/firmware-registration.spec.ts（14 passed）
```

## 五、何时拆分 commit

拆：

- 内容改动与「让内容生效的机制改动」分开（例：先提 templates/seeds，再提 pack/bootstrap）；
- 格式化/重命名与逻辑改动分开；
- 修 bug 的「复现测试」与「修复」可以同 commit，但要在正文说明测试先红后绿；
- diff 超过 400 行且明显分成两个主题。

不拆：

- 拆开后单独一个 commit 无法通过 `pnpm typecheck` / `pnpm test`（破坏可 bisect 性）；
- 纯粹为了凑数量把同一个逻辑切碎。

## 六、提交前检查

```bash
git status --short           # 只应有预期文件
git diff --stat              # 确认没有产物、锁文件意外变更
git diff --cached            # 逐行看将要提交的内容
```

- 不提交：`node_modules/`、`dist/`、`dist-server/`、`.env`、日志、编辑器临时文件；
- 不提交密钥、token、个人绝对路径；
- 提交信息用中文正文可以，但 `type(scope)` 前缀必须是英文小写。

## 七、清理

任务合并或放弃后，按顺序执行：

```bash
git -C <项目根目录> worktree remove <worktree 路径>   # 目录干净时
git -C <项目根目录> worktree remove --force <路径>    # 仅确认改动已丢弃时
git -C <项目根目录> worktree prune                    # 清理已失效的元数据
git -C <项目根目录> branch -d <branch>                # 已合并用 -d
```

- 启动过中间件：`docker compose -p <worktree目录名> down -v`；
- 删除分支用 `-d`，`-D` 只在确认提交已备份时使用；
- 定期 `git worktree list` 检查是否有遗留目录。

## 禁止项

- **禁止 `git push --force` / `--force-with-lease`**（除非用户明确要求且已确认目标分支无人使用）；
- 禁止 rebase 已推送的公共分支；
- 禁止 `git add .` 盲加（先看 `git status`，按路径添加）；
- 禁止在主干分支上直接提交；
- 禁止把多个任务的改动塞进一个 worktree；
- 禁止用 `git checkout -- .` 丢弃自己没看懂的改动（先 `git stash` 或 `git diff` 存档）。

## 检查清单

- [ ] 开工前已跑写权限预检，结果（`GIT_WRITE_OK` / `GIT_WRITE_BLOCKED`）与所选交付形态已记录；
- [ ] worktree 路径符合 `<项目名>-<type>-<任务号>-<描述>`；
- [ ] 分支名符合 `<type>/<任务号>-<描述>`，type 在允许列表内；
- [ ] 起点 ref 明确，`git log -1` 已确认；
- [ ] commit 标题符合 `type(scope): 说明`，正文写了为什么与验证方式；
- [ ] `git diff --stat` 无产物 / 锁文件意外变更；
- [ ] 未提交密钥与个人路径；
- [ ] 交付信息含分支名 + commit hash；
- [ ] 任务结束已 `worktree remove` + `prune`，中间件已 `down -v`。
