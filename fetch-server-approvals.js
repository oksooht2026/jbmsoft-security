const serverSync = require('./security/server-sync');

async function run() {
  try {
    const list = await serverSync.fetchApprovals();
    console.log(JSON.stringify(list, null, 2));
  } catch (e) {
    console.error(e);
  }
}

run();
