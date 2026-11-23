'use strict';
const { app } = require('electron');
const { resolve } = require('node:path');
const { version } = require('../package.json');

const root = resolve(__dirname, '..');
app.setAppPath(root);
app.setVersion(version);
require('../dist/main/index.js');
