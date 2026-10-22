# Python 技术栈参考

适用：仓库根有 `pyproject.toml` 或 `requirements.txt` 的库、CLI、服务。
有 `go.mod` / `package.json` 时先按 `dev-test-strategy` 的优先级表判定。

## 1. 检测信号

| 信号 | 说明 |
|------|------|
| `pyproject.toml` | 现代项目配置（PEP 621）；看 `[project]` 与 `[tool.*]` |
| `requirements.txt` | 旧式依赖清单 |
| `uv.lock` / `poetry.lock` / `Pipfile.lock` | 决定包管理器 |
| `.python-version` | 版本约束（pyenv / uv） |
| `tox.ini` / `noxfile.py` | 多环境测试矩阵 |
| `tests/` + `conftest.py` | pytest 项目 |
| `mypy.ini` / `[tool.mypy]` | 已配类型检查 |

```bash
ls pyproject.toml requirements.txt uv.lock poetry.lock .python-version 2>/dev/null
python3 --version
python3 -c "import sys;print(sys.version)"
```

## 2. 环境准备

按锁文件选包管理器，**不要混用**：

| 锁文件 | 安装命令 |
|--------|----------|
| `uv.lock` | `uv sync` |
| `poetry.lock` | `poetry install` |
| `Pipfile.lock` | `pipenv install --deploy` |
| 只有 `requirements.txt` | `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` |

```bash
uv sync                       # 推荐；会创建 .venv 并按锁文件安装
uv run python -V              # 在项目环境里执行，避免用错解释器
```

- 一律在虚拟环境内操作，不往系统 Python 装包；开发依赖（如 `requirements-dev.txt`）按仓库实际文件名装；
- 版本以 `.python-version` / `requires-python` 为准，不匹配时先切版本。

## 3. 构建

纯 Python 库通常无构建步骤；需要打包时：

```bash
uv build                      # 产出 dist/*.whl 与 dist/*.tar.gz
python3 -m build              # 未用 uv 时的等价命令
```

服务/CLI 的「构建」= 可导入性检查：

```bash
uv run python -c "import <package>; print(<package>.__file__)"
```

产物路径：`dist/`（需在 `.gitignore` 中）。

## 4. 静态检查

```bash
uv run ruff check .           # lint（快，替代 flake8/isort）
uv run ruff format --check .  # 格式检查，不写文件
uv run mypy .                 # 类型检查（需已配置）
```

无 uv 时直接执行 `ruff check .` 与 `mypy .`。

- `mypy` 未配置时默认很宽松，判断标准以 `pyproject.toml` 的 `[tool.mypy]` 为准；
- 不要为了让检查通过而全局加 `# type: ignore`。

## 5. 测试

```bash
uv run pytest -q                              # 全部
uv run pytest -q --cov=<package> --cov-report=term-missing   # 覆盖率
uv run pytest tests/test_pack.py -q            # 单文件
uv run pytest tests/test_pack.py::test_seed -q # 单用例
uv run pytest -q -k "references and not slow"  # 按名字筛选
uv run pytest -q -x                            # 首个失败即停
uv run pytest -q --lf                          # 只跑上次失败的
```

失败复跑要点：上面的命令在无 uv 环境下把 `uv run` 换成激活虚拟环境后的直接命令。
- `-q` 保留汇总行（`X passed, Y failed`）作为证据；`--lf` 定位 flaky：连跑 3 次结果不一致即为 flaky，需修而不是重试；
- 集成测试常带 marker：`uv run pytest -q -m integration`（以 `pyproject.toml` 的 markers 为准）。

无 uv 时把 `uv run` 换成激活虚拟环境后的直接命令（`pytest -q`）。

## 6. 最小样例

`pyproject.toml`：

```toml
[project]
name = "mini"
version = "0.1.0"
requires-python = ">=3.11"
```

`src/mini/sum.py` 与 `tests/test_sum.py`：

```python
def sum_two(a: int, b: int) -> int:
    return a + b
```

```python
from mini.sum import sum_two

def test_sum_two_positive() -> None:
    assert sum_two(1, 2) == 3

def test_sum_two_negative() -> None:
    assert sum_two(-1, 1) == 0
```

验证：`uv run pytest -q`（或 `pytest -q`）。包未安装时用 `PYTHONPATH=src pytest -q`。

## 7. 常见坑

1. **用错解释器**：`pytest` 来自系统 Python，导入失败或跑的是旧版本代码。始终 `uv run` 或显式
   `.venv/bin/pytest`。
2. **`src/` 布局未安装**：`ModuleNotFoundError`，需 `uv sync`（项目自身以 editable 安装）或设
   `PYTHONPATH=src`。
3. **`conftest.py` 路径魔法**：依赖 cwd 的 fixture 在别的目录跑就失败，用 `tmp_path` 与绝对路径。
4. **可变默认参数**：`def f(items=[])` 跨用例共享状态，是隐性 flaky 源。
5. **`mypy` 与 `ruff` 规则冲突**：行长、import 排序以 `pyproject.toml` 配置为准，不各自为政。
6. **测试污染真实资源**：连了真实数据库/网络，CI 不稳定；用 `tmp_path`、mock、或标记为 integration。
7. **`assert` 被 `-O` 优化掉**：不要用 `assert` 做运行时校验（生产代码用显式 raise）或依赖 cwd 路径。

## 8. 失败判据

- `ruff check .` 有输出（E/F 类必须为 0）；
- `mypy .` 有 error；
- `pytest` 有 failed / error，或被 `skip` 且无原因；
- 覆盖率较基线下降且无说明；
- 测试依赖网络/真实外部服务（不可重复）；
- `pyproject.toml` / 锁文件在验证过程中被修改。
