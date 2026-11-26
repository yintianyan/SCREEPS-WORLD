import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

// 函数名保留策略：内部标识符全部交给 terser；对外只暴露 module.exports.loop。
// 字符串型的系统名/角色名不受标识符压缩影响。
const terserOptions = {
  keep_classnames: false,
  // 启用 terser 对标准 JS 的等价压缩；CI 体积闸要求保留可部署余量。
  compress: { passes: 4, unsafe: true },
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
