import { installBridge } from './host';

await installBridge();
await import('../../app/src/renderer/src/main.tsx');
