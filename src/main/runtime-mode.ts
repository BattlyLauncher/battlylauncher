import { app } from 'electron';

// A branded Electron executable reports isPackaged=true even for `electron .`.
// defaultApp records how it was launched, independently of the executable name.
export const packagedApplication = app.isPackaged && !process.defaultApp;
