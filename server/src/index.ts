import { createDb, SCHEMA } from './db.js';
import { createServer } from './app.js';
import { encryptionKey } from './env.js';

encryptionKey(); // fail fast if missing
const db = createDb();
const { server } = createServer({ db });
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`[desklist] sync server on :${port} (db driver=${db.driver}, schema=${SCHEMA})`));
const stop = () => server.close(() => db.close().then(() => process.exit(0)));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
