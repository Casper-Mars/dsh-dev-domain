# Node / TypeScript 技术栈参考

适用：有 `package.json`、但**没有**前端框架依赖（React/Vue/Svelte）的库、CLI、服务端项目。
前端项目请看 `react.md`。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| `package.json` | 必存在；先读 `scripts` 与 `packageManager` |
| `tsconfig.json` | 存在即 TypeScript 项目 |
| `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` | 决定包管理器 |
| `.nvmrc` / `.node-version` | Node 版本约束 |
| `vitest.config.*` / `jest.config.*` | 测试框架已定 |
| `src/**/*.ts` | 源码目录 |

包管理器判定（按锁文件，不按个人习惯）：

```bash
ls pnpm-lock.yaml package-lock.json yarn.lock 2>/dev/null
node -e "console.log(require('./package.json').packageManager)"
```

若有 `packageManager` 字段，必须用对应版本（corepack 会校验）。

## 2. 环境准备

```bash
node --version                  # 对照 .nvmrc / engines
cat .nvmrc 2>/dev/null
corepack enable                 # 需要时
pnpm install --frozen-lockfile  # 有 pnpm-lock.yaml
npm ci                          # 只有 package-lock.json
```

- `--frozen-lockfile` 保证锁文件不被改写，CI 与验证环境必须加；
- 需要重新解析依赖时才用 `pnpm install`（会改锁文件，单独 commit）；
- monorepo 用 `pnpm install` 在根目录执行，不要在各子包重复装。

## 3. 构建

**优先用仓库脚本**，不要猜：

```bash
node -e "console.log(Object.keys(require('./package.json').scripts))"
pnpm run build
```

无 `build` 脚本时的等价做法：

```bash
pnpm exec tsc -p tsconfig.json          # 类型 + 产物（看 tsconfig 的 outDir）
pnpm exec tsc --noEmit                  # 仅类型检查
```

典型产物：`dist/`、`dist-server/`、`lib/`（以 `tsconfig.outDir` 与 `package.json.files` 为准）。
产物目录必须在 `.gitignore` 中。

## 4. 静态检查

```bash
pnpm exec tsc --noEmit          # 无 typecheck 脚本时的类型检查
pnpm run typecheck              # 有脚本时优先
pnpm exec eslint .              # 有 eslint 配置时
pnpm exec prettier --check .    # 有 prettier 配置时
```

顺序：typecheck → lint。类型错修完再管风格，否则会反复改同一文件。

## 5. 测试

| 场景 | 命令 |
|------|------|
| 跑全部（脚本存在） | `pnpm test` |
| 跑全部（vitest 直接用） | `pnpm exec vitest run` |
| 监听模式（本地调试） | `pnpm exec vitest` |
| 单个文件 | `pnpm exec vitest run tests/pack.spec.ts` |
| 单个用例 | `pnpm exec vitest run -t "bootstrap 只调用一次 register"` |
| 覆盖率 | `pnpm exec vitest run --coverage` |
| jest 项目 | `pnpm exec jest --ci`、`pnpm exec jest path/to.spec.ts -t "name"` |

失败用例复跑要点：

- 加 `--no-file-parallelism` 排除并发干扰；
- 用 `-t` 精确到用例名，确认是稳定失败还是 flaky；
- 记录 `Tests X passed / Y failed` 汇总行作为证据。

## 6. 最小样例

`package.json`：

```json
{
  "name": "mini",
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`src/sum.ts` 与 `tests/sum.spec.ts`：

```ts
export function sum(a: number, b: number): number {
  return a + b
}
```

```ts
import { expect, it } from 'vitest'
import { sum } from '../src/sum'

it('sum 处理正数与负数', () => {
  expect(sum(1, 2)).toBe(3)
  expect(sum(-1, 1)).toBe(0)
})
```

验证：`pnpm exec tsc --noEmit && pnpm exec vitest run`。

## 7. 常见坑

1. **没区分 `tsc --noEmit` 与 `build`**：`noEmit` 不产出文件，`build` 可能因 `composite`/`references`
   报错；两者都要跑。
2. **ESM/CJS 混用**：`"type": "module"` 下 `require` 不可用；测试里 import 相对路径要带扩展名
   （视 `moduleResolution` 而定）。
3. **`pnpm test` 的 `--passWithNoTests`**：测试文件未被 include 时也会「绿」。新增用例后必须核对
   用例数是否真的增加。
4. **锁文件漂移**：`pnpm install` 不加 `--frozen-lockfile` 会改锁文件，混进 diff 后难 review。
5. **`tsconfig` 排除了测试目录**：`include` 只含 `src` 时，测试文件的类型错误不会被 typecheck 发现，
   需另跑 `vitest --typecheck` 或在测试 tsconfig 中覆盖。
6. **watch 模式挂住 CI**：脚本里出现裸 `vitest` / `jest` 会导致进程不退出，CI 必须用 `run` / `--ci`。

## 8. 失败判据

- `pnpm exec tsc --noEmit` 非 0 退出，或输出任何 `error TS`；
- 测试失败数 > 0，或用例总数较基线下降（说明被删/被跳过）；
- 出现 `skipped` 且无原因说明；
- 构建产物中包含源码未引用的旧文件（未 clean）；
- 锁文件在验证过程中被修改（环境不稳定）。
