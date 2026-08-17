const fs = require('fs');
const path = require('path');

const logFile = path.join(
  'C:\\Users\\jaewon\\.gemini\\antigravity\\brain\\70e7a1e5-424a-4d0c-9379-f77a3a69e313\\.system_generated\\logs',
  'transcript_full.jsonl'
);

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

const step = JSON.parse(lines[531]);
console.log('Keys of step 531:', Object.keys(step));
console.log('Type:', step.type);
console.log('Source:', step.source);
console.log('Content snippet:', (step.content || '').slice(0, 500));
