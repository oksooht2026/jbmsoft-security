const serverSync = require('./security/server-sync');

console.log('Testing serverSync.syncWithServer() directly...');

serverSync.syncWithServer({
  policyVersion: 1781900176405,
  needsApprovals: true
}).then(result => {
  console.log('\n--- Sync Result ---');
  console.log('Result:', result);
  if (result) {
    console.log('Policy returned:', !!result.policy);
    if (result.policy) {
      console.log('clipboard_monitoring_enabled:', result.policy.clipboard_monitoring_enabled);
    }
  }
}).catch(err => {
  console.error('Error occurred:', err);
});
