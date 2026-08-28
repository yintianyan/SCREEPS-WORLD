import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/main.ts",
  output: { file: "dist/main.js", format: "cjs", sourcemap: true },
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json", compilerOptions: { noEmitOnError: true } }),
    // 压缩产物 — 不只是省空间：global reset 时引擎要重新编译整个 bundle，
    // 未压缩 2MB 的加载成本可能超过低 bucket 时的 tickLimit(≈20 CPU)，
    // 与 bucket 清零撞车即触发 reload death loop（加载即被杀、永不回充）。
    // 保留函数名/类名 — 游戏内错误堆栈可读性优先于极限压缩率。
    terser({ keep_fnames: true, keep_classnames: true }),
  ],
  treeshake: { moduleSideEffects: false },
};
