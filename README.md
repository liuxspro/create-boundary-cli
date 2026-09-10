# @liuxspro/create-boundary-cli

根据地块边界坐标 CSV，调用 [`@liuxspro/create-boundary`](https://jsr.io/@liuxspro/create-boundary) 的
`csv_to_shp` + `make_boundary_zip` 生成 Shapefile 并打包为 ZIP 的命令行工具。

## 安装

```bash
# 全局安装
npm install -g @liuxspro/create-boundary-cli
# 或装到项目里
npm install -D @liuxspro/create-boundary-cli
```

## 免安装使用（npx / pnpm dlx）

一次性使用无需安装，适合偶尔转换或写进脚本/CI：

```bash
# npx（npm 用户）
npx --yes @liuxspro/create-boundary-cli@0.1.0 地块.csv \
  --dkmc "示例地块" --dkdm "002" --xzqmc "示例区" --xzqdm "320000"

# pnpm dlx（pnpm 用户，走全局 store，同版本第二次几乎瞬启）
pnpm dlx @liuxspro/create-boundary-cli 地块.csv \
  --dkmc "示例地块" --dkdm "002" --xzqmc "示例区" --xzqdm "320000"
```

- `--yes`：跳过首次下载的交互确认，非交互环境（CI/脚本）必加；
- 建议写死版本号（如 `@0.1.0`）保证可复现，不加则取最新版；
- 包安装期零依赖，npx 缓存后可在 `--offline` 下运行；
- 包内 `examples/` 目录带有示例坐标文件，安装后可在
  `node_modules/@liuxspro/create-boundary-cli/examples/` 找到。

## 用法

```bash
create-boundary <csv> --dkmc <地块名称> --dkdm <地块代码> --xzqmc <行政区名称> --xzqdm <行政区代码> [选项]
```

### 参数

| 参数    | 说明                                       |
| ------- | ------------------------------------------ |
| `<csv>` | 坐标 CSV 文件路径，传 `-` 可从标准输入读取 |

CSV 首行为表头，每行 3 列：`编号, X, Y`。坐标可为经纬度（X < 200，自动投影到
CGCS2000），或已是 CGCS2000 投影坐标（X ≥ 200，需含带号、8 位整数部分）。

```csv
编号,经度,纬度
1,117.513070,34.307738
2,117.513274,34.309178
```

### 必填项（对应 DBF 字段）

| 参数             | DBF 字段 | 说明       |
| ---------------- | -------- | ---------- |
| `--dkmc <名称>`  | DKMC     | 地块名称   |
| `--dkdm <代码>`  | DKDM     | 地块代码   |
| `--xzqmc <名称>` | XZQMC    | 行政区名称 |
| `--xzqdm <代码>` | XZQDM    | 行政区代码 |

### 选项

| 选项                  | 说明                                  | 默认值             |
| --------------------- | ------------------------------------- | ------------------ |
| `-s, --stage <阶段>`  | 调查阶段：`初步调查` \| `详细调查`    | `初步调查`         |
| `-o, --output <文件>` | 输出 ZIP 路径（可选，不填时自动命名） | `{阶段}{DKDM}.zip` |
| `--ydmj <面积>`       | 用地面积 (m²)，不填按多边形自动计算   | 自动               |
| `--dh <带号>`         | 带号，不填按坐标自动计算              | 自动               |
| `--scrq <日期>`       | 生成日期 (`YYYY-MM-DD`)               | 今天               |
| `--scdw <单位>`       | 生成单位 (SCDW)                       | 空                 |
| `--bz <备注>`         | 备注 (BZ)                             | 空                 |
| `-v, --version`       | 输出版本号                            |                    |
| `-h, --help`          | 显示帮助                              |                    |

### 示例

```bash
# 自动计算面积、带号，默认今天为生成日期
create-boundary examples/points.csv --dkmc "示例地块" --dkdm "002" \
  --xzqmc "示例区" --xzqdm "320000"

# 手动指定面积、带号、生成日期
create-boundary examples/points.csv --dkmc "示例地块" --dkdm "002" \
  --xzqmc "示例区" --xzqdm "320000" --ydmj 129068.42 --dh 39 --scrq 2026-09-08 \
  --scdw "XX测绘院" --bz "" -s 详细调查 -o 地块.zip

# 从标准输入读取坐标
cat examples/points.csv | create-boundary - --dkmc "示例地块" --dkdm "002" \
  --xzqmc "示例区" --xzqdm "320000"
```

> 示例里的 `examples/points.csv` 是**仓库内**路径。通过 npm 安装后，同样的示例文件位于
> `node_modules/@liuxspro/create-boundary-cli/examples/`；用 npx / pnpm dlx 时请换成你自己的坐标文件路径。

## 常见错误与原因

CLI 会在库的原始报错前补上所处阶段与文件路径，并在常见坐标问题上附上提示。

| 报错信息                                                                   | 原因                                                                                    | 处理                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `解析坐标失败（文件）: X 缺失带号`                                         | 投影坐标的 X 未含带号（整数部分不足 8 位）                                              | 补上带号，如 `39547228.491`；参见 `examples/坐标_投影 - 无带号.csv` |
| `解析坐标失败（文件）: 带号不在范围内(25~45)`                              | X 含 8 位但前两位不是合法带号                                                           | 3 度带带号应为 25~45，即 X 的前两位                                 |
| `解析坐标失败（文件）: 经度不在中国范围内(73.62~135)`                      | 经纬度输入的经度超出范围                                                                | 经度应在 73.62~135（库仅校验经度）                                  |
| `解析坐标失败（文件）: 组成环的点数至少要 3 个, 当前只有 N 个`             | 坐标点少于 3 个（N 为闭合环后的点数，即实际点数 +1）                                    | 至少提供 3 个点                                                     |
| `--xzqdm 超出 XZQDM 字段宽度（最多 12 字节，当前 16 字节；中文占 3 字节）` | 文本参数值超出 DBF 字段宽度（按 UTF-8 **字节**计）                                      | 缩短取值，或改用更短的名称/代码                                     |
| `生成边界文件失败: String length exceeds limit: N`                         | 库内部写入超宽，通常是**数值字段过大**（如 `--ydmj` 超过 14 位整数、`--dh` 超过 16 位） | 检查数值是否合理                                                    |
| `缺少必填参数: ...`                                                        | 未提供 `--dkmc` / `--dkdm` / `--xzqmc` / `--xzqdm`                                      | 补齐四个必填参数                                                    |

DBF 字段宽度：文本字段（**字节**）`DKMC`/`SCDW`/`BZ` 254、`DKDM` 100、`XZQMC` 100、`XZQDM` 12；
数值字段 `YDMJ` 17 字符（2 位小数，约 14 位整数）、`DH` 16 位整数、`SCRQ` 8 位日期。
文本字段的超宽会在调用库之前被 CLI 拦下并点名参数。

退出码：`0` 成功；`1` 运行期错误（坐标解析 / 边界生成失败）；`2` 参数错误（必填缺失、未知选项、缺位置参数）。

### 示例文件

| 文件                                | 说明                                       |
| ----------------------------------- | ------------------------------------------ |
| `examples/points.csv`               | 经纬度坐标，自动投影到 CGCS2000            |
| `examples/坐标_投影.csv`            | 投影坐标，Y 列在前，由库自动纠正列序       |
| `examples/坐标_投影 - 交换顺序.csv` | 投影坐标，X（含带号）列在前                |
| `examples/坐标_投影 - 无带号.csv`   | **错误示例**：X 缺带号，用于验证报错与提示 |

## 本地开发

源码为 TypeScript（`src/main.ts`）。rolldown 只负责转译打包，类型检查由 `tsc` 单独执行：

```bash
pnpm install
pnpm run typecheck    # tsc --noEmit，仅类型检查，不产出文件
pnpm run build        # rolldown 打包到 dist/cli.js
node dist/cli.js --help
node dist/cli.js examples/points.csv --dkmc "示例地块" --dkdm "002" \
  --xzqmc "示例区" --xzqdm "320000"
```

## 测试

黑盒测试：直接执行构建产物 `dist/cli.js`，校验退出码与标准输出，并解包 ZIP 校验 DBF 落库值。

```bash
pnpm test    # 等价于 pnpm run build && node --test tests/cli.test.ts
```

覆盖场景：经纬度坐标自动投影、投影坐标（含 X/Y 列序自动纠正）、自动计算与 `--ydmj/--dh` 覆盖、
`--scrq/--scdw/--bz` 落库、默认输出命名、stdin 输入、必填缺失 / 非法 stage / 未知选项、
`--help` 与 `--version`。

> 测试源码为 TypeScript，由 Node 直接执行（类型剥离），需 Node ≥ 22.18。

## 发布

```bash
npm login
npm publish           # prepack 钩子会自动执行 pnpm run build
```
