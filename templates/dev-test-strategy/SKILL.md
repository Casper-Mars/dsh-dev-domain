---
name: dev-test-strategy
description: 按技术栈路由的测试策略：先定最小验证命令，再按测试金字塔补用例；覆盖 Go、Node/TS、React、鸿蒙 ArkTS、Python 五栈。
whenToUse: 需要为一次改动确定测试范围、选择测试命令或判断"测够了没有"时使用。
---

# 测试策略（按栈路由）

## 第一步：确定技术栈

读项目根目录的清单文件，只选**一个**主栈，再打开对应参考：

| 判据 | 技术栈 | 参考 |
|------|--------|------|
| `go.mod` | Go | `references/go.md` |
| `package.json` + 无前端框架 | Node / TypeScript | `references/node-ts.md` |
| `package.json` + `react` 依赖 | React | `references/react.md` |
| `oh-package.json5` / `build-profile.json5` | 鸿蒙 ArkTS | `references/harmony-arkts.md` |
| `pyproject.toml` / `requirements.txt` | Python | `references/python.md` |

多栈仓库按改动落点选择，不要求全栈都跑。

## 第二步：最小验证优先

先找出仓库已有的、最快的验证命令（typecheck / lint / 单测），
再决定是否补集成测试。禁止在没跑通最小验证前就写新用例。

## 第三步：按金字塔补用例

- **单元**：纯函数、边界、错误分支；
- **集成**：跨模块契约、真实依赖的最小组合；
- **端到端**：只覆盖关键用户路径，不追求数量。

## 判据

- 新增行为至少有一个正例 + 一个失败/边界例；
- 修 bug 必须先有能复现的用例；
- 测试必须可重复、无外部随机依赖；
- 跑不过的测试不允许注释掉或跳过，必须修或明确记录原因。
