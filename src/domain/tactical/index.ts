/**
 * Tactical Combat Domain — A5.4.0/A5.4.1 barrel.
 *
 * 纯函数律：本模块所有文件不引用 Game / Memory / RawMemory / Kernel / Spawn / Transport / Recovery。
 * 所有运行时数据由调用方（系统层薄壳）注入为 Snapshot / DTO。
 */

// ─── 类型定义 ───
export * from "./types";

// ─── 授权 ───
export * from "./authorization";

// ─── 状态机 ───
export * from "./state-machine";

// ─── 阵型 ───
export * from "./formation";

// ─── A5.4.1 Role Intent 映射 + 生命周期 ───
export * from "./role-intent";

// ─── A5.4.2 Squad Formation & Tactical Movement ───
export * from "./squad-formation";

// ─── A5.4.3 Tactical Engagement & Focus Fire ───
export * from "./focus-fire";
