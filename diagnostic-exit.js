const { spawn, execSync } = require('child_process');
const path = require('path');

console.log('--- Startup Exit Diagnostic Script ---');

// 1. Kill any existing instances if possible
try {
  execSync('taskkill /F /IM OksooSecurity.exe /T', { stdio: 'ignore', windowsHide: true });
} catch (_) {}
try {
  execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore', windowsHide: true });
} catch (_) {}

// 2. Spawn Electron and print its events
const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
console.log('Spawning Electron directly:', electronPath);

const child = spawn(electronPath, ['.'], {
  cwd: __dirname,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  windowsHide: true
});

child.stdout.on('data', (data) => {
  console.log('[STDOUT]:', data.toString().trim());
});

child.stderr.on('data', (data) => {
  console.error('[STDERR]:', data.toString().trim());
});

child.on('error', (err) => {
  console.error('[ERROR EVENT]:', err);
});

child.on('exit', (code, signal) => {
  console.log(`[EXIT EVENT]: Code = ${code}, Signal = ${signal}`);
});

console.log('Waiting 10 seconds...');
setTimeout(() => {
  console.log('Finished waiting. Killing process if still alive...');
  try {
    process.kill(child.pid, 0);
    console.log('Process is still alive, killing now...');
    execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore', windowsHide: true });
  } catch (e) {
    console.log('Process is already dead or could not be verified.');
  }
}, 10000);
