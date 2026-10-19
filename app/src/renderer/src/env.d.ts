/// <reference types="vite/client" />
import type { DesklistBridge } from '../../common/ipc';
declare global { interface Window { desklist: DesklistBridge } }
export {};
