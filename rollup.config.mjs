import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

// 函数名保留策略：只保留模块导出名，内部辅助函数交给 terser 压缩。
// 全量 keep_fnames 要多付约 70KB，已把 bundle 顶出预算（800KiB 门禁）。
const terserOptions = {
  keep_classnames: true,
  compress: { passes: 2 },
  ecma: 2020,
  format: { ecma: 2020 },
  mangle: { reserved: [] },
};

/** 收集本 chunk 实际保留的模块导出名，供 mangle.reserved 使用。 */
const keepRenderedExports = () => ({
  name: "keep-rendered-exports",
  renderChunk(_code, chunk) {
    const names = new Set();
    for (const mod of Object.values(chunk.modules)) {
      for (const name of mod.renderedExports ?? []) names.add(name);
    }
    terserOptions.mangle.reserved = [...names];
    return null;
  },
});

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
    keepRenderedExports(),
    terser(terserOptions),
  ],
  treeshake: { moduleSideEffects: false },
};
