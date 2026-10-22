import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置。
 *
 * 骨架期只有契约 / bootstrap / 集成用例；`passWithNoTests` 保证测试集为空时
 * 也能以成功状态退出。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
