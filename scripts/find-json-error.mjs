#!/usr/bin/env node
import fs from 'node:fs';

const [filePath, posArg] = process.argv.slice(2);

if (!filePath || !posArg) {
  console.error('Usage: node scripts/find-json-error.mjs <file> <position>');
  process.exit(1);
}

const position = Number(posArg);
if (!Number.isInteger(position) || position < 0) {
  console.error('Position must be a non-negative integer.');
  process.exit(1);
}

const text = fs.readFileSync(filePath, 'utf8');
const start = Math.max(0, position - 120);
const end = Math.min(text.length, position + 120);
const context = text.slice(start, end);

let line = 1;
let col = 1;
for (let i = 0; i < Math.min(position, text.length); i++) {
  if (text[i] === '\n') {
    line++;
    col = 1;
  } else {
    col++;
  }
}

console.log(`File     : ${filePath}`);
console.log(`Position : ${position}`);
console.log(`Line/Col : ${line}:${col}`);
console.log('--- Context ---');
console.log(context.replace(/\n/g, '\\n\n'));
console.log('---------------');

try {
  JSON.parse(text);
  console.log('JSON.parse: OK');
} catch (err) {
  console.log(`JSON.parse: ${err.message}`);
}
