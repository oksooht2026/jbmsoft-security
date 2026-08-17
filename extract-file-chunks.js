const fs = require('fs');
const path = require('path');

const logFile = path.join(
  'C:\\Users\\jaewon\\.gemini\\antigravity\\brain\\70e7a1e5-424a-4d0c-9379-f77a3a69e313\\.system_generated\\logs',
  'transcript_full.jsonl'
);

if (!fs.existsSync(logFile)) {
  console.log('Log file does not exist!');
  process.exit(1);
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'VIEW_FILE' && obj.tool_calls?.[0]?.args?.AbsolutePath?.includes('os-engine.js')) {
      console.log(`--- Line ${i} VIEW_FILE: Lines ${obj.tool_calls[0].args.StartLine} to ${obj.tool_calls[0].args.EndLine} ---`);
      console.log(obj.content || obj.tool_calls[0].response);
    }
    if (obj.type === 'PLANNER_RESPONSE') {
      const calls = obj.tool_calls || [];
      for (const call of calls) {
        if (call.name === 'view_file' && call.args?.AbsolutePath?.includes('os-engine.js')) {
          console.log(`--- Line ${i} CALL view_file: Lines ${call.args.StartLine} to ${call.args.EndLine} ---`);
        }
      }
    }
  } catch (e) {
  }
}
