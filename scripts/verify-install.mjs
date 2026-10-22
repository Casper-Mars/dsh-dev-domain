/**
 * 安装后自检（`pnpm verify:install`）：确认 7 个可进化种子 Skill、5 个 references、3 个固件
 * Skill 可见，缺失时非 0 退出。检查 `<资产根>/<seed>/SKILL.md`、
 * `<资产根>/dev-test-strategy/references/<stack>.md`、`<固件根>/<firmware>/SKILL.md`
 * （对齐 `src/pack.ts` / `src/firmware.ts`，只读不落盘）。
 *
 * 资产根来源：`--assets` > `--home` > `DSH_HOME` > 仓库 `templates/`；前三者任一显式给出
 * （`DSH_HOME` 非空即算）而目录不存在 → 退出码 2，**绝不回退**（否则未安装会被判通过）。
 * 退出码 0 全 PASS / 1 有 FAIL / 2 参数或环境错误。核心逻辑均为导出纯函数，`main` 仅在作为
 * CLI 直接执行时运行，导入本模块不执行 main、不 `process.exit`。
 */
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 期望清单：唯一真源，测试直接断言。 */
export const EXPECTED_SEED_SKILLS = ['dev-decompose', 'dev-ralph-loop', 'dev-worktree-git', 'dev-test-strategy', 'dev-role-developer', 'dev-role-tester', 'dev-retro']
export const EXPECTED_REFERENCE_STACKS = ['go', 'harmony-arkts', 'node-ts', 'python', 'react']
export const EXPECTED_FIRMWARE_SKILLS = ['dev-leader-rules', 'dev-dispatch-contract', 'dev-quality-gate']
export const EXPECTED_CHECK_COUNT = EXPECTED_SEED_SKILLS.length + EXPECTED_REFERENCE_STACKS.length + EXPECTED_FIRMWARE_SKILLS.length

/** dsh 已安装资产相对 home 的固定路径；来源 → CLI / 环境变量名（错误信息用）。 */
const INSTALLED_RELATIVE = path.join('.dsh-rsi-agent', 'dev', 'assets', 'skills')
const SOURCE_LABEL = { assets: '--assets', home: '--home', env: 'DSH_HOME' }

/** 目录存在性（显式来源缺失 → 退出码 2 用）。 */
const isDir = (target) => {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}
const describeError = (error) => (error instanceof Error ? error.message : String(error))

/** 校验一个「必须存在、是普通文件、非空」的文件，返回检查项。 */
function check(kind, name, file) {
  let reason = '缺少文件'
  try {
    const info = statSync(file)
    reason = info.isFile() ? (info.size === 0 ? '文件为空' : '') : '不是普通文件'
  } catch {
    /* 缺失即 FAIL，reason 用于定位 */
  }
  return { kind, name, path: file, ok: reason === '', reason }
}

/** 执行 15 项自检（7 + 5 + 3），不抛错、不写盘；返回 `checks/passed/failed/ok` 与回显信息。 */
export function verifyInstall({ assetsRoot, firmwareRoot, assetsSource = 'assets' }) {
  if (!assetsRoot || !firmwareRoot) throw new TypeError('verifyInstall 需要 assetsRoot 与 firmwareRoot')
  const checks = [
    ...EXPECTED_SEED_SKILLS.map((name) => check('seed', name, path.join(assetsRoot, name, 'SKILL.md'))),
    ...EXPECTED_REFERENCE_STACKS.map((stack) => check('reference', stack, path.join(assetsRoot, 'dev-test-strategy', 'references', `${stack}.md`))),
    ...EXPECTED_FIRMWARE_SKILLS.map((name) => check('firmware', name, path.join(firmwareRoot, name, 'SKILL.md'))),
  ]
  const passed = checks.filter((item) => item.ok).length
  return { assetsRoot, firmwareRoot, assetsSource, checks, passed, failed: checks.length - passed, ok: passed === checks.length }
}

/** 报告 → 文本行：`PASS` / `FAIL` 行只对应检查项（恰好 15 条），其余以 `#` 开头，便于 grep 计数。 */
export function formatReport(result) {
  const lines = [`# verify-install：assets=${result.assetsRoot} firmware=${result.firmwareRoot} 来源=${result.assetsSource}`]
  if (result.assetsSource === 'templates') {
    lines.push(`# 仓库模板回退（未设置 --assets / --home / DSH_HOME）：${result.assetsRoot}`)
  }
  for (const item of result.checks) {
    lines.push(item.ok ? `PASS ${item.kind} ${item.name} ${item.path}` : `FAIL ${item.kind} ${item.name} ${item.reason}：${item.path}`)
  }
  lines.push(`# 结果：${result.passed}/${result.checks.length} 通过，退出码 ${exitCode(result)}`)
  return lines
}

/** 报告 → 退出码：全 PASS 为 0，有 FAIL 为 1（参数 / 环境错误由 CLI 返回 2）。 */
export function exitCode(result) {
  return result.ok ? 0 : 1
}

/** 解析资产根 / 固件根（只推导路径、不检查存在性），返回绝对路径 + 来源标记。 */
export function resolveInstallTargets({ assets, home, firmware, env = {}, repoRoot, cwd = process.cwd() }) {
  const dshHome = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const installedAt = (dir) => path.join(path.resolve(cwd, dir), INSTALLED_RELATIVE)
  const [assetsRoot, assetsSource] = assets
    ? [path.resolve(cwd, assets), 'assets']
    : home
      ? [installedAt(home), 'home']
      : dshHome
        ? [installedAt(dshHome), 'env']
        : [path.join(repoRoot, 'templates'), 'templates']
  const firmwareRoot = firmware ? path.resolve(cwd, firmware) : path.join(repoRoot, 'skills')
  return { assetsRoot, assetsSource, firmwareRoot, firmwareSource: firmware ? 'flag' : 'repo' }
}

/** 解析命令行参数（`--flag value`）；非法参数抛错，由 main 转成退出码 2。 */
function parseArgs(argv) {
  const options = {}
  const valued = new Set(['--assets', '--home', '--firmware'])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!valued.has(flag)) throw new Error(`未知参数 "${flag}"（可用：--assets / --home / --firmware）`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`参数 "${flag}" 缺少取值`)
    options[flag.slice(2)] = value
    index += 1
  }
  return options
}

/** CLI 主流程：解析参数 → 解析资产根 → 校验 → 打印报告；环境错误只输出一行含路径信息（无堆栈）。 */
export function main(argv) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`[verify-install] ${describeError(error)}`)
    return 2
  }
  const targets = resolveInstallTargets({ ...options, env: process.env, repoRoot })
  // 显式来源缺失时绝不回退：安装未完成必须暴露为环境错误，而不是「全 PASS」的假绿。
  const assetsLabel = targets.assetsSource === 'templates' ? '仓库模板目录' : `${SOURCE_LABEL[targets.assetsSource]} 指定的资产目录`
  if (!isDir(targets.assetsRoot)) {
    console.error(`[verify-install] ${assetsLabel}不存在：${targets.assetsRoot}`)
    return 2
  }
  if (!isDir(targets.firmwareRoot)) {
    console.error(`[verify-install] 固件 Skill 目录不存在：${targets.firmwareRoot}`)
    return 2
  }
  try {
    const result = verifyInstall(targets)
    for (const line of formatReport(result)) console.log(line)
    return exitCode(result)
  } catch (error) {
    console.error(`[verify-install] 自检异常：${describeError(error)}`)
    return 2
  }
}

/** CLI 入口守卫：`argv[1]` 可能经符号链接（`/tmp`、挂载盘），而 `import.meta.url` 已是 realpath，
 * 必须比较 realpath，否则会「没跑 main 却 exit 0」（静默假绿）；realpath 失败退回 inode / 字符串比较。 */
function isDirectRun() {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(invoked) === realpathSync(self)
  } catch {
    try {
      const [a, b] = [statSync(invoked), statSync(self)]
      return a.dev === b.dev && a.ino === b.ino
    } catch {
      return path.resolve(invoked) === path.resolve(self)
    }
  }
}

if (isDirectRun()) process.exitCode = main(process.argv.slice(2))
