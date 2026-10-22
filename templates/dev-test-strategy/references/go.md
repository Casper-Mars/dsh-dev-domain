# Go 技术栈参考

适用：仓库根有 `go.mod` 的纯 Go 模块 / 服务。检测到其它栈信号时以 `dev-test-strategy` 的优先级表为准。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| `go.mod` | 必存在，`module` 行给出模块路径 |
| `go.sum` | 依赖锁定；缺失说明从未构建过 |
| `*.go` 文件 | 包内源文件 |
| `Makefile` / `Taskfile.yml` | 可能有 `make test` 之类的封装，**优先看它** |
| `cmd/<name>/main.go` | 服务/CLI 入口惯例 |

版本以 `go.mod` 的 `go` 行与 `toolchain` 行为准：

```bash
head -5 go.mod
go version
```

## 2. 环境准备

```bash
go version                      # 需 ≥ go.mod 声明的版本
go env GOMODCACHE GOPATH        # 确认缓存路径
go mod download                 # 预下载依赖（CI 常用）
go mod verify                   # 校验依赖未被篡改
```

- 私有模块需 `GOPRIVATE` / `GONOSUMDB`，否则 `go mod download` 报 404；国内网络可设
  `GOPROXY=https://goproxy.cn,direct`（以团队规范为准）；
- 不要 `go get -u` 全量升级，依赖变更必须单独成 commit。

### 2.1 沙箱 / CI 缓存兜底（默认缓存不可写时）

```bash
export GOCACHE="${GOCACHE:-$PWD/.cache/go-build}"
export GOMODCACHE="${GOMODCACHE:-$PWD/.cache/gomod}"
mkdir -p "$GOCACHE" "$GOMODCACHE"
go env GOCACHE GOMODCACHE
```

默认缓存位于 `$HOME/Library/Caches/go-build` 或 `/root/.cache/go-build`，沙箱下常在工作目录外，
表现为 `go build: operation not permitted`；此时先设上面的变量，**不要**以此判定代码有问题。

依赖有变更时补 `go mod tidy`，并单独 commit `go.mod` / `go.sum`；不要把 `go mod tidy` 混进功能 diff。

## 3. 构建

```bash
go build ./...                              # 编译所有包（不产出文件，最快的编译校验）
go build -o bin/<name> ./cmd/<name>         # 编译单个可执行文件
go build -trimpath -ldflags "-s -w" -o bin/<name> ./cmd/<name>   # 发布态
```

产物路径：`bin/<name>`（或 `./<name>`，取决于 `-o`）。`go build ./...` 不写产物到磁盘，
适合在 CI 里做编译门禁。

交叉编译：

```bash
GOOS=linux GOARCH=amd64 go build -o bin/<name>-linux-amd64 ./cmd/<name>
```

## 4. 静态检查

```bash
gofmt -l .                # 列出未格式化的文件；有输出即失败
go vet ./...              # 官方静态检查，必跑
```

可选（仓库有配置时才跑）：

```bash
golangci-lint run ./...   # 需已安装；配置见 .golangci.yml
staticcheck ./...         # 需已安装
```

自动化格式修正：`gofmt -w .`（只改格式，单独提交）。

## 5. 测试

```bash
go test ./...                       # 全部单测
go test ./... -race -cover          # 竞态检测 + 覆盖率（推荐门禁）
go test ./... -count=1 -coverprofile=cover.out && go tool cover -func=cover.out | tail -1
```

单条用例复跑：

```bash
go test ./internal/pack -run TestValidateSkillAsset -v
go test ./... -run 'TestSeed/name_mismatch' -v    # 子测试用 / 分隔
```

只跑失败过的包：`go test ./internal/pack ./cmd/server -count=1`。

基准与集成：

```bash
go test ./... -bench=. -benchmem -run '^$'
go test -tags=integration ./...     # 仅当仓库定义了 build tag
```

## 6. 最小样例

```go
// go.mod: module example.com/mini  /  go 1.22
package mini

import "testing"

func Add(a, b int) int { return a + b }

func TestAdd(t *testing.T) {
	cases := []struct{ a, b, want int }{
		{1, 2, 3},
		{-1, 1, 0},
	}
	for _, c := range cases {
		if got := Add(c.a, c.b); got != c.want {
			t.Fatalf("Add(%d,%d)=%d, want %d", c.a, c.b, got, c.want)
		}
	}
}
```

验证：

```bash
go build ./... && go vet ./... && go test ./... -race -cover
```

## 7. 常见坑

1. **`go test` 命中缓存**：输出里出现 `(cached)` 说明没真跑。门禁加 `-count=1`。
2. **`-race` 在 cgo 关闭时不可用**：需 `CGO_ENABLED=1` 且有 C 工具链；macOS 默认可用，
   精简容器里常失败——失败时记录原因并降级为 `go test ./...`。
3. **包级 `init()` 读环境变量**：单测并行时互相污染；测试内用 `t.Setenv`，不要 `os.Setenv`。
4. **`go vet` 对 `%w`/`%v` 很敏感**：格式化字符串不匹配会直接失败，不要用 `//nolint` 掩盖。
5. **`./...` 会包含 `vendor/` 之外的测试辅助包**：若仓库有 `testdata` 或 `tools` 模块，
   用 `go test ./internal/... ./cmd/...` 缩小范围。
6. **模块路径与目录不一致**：`go build` 报 `cannot find module` 时先看 `go.mod` 的 `module` 行。

## 8. 失败判据

以下任一情况判 **不通过**：

- `go build ./...` 非 0 退出；
- `go vet ./...` 有输出；
- `gofmt -l .` 列出任何文件；
- `go test ./...` 有用例 FAIL，或 `-race` 报 `DATA RACE`；
- 测试被 `t.Skip` 跳过且无 issue/原因说明，或覆盖率较基线下降且无说明。
