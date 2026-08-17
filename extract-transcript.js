const fs = require('fs');
const path = require('path');

const logFile = path.join(
  'C:\\Users\\jaewon\\.gemini\\antigravity\\brain\\70e7a1e5-424a-4d0c-9379-f77a3a69e313\\.system_generated\\logs',
  'transcript_full.jsonl'
);

console.log('Reading full transcript from:', logFile);

if (!fs.existsSync(logFile)) {
  console.log('Log file does not exist!');
  process.exit(1);
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n');
console.log(`Read ${lines.length} lines.`);

// Search for the step where security/os-engine.js is read or modified
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    const content = JSON.stringify(obj);
    if (content.includes('security/os-engine.js') || content.includes('os-engine.js')) {
      console.log(`Line ${i} matches! Type: ${obj.type}, Source: ${obj.source}`);
      // If it contains a tool call or response with large text
      if (obj.tool_calls) {
        console.log('Tool calls:', JSON.stringify(obj.tool_calls).slice(0, 300));
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
}
