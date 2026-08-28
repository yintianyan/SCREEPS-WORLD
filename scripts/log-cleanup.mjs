#!/usr/bin/env node
/**
 * 日志治理脚本 — 将 src/ 中的 console.log 调用替换为统一 log 门面。
 * 规则：
 * - console.log("[level]...") → log.warn / log.error / log.info (按内容关键词)
 * - console.log(`[xx] ...`) → log.info(moduleName, `...`)（去掉 [xx] 前缀，log 门面已加 [tTick][LEVEL][module]）
 * - log.ts 自身的 console.log 跳过（它是最终 sink）
 * - 注释中的 console.log 跳过
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// 获取所有包含 console.log 的 .ts 文件（排除 log.ts）
const files = execSync(
  `grep -rl "console\\.log" --include="*.ts" src/ | grep -v "log\\.ts"`,
  { cwd: process.cwd() }
).toString().trim().split('\n').filter(Boolean);

const LOG_IMPORT = `import { log } from "../kernel/log";`;
const LOG_IMPORT_KERNEL = `import { log } from "./log";`;
const LOG_IMPORT_FROM_ROOT = `import { log } from "./kernel/log";`;

// 从文件路径推断 module 名（去掉 .ts，取 basename）
function getModuleName(filePath) {
  const parts = filePath.replace(/\.ts$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

// 判断文件在哪个目录层级，决定 import 路径
function getImportPath(filePath) {
  if (filePath.startsWith('src/kernel/')) {
    return `import { log } from "./log";`;
  } else if (filePath.startsWith('src/systems/') || filePath.startsWith('src/telemetry/')) {
    return `import { log } from "../kernel/log";`;
  } else if (filePath.startsWith('src/creeps/') || filePath.startsWith('src/domain/')) {
    return `import { log } from "../kernel/log";`;
  } else {
    return `import { log } from "./kernel/log";`;
  }
}

let totalReplaced = 0;
let filesProcessed = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let modified = false;
  let fileReplacements = 0;

  // 检查是否已有 log import
  const hasLogImport = /import\s+\{[^}]*\blog\b[^}]*\}\s+from\s+["'].*log["']/.test(content);

  // 收集所有 console.log 调用的位置（排除注释）
  const lines = content.split('\n');
  const newLines = [];
  let inBlockComment = false;
  let skipNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过块注释
    if (inBlockComment) {
      newLines.push(line);
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.endsWith('*/')) {
      inBlockComment = true;
      newLines.push(line);
      continue;
    }

    // 跳过行注释中的 console.log
    if (trimmed.startsWith('//') && trimmed.includes('console.log')) {
      newLines.push(line);
      continue;
    }

    // 匹配 console.log 调用
    const consoleLogIdx = line.indexOf('console.log');
    if (consoleLogIdx === -1) {
      newLines.push(line);
      continue;
    }

    // 这行是实际 console.log 调用
    // 判断日志级别：含 WARN/ERROR/warn/error 的用 warn/error
    const lowerLine = line.toLowerCase();
    let level = 'info';
    if (lowerLine.includes('warn')) level = 'warn';
    else if (lowerLine.includes('error') || lowerLine.includes('fail')) level = 'error';

    const moduleName = getModuleName(file);

    // 提取 console.log 后的参数
    const afterConsole = line.substring(consoleLogIdx + 'console.log'.length);

    // 多行调用的情况：参数可能在后续行
    // 检查是否是单行调用（以 ); 结尾）
    if (afterConsole.includes(');') && afterConsole.indexOf(');') === afterConsole.lastIndexOf(');')) {
      // 单行调用
      const argsMatch = afterConsole.match(/^\((.*)\);?\s*$/);
      if (argsMatch) {
        const args = argsMatch[1].trim();
        // 去掉 [tick] 或 [Game.time] 前缀（log 门面已加 [tTick]）
        let cleanArgs = args
          .replace(/^`\[\$\{[^}]+\}\]\s*/, '`')
          .replace(/^"\[\d+\]\s*/, '"')
          .replace(/^`\[\$\{ctx\.tick\}\]\s*/, '`')
          .replace(/^`\[\$\{Game\.time\}\]\s*/, '`');

        const replacement = `log.${level}("${moduleName}", ${cleanArgs});`;
        newLines.push(line.substring(0, consoleLogIdx) + replacement);
        fileReplacements++;
        modified = true;
        continue;
      }
    }

    // 多行调用：找匹配的右括号
    let fullCall = line.substring(consoleLogIdx);
    let endLine = i;
    let parenDepth = 0;
    let started = false;
    for (let j = i; j < lines.length; j++) {
      const l = j === i ? line.substring(consoleLogIdx) : lines[j];
      for (const ch of l) {
        if (ch === '(') { parenDepth++; started = true; }
        if (ch === ')') parenDepth--;
        if (started && parenDepth === 0) {
          endLine = j;
          break;
        }
      }
      if (endLine > 0 && j >= endLine) break;
    }

    if (endLine > i) {
      // 多行 console.log — 收集所有行
      let allArgs = '';
      for (let j = i; j <= endLine; j++) {
        const l = j === i ? lines[j].substring(consoleLogIdx + 'console.log'.length) : lines[j];
        allArgs += l + '\n';
      }
      // 去掉外层括号
      allArgs = allArgs.trim();
      if (allArgs.startsWith('(')) allArgs = allArgs.substring(1);
      if (allArgs.endsWith(');')) allArgs = allArgs.substring(0, allArgs.length - 2);
      else if (allArgs.endsWith(')')) allArgs = allArgs.substring(0, allArgs.length - 1);

      // 去掉 [tick] 前缀
      allArgs = allArgs
        .replace(/^`\[\$\{[^}]+\}\]\s*/, '`')
        .replace(/^`\[\$\{ctx\.tick\}\]\s*/, '`')
        .replace(/^`\[\$\{Game\.time\}\]\s*/, '`');

      const indent = line.substring(0, consoleLogIdx);
      const replacement = `log.${level}("${moduleName}", ${allArgs});`;
      newLines.push(indent + replacement);
      // 跳过已处理的行
      for (let j = i + 1; j <= endLine; j++) {
        // 标记这些行为已处理
      }
      i = endLine;
      fileReplacements++;
      modified = true;
      continue;
    }

    // fallback：保持原样
    newLines.push(line);
  }

  if (modified) {
    let newContent = newLines.join('\n');

    // 添加 log import（如果没有）
    if (!hasLogImport) {
      const importPath = getImportPath(file);
      // 找到最后一个 import 行
      const importMatch = newContent.match(/^import.*$/gm);
      if (importMatch && importMatch.length > 0) {
        const lastImport = importMatch[importMatch.length - 1];
        newContent = newContent.replace(lastImport, lastImport + '\n' + importPath);
      } else {
        // 没有 import，加到文件头
        newContent = importPath + '\n' + newContent;
      }
    }

    writeFileSync(file, newContent, 'utf8');
    console.log(`✓ ${file}: ${fileReplacements} replacement(s)`);
    totalReplaced += fileReplacements;
    filesProcessed++;
  }
}

console.log(`\nDone: ${totalReplaced} replacements in ${filesProcessed} files`);
