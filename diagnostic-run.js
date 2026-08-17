const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('--- Direct Startup Diagnostic Script ---');

// 1. Kill any existing instances if possible
try {
  console.log('Killing existing processes...');
  execSync('taskkill /F /IM OksooSecurity.exe /T', { stdio: 'ignore', windowsHide: true });
} catch (_) {}
try {
  execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore', windowsHide: true });
} catch (_) {}

// 2. Start Electron directly and log stdout/stderr
const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const logPath = path.join(__dirname, 'diagnostic.log');
const logStream = fs.createWriteStream(logPath);

console.log('Starting Electron directly:', electronPath);
const child = spawn(electronPath, ['.'], {
  cwd: __dirname,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  windowsHide: true
});

child.stdout.pipe(logStream);
child.stderr.pipe(logStream);

console.log('Electron process spawned. Waiting 18 seconds for startup sync...');

setTimeout(() => {
  console.log('Terminating Electron process...');
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) {
    console.log('Failed to kill child:', e.message);
  }

  logStream.end();

  setTimeout(() => {
    console.log('\n--- Diagnostic Log Output ---');
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      console.log(logs || '(Log file is empty)');
    } else {
      console.log('Log file does not exist.');
    }
  }, 1000);
}, 18000);
