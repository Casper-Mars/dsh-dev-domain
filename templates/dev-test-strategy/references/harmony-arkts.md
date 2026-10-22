# 鸿蒙 ArkTS 技术栈参考

适用：HarmonyOS / OpenHarmony 应用或元服务工程，根目录有 `build-profile.json5` 与
`oh-package.json5`。**注意**：该栈强依赖 DevEco Studio / HarmonyOS SDK，纯 CLI 能力有限，
检测不到 SDK 时必须降级（见第 2、8 节）。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| `build-profile.json5` | 工程级构建配置（products / modules / signingConfigs） |
| `oh-package.json5` | 依赖清单（ohpm 管理，不是 npm） |
| `hvigorfile.ts` | 构建脚本入口（hvigor 任务定义） |
| `entry/` `feature/` `entry/src/main/ets/` | 模块目录与 ArkTS 源码 |
| `entry/src/ohosTest/` | 仪器化测试（Hypium） |
| `oh-package-lock.json5` | 依赖锁定 |

```bash
ls build-profile.json5 oh-package.json5 hvigorfile.ts oh-package-lock.json5 2>/dev/null
```

## 2. 环境准备

必需：DevEco Studio（或 Command Line Tools，提供 hvigor / SDK / 签名工具）、HarmonyOS SDK
（`$DEVECO_SDK_HOME` 指向 SDK 目录）、ohpm、Node.js（版本以 `hvigor/hvigor-config.json5` 为准）。

```bash
echo "$DEVECO_SDK_HOME" && which ohpm hvigorw hdc node && ohpm --version
```

工程内构建入口是**工程自带的 wrapper**（`hvigorw` / `hvigorw.bat`），不要用全局 hvigor：

```bash
./hvigorw --version           # 打印 hvigor 版本（首次会下载依赖）
ohpm install                  # 安装 oh-package.json5 中的依赖
```

依赖源与证书配置在 `~/.ohpm/`（Windows 为 `%USERPROFILE%\.ohpm\`）；私有仓需 `.ohpmrc`，不提交个人 token。

### 检测不到 SDK 时（降级）

```bash
if [ -z "$DEVECO_SDK_HOME" ] || ! command -v ohpm >/dev/null; then
  echo "SKIP: 无 HarmonyOS SDK，无法执行构建/测试"
fi
```

降级顺序：① 校验两个 json5 配置为合法 JSON5；② 按第 7 节人工检查 ArkTS 约束；
③ 交由具备 DevEco 环境的 Tester 复跑，不自行宣布通过。

## 3. 构建

```bash
ohpm install
./hvigorw clean
./hvigorw assembleHap --mode module -p product=default
```

- `assembleHap` 产出 HAP；`--mode module` 表示按模块构建；`-p product=default` 对应
  `build-profile.json5` 中 `products` 的产品名，多产品时改这里；
- 产物路径：`<module>/build/default/outputs/default/<module>-default-signed.hap`
  （未签名时为 `-unsigned.hap`）；
- 需要 APP 包时用 `assembleApp`——任务名以 `./hvigorw --help` 的实际输出为准，不要臆造子命令。

签名：本地调试可用 DevEco 自动签名；CI 需 `signingConfigs` + 证书，证书**不入库**。

## 4. 静态检查

- ArkTS 编译器在 `assembleHap` 阶段做类型检查：**构建通过 = 类型通过**；IDE 的 Code Linter
  有独立 CLI，但纯命令行环境常不可用，不要假设存在；
- 手工检查：`@State` / `@Prop` / `@Link` 是否符合状态管理约束；是否存在 `any`、`eval`、
  动态属性访问、结构化类型等 ArkTS 严格模式禁止的写法。

```bash
rg -n ": any\b|as any|eval\(" entry/src/main/ets || true
```

## 5. 测试

```bash
./hvigorw test                      # 运行工程定义的测试任务（需 SDK）
```

- 单元测试在 `entry/src/test/`，仪器化测试在 `entry/src/ohosTest/`（Hypium 框架）；
- 单条用例复跑：DevEco Studio 中右键运行；CLI 侧测试 HAP 的安装执行能力因版本而异，
  以 `./hvigorw tasks` 的实际输出为准；覆盖率走 DevEco 的 Test Coverage 面板，
  CLI 无稳定等价命令，不要编造参数；
- 设备验证：

```bash
hdc list targets                                    # 确认设备已连接
hdc shell aa start -a EntryAbility -b <bundleName>  # 拉起应用做手工验证
```

## 6. 最小样例

`entry/src/main/ets/utils/Sum.ets`：

```ts
export function sum(a: number, b: number): number {
  return a + b
}
```

`entry/src/test/Sum.test.ets`（Hypium）：

```ts
import { describe, expect, it } from '@ohos/hypium'
import { sum } from '../main/ets/utils/Sum'

export default function sumTest() {
  describe('sum', () => {
    it('adds numbers', 0, () => {
      expect(sum(1, 2)).assertEqual(3)
      expect(sum(-1, 1)).assertEqual(0)
    })
  })
}
```

验证：`ohpm install && ./hvigorw assembleHap --mode module -p product=default && ./hvigorw test`。

## 7. 常见坑

1. **用 npm/pnpm 装依赖**：鸿蒙用 `ohpm`，`package.json` 的依赖不被识别，构建报
   `Cannot find module '@ohos/...'`。
2. **用全局 hvigor**：版本与 `hvigor/hvigor-config.json5` 不一致 → 任务缺失或 DSL 报错，
   必须用工程内 `./hvigorw`。
3. **漏掉 `-p product=default`**：多产品工程报 `product not found`，或构建出错误渠道的包。
4. **ArkTS 严格模式误用 TS 特性**：对象字面量类型断言、`any`、动态 key 访问都会编译失败，
   改用显式 `interface` / `class`。
5. **签名缺失/过期、SDK 版本不匹配**：分别报 `signature verify failed` 与 `The SDK version is not supported`（后者改 `compatibleSdkVersion` 或换 SDK）。
6. **`oh-package-lock.json5` 漂移**：`ohpm install` 会改锁文件，验证环境需保持一致。

## 8. 失败判据

- `ohpm install` 非 0，或 `oh-package-lock.json5` 被改写；`./hvigorw assembleHap` 非 0，或产物 HAP 不存在；
- `./hvigorw test` 有用例失败；
- 应用安装/启动崩溃（`hdc shell hilog` 出现 FATAL / JS Crash）；
- 关键交互无响应、状态不刷新，或 **无 SDK 导致的未验证被记为 pass**。
