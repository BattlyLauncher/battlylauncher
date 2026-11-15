const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Windows may briefly deny access while another process inspects a report.
// Never truncate the previous report, or hide a persistent filesystem error.
function writeAuditReport(filename, content, options = {}) {
  const io = options.fs || fs;
  const sleep =
    options.sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const retryable = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN']);
  function retry(operation) {
    for (let attempt = 0; ; attempt++) {
      try {
        return operation();
      } catch (error) {
        if (!retryable.has(error.code) || attempt >= 5) throw error;
        sleep(50 * (attempt + 1));
      }
    }
  }
  const target = path.resolve(filename);
  try {
    if (retry(() => io.readFileSync(target, 'utf8')) === content) return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    retry(() => io.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w' }));
    retry(() => io.renameSync(temporary, target));
    return true;
  } finally {
    try {
      retry(() => io.unlinkSync(temporary));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = { writeAuditReport };
