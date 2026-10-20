import { installBridge } from './host';
import './shell.css';

await installBridge();
await import('../../app/src/renderer/src/main.tsx');
