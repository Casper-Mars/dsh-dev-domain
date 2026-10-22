---
name: dev-quality-gate
description: 交付质量门：triage 与独立验收的分工、按仓库脚本跑三件套、Tester 独立重跑、报告模板与 blocker/major/minor 判定。
whenToUse: 收到子 agent 产物或 Tester 报告、准备 commit、准备把任务标为完成时使用。
---

# 质量闸门（固件）

本 Skill 是固件：随 `dsh-dev-domain` 发布，只读，不参与进化。

## 触发条件

- 收到子 agent 的完成回报，需要判断产物能不能进下一步；
- 收到 Tester 的验收报告，需要判定 PASS / FAIL 与严重度；
- 准备 `git commit`、`git push` 或对用户宣布交付；
- 准备把 `memory/task-status.md` 里的任务改成 ✅；
- 修复完成后准备重跑（必须走完整门，不是只跑失败那条）。

## 步骤

### 1. 先分清 triage 和独立验收

| 项目 | triage（Leader 做） | 独立验收（Tester 做） |
|------|--------------------|------------------------|
| 目的 | 判断产物是否「齐全、能进验收」 | 判断产物是否「满足 AC、能交付」 |
| 执行者 | Leader，只读操作 | `dev-tester`，独立环境 |
| 做什么 | 文件是否存在、diff 是否越界、格式与四节标题、有无明显矛盾、命令是否跑过 | 换环境重跑、另写断言、逐条 AC 判定、边界与失败路径 |
| 环境 | 复用当前 worktree | 临时 worktree / 全新 `DSH_HOME` |
| 产出 | 进 / 不进验收 | PASS / FAIL + 证据 + 严重度 |
| 能否作为交付依据 | **不能** | **能** |
| 典型误判 | 「tsc 过了就算验收通过」 | 只跑对方脚本、不写独立断言 |

结论口径：**triage 通过 ≠ 验收通过**。编码任务 triage 通过后必须派 Tester。

### 2. triage 六查（Leader，只读）

1. 回报里的文件是否都存在：逐个 `ls`，不靠子 agent 自述。
2. `git status --short`：有无未预期的新文件、临时文件、`.orig` / `.rej`。
3. `git diff --stat`：文件数与行数是否超出卡片允许范围。
4. 格式：产物类型是否正确？frontmatter、缩进、约定的小节标题是否符合规范。
5. 逻辑：同一文档前后是否矛盾，引用路径是否存在。
6. 命令：回报里的命令与退出码是否齐全；缺一项就退回补证据。

### 3. 跑必修命令（按仓库实际脚本，禁止猜）

先读仓库里已有的定义，再决定跑什么：

```bash
cat package.json | sed -n '/"scripts"/,/}/p'                  # Node / TS
cat Makefile go.mod pyproject.toml setup.cfg 2>/dev/null      # 通用 / Go / Python
ls build-profile.json5 oh-package.json5 2>/dev/null            # 鸿蒙
```

通用三件套，顺序固定：`typecheck` → `test` → `build`。

| 栈 | typecheck | test | build |
|----|-----------|------|-------|
| node-ts | `pnpm typecheck`（通常 `tsc --noEmit`） | `pnpm test` | `pnpm build` |
| react | `pnpm typecheck` | `pnpm test -- --run` | `pnpm build` |
| go | `go vet ./...` | `go test ./...` | `go build ./...` |
| python | `mypy .` / `ruff check .`（有配置才跑） | `pytest -q` | `python -m build` |
| arkts | 读 `build-profile.json5` 确认任务名，用 `hvigorw` 对应任务 | 同左 | 同左 |

规则：

- 以上是**候选**，最终以仓库实际脚本为准；仓库没有某类脚本时写「仓库无 typecheck 脚本」，**不许自造命令凑数**。
- 有 `lint` / `format:check` 也跑；缺项同样要写明。
- 每条命令记录完整命令、退出码、关键输出（失败贴最后 20 行）；命令通过≠验收通过，还要逐条对 AC。

命令记录格式（交付时原样贴）：

```text
$ pnpm typecheck → exit 0
$ pnpm test → exit 0（41 passed）
$ pnpm build → exit 0
```

### 4. Tester 独立重跑（不可省）

派 `dev-tester` 时，卡片第 7 项必须写清：

- 在临时 worktree 里验收：`git worktree add /tmp/verify-<task> <commit>`，验收完 `git worktree remove`；
- 或使用全新 `DSH_HOME`（`export DSH_HOME=$(mktemp -d)`），不复用被测方的运行状态与缓存；
- 自己写断言 / 用例，至少一条独立于 Developer 的测试；可以跑对方的测试，但那不算唯一证据；
- 记录环境：OS、Node / pnpm / 语言版本，写进报告头部；
- 对「声称通过」零信任：所有结论必须自己跑出来。

### 5. 逐条判定 + 分级

对每条 AC 写 PASS / FAIL，并附证据。然后按下表定级：

| 级别 | 判定标准（满足任一） | 处理 |
|------|----------------------|------|
| `blocker` | 数据损坏或丢失；安全 / 权限漏洞、密钥泄漏；核心功能不可用；装不上、起不来、构建产物缺失 | 立即停止，不 commit，直接上报用户等决策 |
| `major` | 任一 AC FAIL；行为与契约 / 文档不符；关键路径无测试；引入范围外改动；退出码与结论矛盾 | 打回 `dev-developer` 重修，修后完整重跑全流程 |
| `minor` | 文案 / 格式 / 命名；非关键路径瑕疵；已知限制未记录；可延后的重构 | Leader 可自行修（仅限文档、注释、格式），或登记为遗留，不阻塞交付 |

- 分级只看影响，不看修起来难不难；一个 `major` 未清零就不能交付，`minor` 必须列入交付声明。
- 同一问题第二次出现（修完又犯）按 `major` 处理，并要求在报告里写根因。

### 6. 打回条件（命中任一即打回）

- 任一 AC 无证据或无法复现；`typecheck` / `test` / `build` 任一非 0 且未解释；
- 引入任务范围外的改动（格式化全仓库、升级依赖、改无关模块）；
- 子 agent 报告与 `git diff` 事实不符；
- Tester 判 `blocker` / `major`；

### 7. 报告模板（Tester 交付、Leader 转述都用这个）

```markdown
🧪 验收报告 — 任务-03
环境：macOS 15 / Node v22.20.0 / pnpm 11.7.0 / commit 45a1443
验收方式：临时 worktree /tmp/verify-task-03 + 独立断言 2 条
**逐条验收**
- AC1 三个文件含四节标题 — PASS — `rg -c '^## (触发条件|步骤|禁止项|检查清单)'` → 3/3/3
- AC2 `pnpm typecheck` exit 0 — PASS — 见下
- AC3 `pnpm test` 41 条不回退 — FAIL — 39 passed / 2 failed（tests/pack.spec.ts:280）
**命令与退出码**
1. `pnpm typecheck` → exit 0
2. `pnpm test` → exit 1（2 failed）
3. `pnpm build` → 未执行（前置失败）
**未覆盖项**
- 未在 dsh 真实 profile 下验证 install 流程（无 DSH_HOME 权限）
**残余缺陷**
- blocker 0 / major 1（AC3）/ minor 1（错误提示文案）
**结论**
不通过 — major: AC3。打回 Developer，修后重跑 typecheck/test/build。
```

### 8. 交付声明格式（对用户）

```text
任务-03 已交付（或：未交付，原因）
- 分支 / commit：feat/task-03-firmware-skills @ a1b2c3d
- 命令与退出码：pnpm typecheck → 0；pnpm test → 0（41 passed）；pnpm build → 0
- 逐条验收：AC1 PASS / AC2 PASS / AC3 PASS
- 未覆盖项：xxx（没有就写「无」）
- 风险：xxx（没有就写「无」）
```

禁止用「应该没问题」「基本可用」代替证据；没跑的命令写「未执行」并说明原因。

## 禁止项

- 禁止把 triage 当验收，禁止编码任务跳过 Tester 直接 commit。
- 禁止只用 `tsc --noEmit` 通过就宣布功能正确。
- 禁止编造仓库里不存在的脚本名或命令。
- 禁止只跑失败的那条就宣布修复完成；修复后必须重跑 `typecheck` → `test` → `build`。
- 禁止 Tester 修改业务代码、放宽断言、替 Developer 修 bug。
- 禁止复用被测方的脚本作为唯一证据，禁止在被测方的工作区里「原地验收」。
- 禁止隐瞒失败、截断错误输出、只贴成功片段；禁止把 `major` 降级成 `minor` 放行。
- 禁止在 `blocker` 存在时 commit 或 push；禁止改固件 Skill / 测试断言让门禁变绿。

## 检查清单

### 自检（Leader，triage）

- [ ] 回报里声称的文件全部存在（逐个 `ls`）
- [ ] `git status --short` 无临时文件 / 意外新增
- [ ] `git diff --stat` 在卡片允许范围内
- [ ] 每条 AC 都能在产物里找到对应位置
- [ ] 回报含命令 + 退出码，且与结论不矛盾
- [ ] 已决定：进 Tester / 打回 / 升级

### 验收（Tester 报告核对）

- [ ] 报告头部有环境信息与 commit
- [ ] 验收在独立 worktree 或全新 `DSH_HOME` 中完成
- [ ] 至少一条独立断言，未完全复用被测方脚本
- [ ] 每条 AC 有 PASS / FAIL 与证据，无「部分通过」
- [ ] `typecheck` / `test` / `build` 三件套齐全，缺项已说明
- [ ] 缺陷已按 blocker / major / minor 定级并给出处理结论

### 交付

- [ ] 全部门禁为 0：无 blocker、无未清零 major
- [ ] 交付声明含分支 + commit + 命令退出码 + 逐条 AC
- [ ] 未覆盖项与残余风险已逐条列出（没有就写「无」）
- [ ] `minor` 已修复或登记为遗留
- [ ] 任务状态已更新，并写明等用户确认后再推进
