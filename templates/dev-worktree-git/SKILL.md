---
name: dev-worktree-git
description: Git worktree 与分支/提交规范：隔离开发、命名约定、commit 格式、禁止 push 与清理流程。
whenToUse: 开始编码前创建 worktree、提交代码或清理环境时使用。
---

# Worktree 与 Git 规范

## 创建 worktree

```bash
cd <项目根目录>
git worktree add -b <type>/<任务编号>-<描述> \
  <项目根目录>/../worktrees/<项目名>-<type>-<任务编号>-<描述>
```

- `-b` 同时创建分支并关联新 worktree，无需先 checkout。
- 每个任务一个 worktree，互不干扰；不复用他人的工作目录。

## 分支命名

`feat/<任务编号>-<短描述>`、`fix/...`、`chore/...`、`docs/...`；
短描述用小写 kebab-case，能一眼看出改动主题。

## Commit 格式

```
<type>: <一句话说明>

<可选：为什么这么改、影响范围、验证方式>
```

- 一个 commit 只做一件事；不夹带格式化、重命名等无关改动。
- 提交前确认 `git status` 中没有 `node_modules` / 构建产物 / 临时文件。
- 不提交密钥、个人路径、日志。

## 交付边界

- 除非任务明确要求，**不 push**、不创建 PR、不改其他仓库。
- 交付时给出分支名 + commit hash，便于 Leader 复核。

## 清理

- 任务合并或放弃后：`git worktree remove <路径>`，再删本地分支。
- 启动过中间件：`docker compose -p <worktree目录名> down -v`。
