import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));
const PACKAGE_JSON = new URL("../package.json", import.meta.url);

/** 经纬度示例：自动投影到 CGCS2000 */
const CSV_LONLAT = path.join(EXAMPLES, "points.csv");
/** 投影坐标示例：X（含带号）列在前 */
const CSV_PROJ_X_FIRST = path.join(EXAMPLES, "坐标_投影 - 交换顺序.csv");
/** 投影坐标示例：Y 列在前，由库自动纠正列序 */
const CSV_PROJ_Y_FIRST = path.join(EXAMPLES, "坐标_投影.csv");
/** 无带号的投影坐标示例：库会报错 */
const CSV_PROJ_NO_ZONE = path.join(EXAMPLES, "坐标_投影 - 无带号.csv");

const BASE_ARGS = [
  "--dkmc",
  "示例地块",
  "--xzqmc",
  "示例区",
  "--xzqdm",
  "320000",
];

let workdir = "";

before(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "create-boundary-cli-"));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: workdir });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function loadZip(zipPath: string): Promise<JSZip> {
  return await JSZip.loadAsync(await readFile(zipPath));
}

async function readZipEntries(zipPath: string): Promise<string[]> {
  const zip = await loadZip(zipPath);
  return Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
}

/** 从 DBF 头部读取字段描述符（名称与宽度），并按记录偏移逐字段解码第一条记录 */
async function readDbfRecord(zipPath: string): Promise<Record<string, string>> {
  const zip = await loadZip(zipPath);
  const dbfName = Object.keys(zip.files).find((name) => name.endsWith(".dbf"));
  assert.ok(dbfName, `ZIP 中未找到 .dbf 文件: ${zipPath}`);
  const file = zip.file(dbfName);
  assert.ok(file, `无法读取 DBF 文件对象: ${dbfName}`);

  const bytes = await file.async("uint8array");
  // 头部 8-9 字节（小端）为头部长度，也是第一条记录的起始偏移
  const headerLength = bytes[8] | (bytes[9] << 8);
  const fieldCount = (headerLength - 32 - 1) / 32;

  const fields: Array<[string, number]> = [];
  for (let i = 0; i < fieldCount; i += 1) {
    const base = 32 + i * 32;
    const name = Buffer.from(bytes.subarray(base, base + 11))
      .toString("latin1")
      .replace(/\0.*$/, "")
      .trim();
    fields.push([name, bytes[base + 16]]);
  }

  // 记录长度（小端）= 删除标记 + 各字段宽度之和
  const recordLength = bytes[10] | (bytes[11] << 8);
  const widths = fields.reduce((sum, [, width]) => sum + width, 0);
  assert.equal(recordLength, widths + 1, "DBF 记录长度与字段宽度之和不符");

  const record = bytes.subarray(headerLength);
  const decoder = new TextDecoder("utf-8");
  const values: Record<string, string> = {};
  let offset = 1; // 记录首字节为删除标记
  for (const [name, width] of fields) {
    values[name] = decoder
      .decode(record.subarray(offset, offset + width))
      .trim();
    offset += width;
  }
  return values;
}

/** 读取投影坐标 CSV：X 为整数部分 8 位（含带号）的那一列，另一列为 Y */
async function readProjectedPolygon(
  csvPath: string,
): Promise<Array<[number, number]>> {
  const text = await readFile(csvPath, "utf8");
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = line.split(",").map((cell) => cell.trim());
      const first = Number(cells[1]);
      const second = Number(cells[2]);
      return String(Math.trunc(first)).length === 8
        ? [first, second]
        : [second, first];
    });
}

/** 独立实现的多边形面积（鞋带公式），用于交叉验证库计算出的 YDMJ */
function shoelaceArea(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}${month}${day}`;
}

test("投影坐标（X 列在前）：自动计算带号与面积", async () => {
  const out = path.join(workdir, "proj-x-first.zip");
  const result = await runCli([
    CSV_PROJ_X_FIRST,
    ...BASE_ARGS,
    "--dkdm",
    "102",
    "-o",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /自动计算: YDMJ=[\d.]+, DH=39/);

  const expected = Math.round(
    shoelaceArea(await readProjectedPolygon(CSV_PROJ_X_FIRST)) * 100,
  ) /
    100;
  const values = await readDbfRecord(out);
  assert.equal(values.DH, "39");
  assert.equal(values.YDMJ, expected.toFixed(2));
  assert.equal(values.DKDM, "102");
  assert.equal(values.DKMC, "示例地块");
  assert.equal(values.XZQMC, "示例区");
  assert.equal(values.XZQDM, "320000");
  assert.deepEqual(await readZipEntries(out), [
    "初步调查102.cpg",
    "初步调查102.dbf",
    "初步调查102.prj",
    "初步调查102.shp",
    "初步调查102.shx",
  ]);
});

test("投影坐标（Y 列在前）：库自动纠正列序，结果与 X 列在前一致", async () => {
  const out = path.join(workdir, "proj-y-first.zip");
  const result = await runCli([
    CSV_PROJ_Y_FIRST,
    ...BASE_ARGS,
    "--dkdm",
    "101",
    "-o",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /自动计算: YDMJ=[\d.]+, DH=39/);

  const values = await readDbfRecord(out);
  const expected = Math.round(
    shoelaceArea(await readProjectedPolygon(CSV_PROJ_Y_FIRST)) * 100,
  ) /
    100;
  assert.equal(values.DH, "39");
  assert.equal(values.YDMJ, expected.toFixed(2));

  // 两个文件的几何相同，仅列序不同
  const swapped = await readDbfRecord(path.join(workdir, "proj-x-first.zip"));
  assert.equal(values.YDMJ, swapped.YDMJ);
  assert.equal(values.DH, swapped.DH);
});

test("经纬度坐标：自动投影且带号等于 round(经度 / 3)", async () => {
  const out = path.join(workdir, "lonlat.zip");
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "002",
    "-o",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  // 首点经度 117.513070 → round(117.51307 / 3) = 39
  assert.match(result.stdout, /自动计算: YDMJ=130255\.78, DH=39/);

  const values = await readDbfRecord(out);
  assert.equal(values.DH, "39");
  assert.equal(values.YDMJ, "130255.78");
});

test("--ydmj / --dh 覆盖自动计算值，且不再提示自动计算", async () => {
  const out = path.join(workdir, "override.zip");
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "003",
    "--ydmj",
    "129068.42",
    "--dh",
    "40",
    "-s",
    "详细调查",
    "-o",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /自动计算/);

  const values = await readDbfRecord(out);
  assert.equal(values.YDMJ, "129068.42");
  assert.equal(values.DH, "40");
  assert.deepEqual(await readZipEntries(out), [
    "详细调查003.cpg",
    "详细调查003.dbf",
    "详细调查003.prj",
    "详细调查003.shp",
    "详细调查003.shx",
  ]);
});

test("--scrq 指定生产日期，未指定时默认今天（YYYYMMDD）", async () => {
  const explicit = path.join(workdir, "scrq-explicit.zip");
  const explicitResult = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "004",
    "--scrq",
    "2026-01-15",
    "-o",
    explicit,
  ]);
  assert.equal(explicitResult.code, 0, explicitResult.stderr);
  const explicitDate = new Date("2026-01-15");
  const expected = `${explicitDate.getFullYear()}${
    String(
      explicitDate.getMonth() + 1,
    ).padStart(2, "0")
  }${String(explicitDate.getDate()).padStart(2, "0")}`;
  assert.equal((await readDbfRecord(explicit)).SCRQ, expected);

  const fallback = path.join(workdir, "scrq-default.zip");
  const fallbackResult = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "005",
    "-o",
    fallback,
  ]);
  assert.equal(fallbackResult.code, 0, fallbackResult.stderr);
  assert.equal((await readDbfRecord(fallback)).SCRQ, todayString());
});

test("--scdw / --bz 写入 DBF", async () => {
  const out = path.join(workdir, "extras.zip");
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "006",
    "--scdw",
    "XX测绘院",
    "--bz",
    "测试备注",
    "-o",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const values = await readDbfRecord(out);
  assert.equal(values.SCDW, "XX测绘院");
  assert.equal(values.BZ, "测试备注");
});

test("未指定 -o 时默认命名为 {阶段}{DKDM}.zip", async () => {
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "007",
    "-s",
    "详细调查",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /已生成: 详细调查007\.zip/);
  assert.deepEqual(
    await readZipEntries(path.join(workdir, "详细调查007.zip")),
    [
      "详细调查007.cpg",
      "详细调查007.dbf",
      "详细调查007.prj",
      "详细调查007.shp",
      "详细调查007.shx",
    ],
  );
});

test("以 - 从标准输入读取 CSV", async () => {
  const csv = await readFile(CSV_LONLAT, "utf8");
  const out = path.join(workdir, "stdin.zip");
  const result = await runCli(
    ["-", ...BASE_ARGS, "--dkdm", "008", "-o", out],
    csv,
  );
  assert.equal(result.code, 0, result.stderr);
  const values = await readDbfRecord(out);
  assert.equal(values.DKDM, "008");
  assert.equal(values.DH, "39");
});

test("无带号的投影坐标报错并给出提示，且不产出文件", async () => {
  const out = path.join(workdir, "no-zone.zip");
  const result = await runCli([
    CSV_PROJ_NO_ZONE,
    ...BASE_ARGS,
    "--dkdm",
    "201",
    "-o",
    out,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /解析坐标失败/);
  assert.match(result.stderr, /X 缺失带号/);
  assert.match(result.stderr, /坐标_投影 - 无带号\.csv/);
  assert.match(result.stderr, /提示: 投影坐标的 X 需含带号/);
  await assert.rejects(readFile(out), { code: "ENOENT" });
});

test("带号超出 25~45 范围时报错，并提示合法带号范围", async () => {
  const csv = path.join(workdir, "bad-zone.csv");
  await writeFile(
    csv,
    "编号,X,Y\n1,12345678.900,3797916.479\n2,12345696.858,3798076.324\n3,12345849.007,3798062.844\n",
  );
  const result = await runCli([
    csv,
    ...BASE_ARGS,
    "--dkdm",
    "202",
    "-o",
    path.join(workdir, "bad-zone.zip"),
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /带号不在范围内\(25~45\)/);
  assert.match(result.stderr, /提示: 3 度带带号应为 25~45/);
});

test("文本字段超出 DBF 宽度时，点名参数报错（不产出文件）", async () => {
  const out = path.join(workdir, "too-long.zip");
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "203",
    "--xzqdm",
    "3200001234567890",
    "-o",
    out,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--xzqdm 超出 XZQDM 字段宽度/);
  assert.match(result.stderr, /最多 12 字节，当前 16 字节/);
  await assert.rejects(readFile(out), { code: "ENOENT" });
});

test("字段宽度按字节校验（中文占 3 字节）", async () => {
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "204",
    "--xzqdm",
    "示例区示例区",
    "-o",
    path.join(workdir, "too-long-cjk.zip"),
  ]);
  assert.equal(result.code, 1);
  // 6 个汉字 = 18 字节 > XZQDM 的 12 字节
  assert.match(result.stderr, /--xzqdm 超出 XZQDM 字段宽度/);
  assert.match(result.stderr, /当前 18 字节/);
});

test("数值字段过大时，生成阶段报错带上上下文", async () => {
  const out = path.join(workdir, "ydmj-too-large.zip");
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "205",
    "--ydmj",
    "1000000000000000",
    "-o",
    out,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /生成边界文件失败/);
  assert.match(result.stderr, /String length exceeds limit: 17/);
  await assert.rejects(readFile(out), { code: "ENOENT" });
});

test("缺少必填参数时列出全部缺失项，退出码 2", async () => {
  const result = await runCli([CSV_LONLAT, "--dkmc", "示例地块"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /缺少必填参数/);
  assert.match(result.stderr, /--dkdm <地块代码> \(DKDM\)/);
  assert.match(result.stderr, /--xzqmc <行政区名称> \(XZQMC\)/);
  assert.match(result.stderr, /--xzqdm <行政区代码> \(XZQDM\)/);
});

test("非法 --stage 报错，退出码 1", async () => {
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "009",
    "-s",
    "勘测定界",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /无效的 --stage: 勘测定界/);
});

test("未知选项报错，退出码 2", async () => {
  const result = await runCli([
    CSV_LONLAT,
    ...BASE_ARGS,
    "--dkdm",
    "010",
    "--unknown",
    "1",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown option '--unknown'/);
});

test("--version 输出版本号，--help 输出用法", async () => {
  const versionResult = await runCli(["--version"]);
  assert.equal(versionResult.code, 0);
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
    version: string;
  };
  assert.equal(versionResult.stdout.trim(), pkg.version);

  const helpResult = await runCli(["--help"]);
  assert.equal(helpResult.code, 0);
  assert.match(helpResult.stdout, /用法: create-boundary <csv>/);
  assert.match(helpResult.stdout, /--dkmc <名称>/);
});
