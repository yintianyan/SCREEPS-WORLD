import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // ── 基础规则集 ──────────────────────────────────────────────
  js.configs.recommended,

  // ── Prettier 接管格式 ──────────────────────────────────────
  // eslint-config-prettier 关闭所有与 Prettier 冲突的 ESLint 规则。
  // 格式校验由 prettier CLI（npm run format:check）和 lint-staged 负责，
  // ESLint 不再重复报告格式偏差，专注于代码质量与逻辑正确性。
  prettierConfig,

  // ── 项目源码与测试（类型感知 lint） ────────────────────────
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigPath: "./tsconfig.json",
      },
      globals: {
        // Screeps 运行时全局对象
        Game: "readonly",
        Memory: "readonly",
        RawMemory: "readonly",
        PathFinder: "readonly",
        InterShell: "readonly",
        _: "readonly",
        console: "readonly",
        // Node.js 测试环境
        require: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      // ── TypeScript 严格规则 ────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
          disallowTypeAnnotations: false,
        },
      ],
      // 允许 import() 类型表达式（用于避免循环依赖的类型引用）
      "@typescript-eslint/no-import-module-types": "off",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-var-requires": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/no-loss-of-precision": "error",
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-confusing-non-null-assertion": "warn",
      // 项目中大量使用 Record<string, ...> 和索引访问，放宽此规则
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      // ── 通用逻辑规则 ───────────────────────────────────────
      "no-debugger": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-case-declarations": "error",
      "no-unsafe-finally": "error",
      "no-console": "off",
      "no-cond-assign": "error",
      "no-constant-condition": "error",
      "no-control-regex": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-ex-assign": "error",
      "no-extra-boolean-cast": "error",
      "no-fallthrough": "error",
      "no-func-assign": "error",
      "no-irregular-whitespace": "error",
      "no-obj-calls": "error",
      "no-prototype-builtins": "error",
      "no-return-assign": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-sparse-arrays": "error",
      "no-unreachable": "error",
      "no-useless-catch": "error",
      "no-with": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-async-promise-executor": "error",
      "no-class-assign": "error",
      "no-const-assign": "error",
      "no-delete-var": "error",
      "no-shadow-restricted-names": "error",
      // TypeScript 项目中 no-undef 由 tsc 负责；
      // ESLint 的 no-undef 无法识别 .d.ts 中的全局类型（Screeps 运行时类型）
      "no-undef": "off",
      "no-unused-labels": "error",
      "no-unused-expressions": "warn",
      "no-useless-concat": "warn",
      "no-useless-rename": "warn",
      "no-useless-return": "warn",
      "prefer-template": "warn",
      "prefer-arrow-callback": "warn",
      "object-shorthand": "warn",
    },
  },

  // ── 非 TS 文件：禁用类型感知规则 ──────────────────────────
  tseslint.configs.disableTypeChecked,
  {
    files: ["*.mjs", "*.cjs", "*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // ── 忽略目录 ───────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tmp/**",
      "tools/**",
      "scripts/**",
      "coverage/**",
      ".husky/**",
      "*.config.mjs",
    ],
  },
);
