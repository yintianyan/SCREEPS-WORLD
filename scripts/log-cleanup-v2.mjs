#!/usr/bin/env node
/**
 * 日志治理脚本 v2 — 更可靠的 console.log → log 门面替换。
 * 改进：
 * - 用 AST-free 但更稳健的行扫描，正确处理多行 console.log
 * - import 插入：找到文件中最后一个 import 语句的行号，在其后插入
 * - 精确匹配多行括号配对
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// 获取所有包含 console.log 的 .ts 文件（排除 log.ts）
const files = execSync(
  `grep -rl "console\\.log" --include="*.ts" src/ | grep -v "kernel/log\\.ts"`,
  { cwd: process.cwd() }
).toString().trim().split('\n').filter(Boolean);

function getModuleName(filePath) {
  const parts = filePath.replace(/\.ts$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

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

// 检查文件是否已有 log import
function hasLogImport(content) {
  return /import\s+\{[^}]*\blog\b[^}]*\}\s+from\s+["'].*\/log["']/.test(content);
}

// 找到最后一个 import 语句的行号
function findLastImportLine(lines) {
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
      // 检查 import 是否跨行
      let j = i;
      // 简单检查：如果行末不是 ; 则继续找
      while (j < lines.length && !lines[j].includes(';') && !lines[j].includes("from '") && j < i + 10) {
        j++;
      }
      // 真正找以 ; 结尾的行
      let endLine = i;
      for (let k = i; k < Math.min(lines.length, i + 20); k++) {
        if (lines[k].includes(';')) {
          endLine = k;
          break;
        }
      }
      lastImportLine = endLine;
    }
  }
  return lastImportLine;
}

// 从一行内容中提取 console.log 的参数部分（console.log( 之后到行尾）
// 返回 null 如果这行不包含 console.log 调用
function processConsoleLog(lines, startIdx, moduleName) {
  const line = lines[startIdx];
  const idx = line.indexOf('console.log');
  if (idx === -1) return null;

  // 获取 console.log( 之后的文本
  const afterCall = line.substring(idx + 'console.log'.length);

  // 检查是否紧跟 (
  if (!afterCall.trimStart().startsWith('(')) return null;

  // 收集从 ( 到匹配 ) 的所有行
  let fullArgs = '';
  let parenDepth = 0;
  let started = false;
  let endLine = startIdx;

  for (let j = startIdx; j < lines.length; j++) {
    const l = j === startIdx ? afterCall : lines[j];
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

  // 提取参数文本
  for (let j = startIdx; j <= endLine; j++) {
    let l = j === startIdx ? afterCall : lines[j];
    if (j === endLine) {
      // 去掉最后的 ) 和之后的内容
      const lastParen = l.lastIndexOf(')');
      if (lastParen >= 0) l = l.substring(0, lastParen);
    }
    if (j === startIdx) {
      // 去掉开头的 (
      const firstParen = l.indexOf('(');
      if (firstParen >= 0) l = l.substring(firstParen + 1);
    }
    fullArgs += l + (j < endLine ? '\n' : '');
  }

  fullArgs = fullArgs.trim();

  // 去掉 [tick] / [Game.time] / [ctx.tick] 前缀（log 门面已加时间戳）
  fullArgs = fullArgs
    .replace(/^`\[\$\{ctx\.tick\}\]\s*/, '`')
    .replace(/^`\[\$\{Game\.time\}\]\s*/, '`')
    .replace(/^`\[\$\{[^}]+\}\]\s*/, '`')
    .replace(/^"\[\d+\]\s*/, '"');

  // 判断日志级别
  const lowerArgs = fullArgs.toLowerCase();
  let level = 'info';
  if (lowerArgs.includes('warn') || lowerArgs.includes('warning')) level = 'warn';
  else if (lowerArgs.includes('error') || lowerArgs.includes('fail') || lowerArgs.includes('abort')) level = 'error';

  const indent = line.substring(0, idx);
  const replacement = `${indent}log.${level}("${moduleName}", ${fullArgs});`;

  return { replacement, endLine };
}

let totalReplaced = 0;
let filesProcessed = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const moduleName = getModuleName(file);
  const replacements = []; // { lineIdx, endLine, replacement }

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 块注释跟踪
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.endsWith('*/')) {
      inBlockComment = true;
      continue;
    }

    // 跳过行注释
    if (trimmed.startsWith('//') && trimmed.includes('console.log')) continue;

    // 跳过注释中提及 console.log 的文本
    if (trimmed.includes('*') && trimmed.includes('console.log')) continue;

    // 检查是否有 console.log 调用（排除字符串中的 console.log）
    const line = lines[i];
    const idx = line.indexOf('console.log');
    if (idx === -1) continue;

    // 排除在字符串中的（简单检查：前面有引号）
    const beforeCall = line.substring(0, idx);
    const lastQuote = Math.max(beforeCall.lastIndexOf('"'), beforeCall.lastIndexOf("'"), beforeCall.lastIndexOf('`'));
    const lastBacktick = beforeCall.lastIndexOf('`');
    // 粗略检查是否在模板字符串中
    const backtickCount = (beforeCall.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) continue; // 在模板字符串中

    const result = processConsoleLog(lines, i, moduleName);
    if (result) {
      replacements.push({ lineIdx: i, endLine: result.endLine, replacement: result.replacement });
    }
  }

  if (replacements.length === 0) continue;

  // 构建新文件内容
  const newLines = [];
  let skipUntil = -1;

  for (let i = 0; i < lines.length; i++) {
    if (i <= skipUntil) continue;

    const rep = replacements.find(r => r.lineIdx === i);
    if (rep) {
      newLines.push(rep.replacement);
      skipUntil = rep.endLine;
    } else {
      newLines.push(lines[i]);
    }
  }

  let newContent = newLines.join('\n');

  // 添加 log import（如果没有）
  if (!hasLogImport(newContent)) {
    const importPath = getImportPath(file);
    const newLines2 = newContent.split('\n');
    const lastImportIdx = findLastImportLine(newLines2);
    if (lastImportIdx >= 0) {
      newLines2.splice(lastImportIdx + 1, 0, importPath);
    } else {
      newLines2.unshift(importPath);
    }
    newContent = newLines2.join('\n');
  }

  writeFileSync(file, newContent, 'utf8');
  console.log(`✓ ${file}: ${replacements.length} replacement(s)`);
  totalReplaced += replacements.length;
  filesProcessed++;
}

console.log(`\nDone: ${totalReplaced} replacements in ${filesProcessed} files`);
