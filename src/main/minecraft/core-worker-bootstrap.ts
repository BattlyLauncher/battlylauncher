import Module, { createRequire } from 'node:module';

// Each worker has its own module search paths, including when its code is a patch.
const initializePaths = Reflect.get(Module, '_initPaths') as () => void;
initializePaths();
const loadWorker = createRequire(__filename);
loadWorker('./core-launch-worker.js');
