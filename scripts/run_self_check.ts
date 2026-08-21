import { runSelfCheck } from '../lib/self_check';

runSelfCheck()
  .then(() => {
    console.log('Self-check complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Self-check encountered fatal error:', err);
    process.exit(1);
  });
