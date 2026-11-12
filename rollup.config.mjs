import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

// 函数名保留策略：**不再保留模块导出名**。
//
// 对外只暴露 `module.exports.loop`；Rollup 已在打包期把内部 import 静态解析成同一
// 作用域里的标识符，运行时不靠名字查找任何模块导出。此前把每个模块的 renderedExports
// 全塞进 `mangle.reserved`，等于禁止 terser 压缩这些顶层名 —— 实测多付约 49KB，
// 正是把 bundle 顶出 819,200 B 预算的主因（854,786 → 约 805,000）。
// 字符串型的系统名/角色名（bundle-parity 检查的 "traffic-manager" 等）是字面量，
// 不受标识符压缩影响。
const terserOptions = {
  keep_classnames: true,
  compress: { passes: 2 },
  ecma: 2020,
  format: { ecma: 2020 },
  mangle: { reserved: [] },
};

export default {
  input: "src/main.ts",
  // 不产出 sourcemap：官服 5MB 代码上限下 map 独占 3.6MB，不值得占额度。
  output: { file: "dist/main.js", format: "cjs", sourcemap: false },
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json", compilerOptions: { noEmitOnError: true } }),
    // 压缩产物 — 不只是省空间：global reset 时引擎要重新编译整个 bundle，
    // 未压缩 2MB 的加载成本可能超过低 bucket 时的 tickLimit(≈20 CPU)，
    // 与 bucket 清零撞车即触发 reload death loop（加载即被杀、永不回充）。
    terser(terserOptions),
  ],
  treeshake: { moduleSideEffects: false },
};
