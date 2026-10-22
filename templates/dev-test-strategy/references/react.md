# React 技术栈参考

适用：`package.json` 里有 `react` 依赖，且有 `vite.config.*` / `next.config.*` /
`react-scripts`（CRA）之一。仅 SSR 后端或纯组件库也按本文件处理。

## 1. 检测信号

| 信号 | 说明 | 结论 |
|------|------|------|
| `react` + `vite.config.ts` | Vite SPA | `pnpm build` → `dist/` |
| `react` + `next.config.*` | Next.js | `pnpm build` → `.next/` |
| `react` + `react-scripts` | CRA（旧） | `pnpm build` → `build/` |
| `react-dom` + `@testing-library/react` | 组件测试已配 | 用 RTL 写断言 |
| `playwright.config.*` / `cypress.config.*` | e2e 已配 | 跑真实浏览器 |
| `vite.config.*` 里的 `test` 段 | Vitest 复用 vite 配置 | 直接 `vitest run` |

```bash
node -e "const p=require('./package.json');console.log(p.scripts);console.log(Object.keys({...p.dependencies,...p.devDependencies}).filter(k=>/react|vite|next|playwright|cypress|vitest|jest/.test(k)))"
```

## 2. 环境准备

```bash
node --version                  # 对照 .nvmrc / engines
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # 仅当需要 e2e
```

- e2e 依赖浏览器二进制，首次安装较慢；CI 里用 `--with-deps`（Linux）；
- Next.js 需要 `.env.local` 时，从 `.env.example` 复制，**不要**提交 `.env.local`。

## 3. 构建

```bash
pnpm build                      # 以 package.json scripts 为准
```

框架差异：

| 框架 | 命令 | 产物 | 说明 |
|------|------|------|------|
| Vite SPA | `pnpm build`（= `vite build`） | `dist/` | 需 `vite preview` 才能验证产物 |
| Next.js | `pnpm build`（= `next build`） | `.next/` | 构建期会做 SSG/类型检查 |
| CRA | `pnpm build`（= `react-scripts build`） | `build/` | 已废弃，仅维护 |

产物验证（可选但推荐）：`pnpm exec vite preview --port 4173`，再访问首页确认 200。

## 4. 静态检查

```bash
pnpm exec tsc --noEmit          # 或 pnpm run typecheck
pnpm exec eslint . --max-warnings=0
```

- Next.js 的 `next build` 已内含类型检查，但本地快速反馈仍用 `tsc --noEmit`；
- `--max-warnings=0` 是否强制以仓库 CI 为准，不要单方面放宽。

## 5. 测试

**单元 / 组件（Vitest + Testing Library）**

```bash
pnpm exec vitest run
pnpm exec vitest run src/components/Button.test.tsx
pnpm exec vitest run -t "点击后调用 onSubmit"
pnpm exec vitest run --coverage
```

**e2e（Playwright）**

```bash
pnpm exec playwright test
pnpm exec playwright test tests/e2e/login.spec.ts
pnpm exec playwright test --headed          # 本地观察
pnpm exec playwright test --project=chromium
pnpm exec playwright show-report            # 看 HTML 报告
```

e2e 前置：先起应用（`pnpm dev` 或 `pnpm preview`），或用 Playwright 的 `webServer` 配置自动拉起。

**Cypress 项目**：`pnpm exec cypress run`（无头）/ `pnpm exec cypress open`（本地）。

## 6. 最小样例

`src/Greeting.tsx`：

```tsx
export function Greeting({ name }: { name: string }) {
  return <p role="status">你好，{name || '陌生人'}</p>
}
```

`src/Greeting.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Greeting } from './Greeting'

it('有名字时显示名字，空名字时回退', () => {
  const { rerender } = render(<Greeting name="小明" />)
  expect(screen.getByRole('status').textContent).toContain('小明')
  rerender(<Greeting name="" />)
  expect(screen.getByRole('status').textContent).toContain('陌生人')
})
```

验证：`pnpm exec vitest run src/Greeting.test.tsx`。

## 7. 常见坑

1. **断言实现而非行为**：断言 className / state 内部值，重构就红。用 role、可见文本、可访问名称。
2. **缺少 `jsdom` 环境**：RTL 测试报 `document is not defined`，需 `test.environment: 'jsdom'`。
3. **未清理副作用**：多个用例共用 DOM 导致重复元素，`getBy*` 报 found multiple elements；
   用 `cleanup()`（RTL 默认自动）或 `beforeEach` 重置 store。
4. **e2e 与 dev server 抢端口**：Playwright `webServer.reuseExistingServer` 在 CI 要关掉，
   否则会连到本地残留进程，验证的是旧代码。
5. **构建通过但运行白屏**：`base`/`publicPath` 配错，或路由用了 history 模式而静态服务器未回退到
   `index.html`；用 `vite preview` 验证，而不是只看 `build` 退出码。
6. **Next.js 的 Server/Client 组件边界**：在 Server Component 里用 `useState` 会构建失败，
   报错信息指向 `"use client"` 缺失。
7. **快照测试滥用**：整页快照一动就红且没人看 diff，改用关键元素断言。

## 8. 失败判据

- `pnpm build` 非 0，或产物目录为空；
- `tsc --noEmit` 有 `error TS`；
- 组件测试失败，或测试数量较基线下降；
- e2e 关键路径失败（登录、下单、提交表单）；
- 控制台出现未捕获异常 / React error boundary 触发；
- 交互后无用户可见反馈（按钮点了没反应、错误无提示）。
