const { Agent, setGlobalDispatcher } = require('undici');

function configureCoreWorkerHttp() {
  // Keep native fetch and its Web API types, but use the fixed HTTP parser in this worker.
  // https://github.com/nodejs/undici/issues/5360
  setGlobalDispatcher(new Agent());
}

module.exports = { configureCoreWorkerHttp };
