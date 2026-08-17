const fs = require('fs');
const path = require('path');

const logFile = path.join(
  'C:\\Users\\jaewon\\.gemini\\antigravity\\brain\\70e7a1e5-424a-4d0c-9379-f77a3a69e313\\.system_generated\\logs',
  'transcript_full.jsonl'
);

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

const fileLines = new Array(827).fill(null);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'PLANNER_RESPONSE') {
      const calls = obj.tool_calls || [];
      for (const call of calls) {
        if (call.name === 'view_file' && call.args?.AbsolutePath?.includes('os-engine.js')) {
          const startLine = call.args.StartLine || 1;
          const endLine = call.args.EndLine || 800;
          
          // The next step has the content
          const nextLine = lines[i + 1];
          if (nextLine) {
            const nextObj = JSON.parse(nextLine);
            if (nextObj.type === 'VIEW_FILE') {
              const fileContent = nextObj.content || '';
              const contentLines = fileContent.split('\n');
              for (const cl of contentLines) {
                const match = cl.match(/^\s*(\d+):\s(.*)/);
                if (match) {
                  const lineNum = parseInt(match[1], 10);
                  const lineText = match[2];
                  fileLines[lineNum] = lineText;
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
  }
}

// Check if we have any missing lines
const missing = [];
for (let i = 1; i <= 826; i++) {
  if (fileLines[i] === null) {
    missing.push(i);
  }
}

console.log('Missing lines:', missing.length);
if (missing.length > 0) {
  console.log('First few missing lines:', missing.slice(0, 20));
} else {
  console.log('All 826 lines successfully extracted!');
  const reconstructed = fileLines.slice(1).join('\n');
  fs.writeFileSync('d:\\JBMSOFT_Security\\security\\os-engine.js', reconstructed, 'utf8');
  console.log('Reconstructed file saved to security/os-engine.js!');
}
