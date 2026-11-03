// Copies the engine into site/engine so the page runs the very same modules as the tests.
import { cpSync, rmSync } from 'node:fs';
const dst = new URL('../site/engine/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(new URL('../engine/', import.meta.url), dst, { recursive: true });
console.log('engine copied to site/engine');
