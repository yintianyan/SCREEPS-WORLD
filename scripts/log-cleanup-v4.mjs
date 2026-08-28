#!/usr/bin/env node
/**
 * 日志治理脚本 v4 — 处理多行 console.log 调用。
 * 用字符级扫描精确匹配括号，确保正确提取多行参数。
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

function hasLogImport(content) {
  return /import\s+\{[^}]*\blog\b[^}]*\}\s+from\s+["'].*\/log["']/.test(content);
}

function findLastImportLine(lines) {
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
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

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const moduleName = getModuleName(file);
  const replacements = []; // { startLine, endLine, replacement }

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 块注释跟踪
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.endsWith('*/')) {
      inBlockComment = true;
      continue;
    }

    // 跳过行注释和 JSDoc
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    const idx = line.indexOf('console.log');
    if (idx === -1) continue;

    // 检查是否在模板字符串中
    const beforeCall = line.substring(0, idx);
    const backtickCount = (beforeCall.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) continue;

    // 找到 console.log 后的 (
    const afterCall = line.substring(idx + 'console.log'.length);
    const parenOffset = afterCall.indexOf('(');
    if (parenOffset === -1) continue;

    // 从 ( 开始字符级扫描，找到匹配的 )
    let globalCharIdx = idx + 'console.log'.length + parenOffset; // 在整个 content 中的位置
    // 计算行偏移和列偏移
    let charPos = 0;
    let startLine = i;
    let startCol = 0;
    for (let l = 0; l < i; l++) {
      charPos += lines[l].length + 1; // +1 for \n
    }
    // 在第 i 行中找到 ( 的列位置
    startCol = idx + 'console.log'.length + parenOffset;

    // 从 startLine, startCol 开始扫描
    let depth = 0;
    let started = false;
    let endLine = -1;
    let endCol = -1;

    for (let l = i; l < lines.length && endLine === -1; l++) {
      const lineText = l === i ? lines[l].substring(startCol) : lines[l];
      const colOffset = l === i ? startCol : 0;
      for (let c = 0; c < lineText.length; c++) {
        const ch = lineText[c];
        if (ch === '(') { depth++; started = true; }
        if (ch === ')') {
          depth--;
          if (started && depth === 0) {
            endLine = l;
            endCol = colOffset + c;
            break;
          }
        }
      }
    }

    if (endLine === -1) continue; // 未找到匹配括号，跳过

    // 提取参数文本：从 ( 后到 ) 前
    let args = '';
    for (let l = i; l <= endLine; l++) {
      let lineText = lines[l];
      if (l === i && l === endLine) {
        // 单行：提取 ( 后到 ) 前
        args = lineText.substring(startCol + 1, endCol);
      } else if (l === i) {
        // 首行：( 之后到行尾
        args = lineText.substring(startCol + 1) + '\n';
      } else if (l === endLine) {
        // 末行：行首到 ) 前
        args += lineText.substring(0, endCol);
      } else {
        // 中间行：整行
        args += lineText + '\n';
      }
    }

    args = args.trim();

    // 去掉 [tick] 前缀
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

    // 确定缩进
    const indent = line.substring(0, idx);

    // 构建替换文本
    let replacement;
    if (args.includes('\n')) {
      // 多行参数：格式化
      replacement = `${indent}log.${level}("${moduleName}", ${args});`;
    } else {
      replacement = `${indent}log.${level}("${moduleName}", ${args});`;
    }

    // 检查 ) 之后是否还有代码（如 ; 后面的内容）
    const afterParen = lines[endLine].substring(endCol + 1);
    if (afterParen.trim() === ';' || afterParen.trim() === '') {
      // 正常：) 后只有 ; 或空
    } else if (afterParen.trim().startsWith(';')) {
      // ) 后有 ; 和其他代码 — 不常见，保留
    }

    replacements.push({ startLine: i, endLine, replacement });
  }

  if (replacements.length === 0) continue;

  // 构建新文件
  const newLines = [];
  let skipUntil = -1;

  for (let i = 0; i < lines.length; i++) {
    if (i < skipUntil) continue;
    if (i === skipUntil) { skipUntil = -1; continue; }

    const rep = replacements.find(r => r.startLine === i);
    if (rep) {
      newLines.push(rep.replacement);
      skipUntil = rep.endLine;
      // 跳过 endLine（但如果 endLine 后还有 ; 行则不跳过）
      // 实际上 endLine 是 ) 所在行，replacement 已包含 ; 所以跳过
    } else {
      newLines.push(lines[i]);
    }
  }

  let newContent = newLines.join('\n');

  // 添加 log import
  if (!hasLogImport(newContent)) {
    const importPath = file.startsWith('src/kernel/') 
      ? `import { log } from "./log";`
      : file.startsWith('src/systems/intelligence/')
      ? `import { log } from "../../kernel/log";`
      : (file.startsWith('src/systems/') || file.startsWith('src/telemetry/') || file.startsWith('src/creeps/') || file.startsWith('src/domain/'))
      ? `import { log } from "../kernel/log";`
      : `import { log } from "./kernel/log";`;
    
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
