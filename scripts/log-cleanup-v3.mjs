#!/usr/bin/env node
/**
 * 日志治理脚本 v3 — 最简版：只处理单行 console.log，跳过多行。
 * 多行 console.log 标记后手动处理。
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  `grep -rl "console\\.log" --include="*.ts" src/ | grep -v "kernel/log\\.ts"`,
  { cwd: process.cwd() }
).toString().trim().split('\n').filter(Boolean);

function getModuleName(filePath) {
  const parts = filePath.replace(/\.ts$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

function getImportPath(filePath) {
  if (filePath.startsWith('src/kernel/')) return `import { log } from "./log";`;
  if (filePath.startsWith('src/systems/') || filePath.startsWith('src/telemetry/')) return `import { log } from "../kernel/log";`;
  if (filePath.startsWith('src/creeps/') || filePath.startsWith('src/domain/')) return `import { log } from "../kernel/log";`;
  return `import { log } from "./kernel/log";`;
}

function hasLogImport(content) {
  return /import\s+\{[^}]*\blog\b[^}]*\}\s+from\s+["'].*\/log["']/.test(content);
}

function findLastImportLine(lines) {
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
      // 找到这个 import 语句的结束行（以 ; 结尾）
      for (let k = i; k < Math.min(lines.length, i + 20); k++) {
        if (lines[k].includes(';')) {
          lastImportLine = k;
          break;
        }
      }
    }
  }
  return lastImportLine;
}

let totalReplaced = 0;
let filesProcessed = 0;
let multiLineSkipped = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const moduleName = getModuleName(file);
  const newLines = [];
  let replacementCount = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 块注释跟踪
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

    // 跳过行注释
    if (trimmed.startsWith('//')) {
      newLines.push(line);
      continue;
    }
    // 跳过 JSDoc 中的提及
    if (trimmed.startsWith('*')) {
      newLines.push(line);
      continue;
    }

    const idx = line.indexOf('console.log');
    if (idx === -1) {
      newLines.push(line);
      continue;
    }

    // 检查是否在模板字符串中
    const beforeCall = line.substring(0, idx);
    const backtickCount = (beforeCall.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) {
      newLines.push(line);
      continue;
    }

    // 检查是否是单行调用：console.log(...);
    const afterCall = line.substring(idx + 'console.log'.length);
    // 简单检查：同行有 ); 
    if (!afterCall.includes(');')) {
      // 多行调用 — 标记跳过
      multiLineSkipped++;
      newLines.push(line);
      continue;
    }

    // 单行调用：提取参数
    const parenStart = afterCall.indexOf('(');
    if (parenStart === -1) {
      newLines.push(line);
      continue;
    }

    // 提取 ( 到最后一个 ) 之间的内容
    const lastParen = afterCall.lastIndexOf(')');
    if (lastParen === -1) {
      newLines.push(line);
      continue;
    }

    let args = afterCall.substring(parenStart + 1, lastParen).trim();

    // 去掉 [tick] / [Game.time] 前缀
    args = args
      .replace(/^`\[\$\{ctx\.tick\}\]\s*/, '`')
      .replace(/^`\[\$\{Game\.time\}\]\s*/, '`')
      .replace(/^"\[\d+\]\s*/, '"')
      .replace(/^`\[\$\{[^}]+\}\]\s*/, '`');

    // 判断级别
    const lowerArgs = args.toLowerCase();
    let level = 'info';
    if (lowerArgs.includes('warn')) level = 'warn';
    else if (lowerArgs.includes('error') || lowerArgs.includes('fail') || lowerArgs.includes('abort')) level = 'error';

    const indent = line.substring(0, idx);
    const replacement = `${indent}log.${level}("${moduleName}", ${args});`;
    newLines.push(replacement);
    replacementCount++;
  }

  if (replacementCount === 0) continue;

  let newContent = newLines.join('\n');

  // 添加 log import
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
  console.log(`✓ ${file}: ${replacementCount} single-line replacement(s)`);
  totalReplaced += replacementCount;
  filesProcessed++;
}

console.log(`\nDone: ${totalReplaced} single-line replacements in ${filesProcessed} files`);
console.log(`Skipped: ${multiLineSkipped} multi-line console.log calls (need manual fix)`);
