---
name: dev-role-tester
description: Tester 子 agent 的执行细则：按栈命令、验收证据格式、边界覆盖、缺陷分级与禁止项。
whenToUse: 需要查 Tester 的按栈命令、验收证据格式、缺陷分级与禁止项时使用。
---

# Tester 角色细则

执行流程由 `dev-tester` preset 的 persona 承载（对齐 → 拉取交付物 → 独立环境 → 逐项验证 → 报告）。
本文件只提供**命令、证据格式与判据**，不重复流程。流程与细则冲突时，以 persona 为准。

## 触发条件

- 以 Tester 身份接到验证任务，附分支 / commit / 验收标准；
- 需要判定某个交付物是否满足 AC，或复核上一轮 fail 的修复结果。

## 角色边界

- 做：拉起独立环境、按 AC 逐条验证、给出可复现证据、分级缺陷；
- 不做：改业务代码、改验收标准、重新设计需求、替 Leader 决定是否交付；
- 开发者说「已测试」不构成证据，必须自己复跑。

## ref 路由（硬要求）

1. `read` `dev-test-strategy`，按检测表判断技术栈；
2. 打开对应的 `references/<stack>.md`，复跑命令与断言**从 ref 复制**；
3. 第一条回报输出：`STACK=<栈> REF=<references/xxx.md> DETECT=<命中的检测信号>`。

报告里看不到 `STACK=… REF=… DETECT=…`，或看不到从 ref 复制的命令 = 结论无效，直接打回。
运行时没有 `skill` 工具时，改为 `read` 资产目录的 `SKILL.md`，并在回报首行声明 `SKILL_TOOL=absent`。

## 交付形态与验收位置

| 形态 | 识别信号 | 验收位置 |
|------|----------|----------|
| `commit`（默认） | 卡片给了 branch + commit，`git status --short` 为空 | `git worktree add --detach /tmp/verify-<task>-<ts> <commit>` |
| `workspace` | 卡片写明「未提交，工作区交付」 | `rsync -a --exclude node_modules --exclude .git <worktree>/ /tmp/verify-<task>-<ts>/`，只在副本内跑命令 |

`workspace` 形态的报告必须给齐三样：副本绝对路径、`git diff` 原文（或 `git status --short` + 文件清单）、
副本内的命令与退出码。原地验收（在交付 worktree 直接跑命令）= 验收无效。

## 按栈命令

### Node / TypeScript

```bash
node --version && pnpm --version
pnpm install --frozen-lockfile
pnpm run typecheck                  # 无脚本时 pnpm exec tsc --noEmit
pnpm test                           # 核对用例数不回退
pnpm run build
curl -s -o /dev/null -w '%{http_code}' localhost:<port>/health
git -C <worktree> diff <base>..<commit> | rg -n "\.skip|\.only|xit\(|@pytest.mark.skip"
```

### Go

```bash
go mod download
gofmt -l . && go vet ./...
go test ./... -race
go build ./...
```

### Python

```bash
uv sync
uv run ruff check . && uv run mypy .
uv run pytest -q
```

### 鸿蒙 ArkTS

```bash
ohpm install
./hvigorw clean && ./hvigorw assembleHap --mode module -p product=default
```

## 浏览器场景（UI / 交互）

- 按「打开 → 操作 → 断言」三步走，每步留证据（快照或截图路径）；
- 断言可见文本 / 元素状态，不断言 CSS 细节；
- 至少覆盖一条异常路径（空输入、无权限、接口 500），确认有用户可见提示；
- 需要登录态时记录账号来源，不把凭据写进报告。

## 证据格式

```text
结论：通过 / 部分通过 / 不通过
被验对象：<branch> @ <commit>（base <base>）
环境：<OS / 运行时版本 / 安装命令>

逐条验收
1. <标准原文> → pass | fail
   命令：<命令>
   证据：exit 0；输出 "Tests 41 passed"
```

至少一条独立断言（不直接复用 Developer 的验证脚本），并标明出自哪个 `references/<stack>.md`。
只写 exit 0 不写命令来源 = 结论无效。

## 自检维度

| 维度 | 检查项 | 不通过的样子 |
|------|--------|--------------|
| 证据 | 每条 AC 都有命令 + 退出码 + 关键输出 | 只写「已通过」或只贴截图 |
| 独立 | 至少一条断言不复用 Developer 的脚本 | 直接跑 Developer 留下的脚本就下结论 |
| 完整 | 边界 / 异常路径已覆盖，测试未被 skip / 放宽 | 只验正向路径，用例数比基线少 |

## 缺陷分级

| 分级 | 判据 |
|------|------|
| 阻塞 | 验收标准直接不满足，或数据 / 安全受损 |
| 严重 | 主路径可用但关键边界失败 |
| 一般 | 非关键路径错误、提示文案问题 |
| 建议 | 不影响验收的改进点 |

## 质量红线

- 结论必须有独立证据，不接受「开发者已测」作为通过依据；
- 任何一条 AC 未验证就是「未覆盖」，不得写成 pass；
- 发现测试被削弱、用例数回退，直接判 fail 并单列缺陷；
- 不改业务代码、不改验收标准来让结果变绿。

## 禁止项

- 禁止修改业务代码（一次性验证脚本可以，但不进交付分支）；
- 禁止用「看起来没问题」代替命令输出；
- 禁止因为开发者说「已测试」就跳过复跑；
- 禁止把新需求混进验证结论（发现新需求单独提给 Leader）；
- 禁止只验正向路径就判通过；
- 禁止在报告里省略失败的原始错误输出。

## 检查清单

- [ ] 已读本文件与 `dev-test-strategy`，回报含 `STACK=… REF=… DETECT=…`；
- [ ] 被验对象含分支 + commit + base，工作区干净（`workspace` 形态改为副本路径 + diff 指纹）；
- [ ] 环境独立复现，版本与安装命令已记录；
- [ ] AC 逐条有 pass/fail 与命令证据，含至少一条独立断言；
- [ ] 边界与失败路径已覆盖，浏览器场景含异常路径；
- [ ] 已检查测试未被 skip / 放宽、用例数未减少；
- [ ] 结论 + 缺陷分级 + 未覆盖项 + 残余风险齐全。
