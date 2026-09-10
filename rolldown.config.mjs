import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/main.ts",
  // 目标是 Node CLI。rolldown 在 format 非 cjs 时默认 platform 为 browser，
  // 会导致 node: 内置模块解析失败并告警，显式声明 node 平台
  platform: "node",
  output: {
    file: "dist/cli.js",
    format: "esm",
    // 依赖中存在动态导入，关闭 code splitting 才能输出单一文件
    codeSplitting: false,
    // 开启 JS 压缩（rolldown 底层使用 Oxc Minifier）
    minify: true,
  },
});
