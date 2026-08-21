import dotenv from 'dotenv';
dotenv.config();

import { store } from '../lib/store';

async function migrate() {
  console.log('Running Turso / SQLite schema migration...');
  await store.init();
  console.log('Schema migration completed successfully!');
}

migrate().catch(console.error);
