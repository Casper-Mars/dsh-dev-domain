/**
 * `scripts/verify-install.mjs` 单测（夹具全为 `mkdtempSync` 临时目录，不依赖真实 `DSH_HOME`）：
 * 全通过 14 条 PASS、缺种子 / 空 reference / 缺固件、exitCode、formatReport、解析优先级、
 * CLI 退出码 2（`--assets` / `DSH_HOME`）、templates 回退、符号链接调用不静默 exit 0。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXPECTED_CHECK_COUNT,
  EXPECTED_FIRMWARE_SKILLS,
  EXPECTED_REFERENCE_STACKS,
  EXPECTED_SEED_SKILLS,
  exitCode,
  formatReport,
  resolveInstallTargets,
  verifyInstall,
} from '../scripts/verify-install.mjs'
const SCRIPT = fileURLToPath(new URL('../scripts/verify-install.mjs', import.meta.url))
const temporaryRoots: string[] = []
function writeFile(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

/** 完整夹具：7 种子 + 5 references + 2 固件。 */
function makeFixture(): { root: string; assetsRoot: string; firmwareRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'verify-install-'))
  temporaryRoots.push(root)
  const assetsRoot = join(root, 'assets')
  const firmwareRoot = join(root, 'firmware')
  for (const name of EXPECTED_SEED_SKILLS) writeFile(join(assetsRoot, name, 'SKILL.md'), `# ${name}\n`)
  for (const stack of EXPECTED_REFERENCE_STACKS) writeFile(join(assetsRoot, 'dev-test-strategy', 'references', `${stack}.md`), `# ${stack}\n`)
  for (const name of EXPECTED_FIRMWARE_SKILLS) writeFile(join(firmwareRoot, name, 'SKILL.md'), `# ${name}\n`)
  return { root, assetsRoot, firmwareRoot }
}

/** 报告里以 PASS / FAIL 开头的行（检查项行）。 */
const checkLines = (lines: string[]): string[] => lines.filter((line) => /^(PASS|FAIL)/.test(line))

/** 跑 CLI（默认沿用当前环境，便于按用例覆盖 / 删除 DSH_HOME）。 */
const runCli = (args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop() as string, { recursive: true, force: true })
})

describe('verifyInstall', () => {
  it('完整夹具 → 14 条 PASS、ok=true、退出码 0，报告含全部名称', () => {
    const result = verifyInstall(makeFixture())
    const report = formatReport(result)
    const text = report.join('\n')
    expect(EXPECTED_CHECK_COUNT).toBe(14)
    expect([result.checks.length, result.passed, result.failed, exitCode(result)]).toEqual([14, 14, 0, 0])
    expect(checkLines(report)).toHaveLength(14)
    expect(checkLines(report).every((line) => line.startsWith('PASS'))).toBe(true)
    for (const name of EXPECTED_SEED_SKILLS) expect(text).toContain(`seed ${name}`)
    for (const stack of EXPECTED_REFERENCE_STACKS) expect(text).toContain(`reference ${stack}`)
    for (const name of EXPECTED_FIRMWARE_SKILLS) expect(text).toContain(`firmware ${name}`)
  })

  /** 三类失败：破坏夹具后应恰好 1 条 FAIL（带路径），其余 13 条 PASS。 */
  const dropDir = (dir: string): string => (rmSync(dir, { recursive: true, force: true }), join(dir, 'SKILL.md'))
  const emptyFile = (file: string): string => (writeFileSync(file, '', 'utf8'), file)
  const failureCases = [
    { label: '缺 1 个种子目录', kind: 'seed', name: EXPECTED_SEED_SKILLS[0], mutate: ({ assetsRoot }: { assetsRoot: string }) => dropDir(join(assetsRoot, EXPECTED_SEED_SKILLS[0])) },
    {
      label: '置空 1 个 reference',
      kind: 'reference',
      name: EXPECTED_REFERENCE_STACKS[0],
      mutate: ({ assetsRoot }: { assetsRoot: string }) => emptyFile(join(assetsRoot, 'dev-test-strategy', 'references', `${EXPECTED_REFERENCE_STACKS[0] as string}.md`)),
    },
    { label: '缺 1 个固件目录', kind: 'firmware', name: EXPECTED_FIRMWARE_SKILLS[0], mutate: ({ firmwareRoot }: { firmwareRoot: string }) => dropDir(join(firmwareRoot, EXPECTED_FIRMWARE_SKILLS[0])) },
  ]

  it.each(failureCases)('$label → 1 条 FAIL（带路径）+ 13 条 PASS，退出码 1', ({ kind, name, mutate }) => {
    const fixture = makeFixture()
    const target = mutate(fixture)
    const lines = checkLines(formatReport(verifyInstall(fixture)))
    const fails = lines.filter((line) => line.startsWith('FAIL'))
    expect(exitCode(verifyInstall(fixture))).toBe(1)
    expect(fails).toHaveLength(1)
    expect(fails[0]).toContain(`${kind} ${name}`)
    expect(fails[0]).toContain(target)
    expect(lines.filter((line) => line.startsWith('PASS'))).toHaveLength(13)
  })

  it('formatReport 每条检查一项：无重复、无遗漏、顺序与清单一致', () => {
    const actual = checkLines(formatReport(verifyInstall(makeFixture()))).map((line) => line.split(' ').slice(1, 3).join(':'))
    const expected = [
      ...EXPECTED_SEED_SKILLS.map((name: string) => `seed:${name}`),
      ...EXPECTED_REFERENCE_STACKS.map((stack: string) => `reference:${stack}`),
      ...EXPECTED_FIRMWARE_SKILLS.map((name: string) => `firmware:${name}`),
    ]
    expect(actual).toEqual(expected)
    expect(new Set(actual).size).toBe(actual.length)
  })
})

describe('resolveInstallTargets 优先级', () => {
  const repoRoot = '/repo/root'

  it('--assets > --home > DSH_HOME > templates，固件默认包根 skills/', () => {
    const all = resolveInstallTargets({ assets: 'a', home: '/h', env: { DSH_HOME: '/e' }, repoRoot, cwd: '/cwd' })
    expect([all.assetsRoot, all.assetsSource, all.firmwareRoot, all.firmwareSource]).toEqual(['/cwd/a', 'assets', '/repo/root/skills', 'repo'])
    const byHome = resolveInstallTargets({ home: '/h', env: { DSH_HOME: '/e' }, repoRoot })
    expect([byHome.assetsRoot, byHome.assetsSource]).toEqual(['/h/.dsh-rsi-agent/dev/assets/skills', 'home'])
    const byEnv = resolveInstallTargets({ env: { DSH_HOME: '/e' }, repoRoot })
    expect([byEnv.assetsRoot, byEnv.assetsSource]).toEqual(['/e/.dsh-rsi-agent/dev/assets/skills', 'env'])
    const fallback = resolveInstallTargets({ env: {}, repoRoot })
    expect([fallback.assetsRoot, fallback.assetsSource]).toEqual(['/repo/root/templates', 'templates'])
    const flag = resolveInstallTargets({ firmware: 'fw', env: {}, repoRoot, cwd: '/cwd' })
    expect([flag.firmwareRoot, flag.firmwareSource]).toEqual(['/cwd/fw', 'flag'])
  })
})

describe('CLI 退出码', () => {
  it.each([
    ['--assets 指向不存在目录', (missing: string) => ['--assets', missing], false],
    ['DSH_HOME 指向未安装 home', () => [], true],
  ])('%s → exit 2，不回退 templates、无 PASS/FAIL 行、无堆栈', (label, argsOf, viaEnv) => {
    const missing = join(makeFixture().root, 'does-not-exist')
    const child = runCli((argsOf as (path: string) => string[])(missing), viaEnv ? { DSH_HOME: missing } : {})
    expect(child.status).toBe(2)
    expect(child.stderr).toContain(label.split(' ')[0] as string)
    expect(child.stderr).toContain(missing)
    expect(child.stderr).not.toMatch(/\n\s+at /)
    expect(child.stdout).not.toMatch(/^(PASS|FAIL)/m)
    expect(child.stdout).not.toContain('仓库模板回退')
  })

  it('--assets / --home / DSH_HOME 全未给出 → 回退仓库 templates 并输出提示行', () => {
    const env = { ...process.env }
    delete env.DSH_HOME
    const child = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env })
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('仓库模板回退')
    expect(checkLines(child.stdout.split('\n'))).toHaveLength(14)
  })

  it.skipIf(process.platform === 'win32')('经符号链接路径调用 → 仍跑满 14 项 PASS，不静默 exit 0', () => {
    const link = join(makeFixture().root, 'verify-link.mjs')
    symlinkSync(SCRIPT, link)
    const repo = fileURLToPath(new URL('..', import.meta.url))
    const args = [link, '--assets', join(repo, 'templates'), '--firmware', join(repo, 'skills')]
    const child = spawnSync(process.execPath, args, { encoding: 'utf8' })
    const lines = checkLines(child.stdout.split('\n'))
    expect([child.status, child.stdout.length > 0, lines.length]).toEqual([0, true, 14])
    expect(lines.every((line) => line.startsWith('PASS'))).toBe(true)
  })
})
