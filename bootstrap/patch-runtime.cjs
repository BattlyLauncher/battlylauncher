'use strict';
// This verifier ships with the installer and is deliberately outside the patchable tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGitHubFeed } = require('./github-patch-feed.cjs');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const safePath = (name) =>
  typeof name === 'string' &&
  name.length < 240 &&
  /^dist\/(main|shared|preload|renderer)\/[a-zA-Z0-9_./@-]+$/.test(name) &&
  name
    .split('/')
    .every(
      (s) =>
        s && s !== '.' && s !== '..' && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s),
    ) &&
  !/\.(node|exe|dll|bat|cmd|ps1)$/i.test(name);
function verifyEnvelope(envelope, config, fresh = true) {
  if (
    !config.publicKey ||
    !envelope ||
    typeof envelope.payload !== 'string' ||
    envelope.payload.length > 2_000_000 ||
    typeof envelope.signature !== 'string' ||
    envelope.signature.length > 128
  ) {
    throw Error('Manifiesto de parche inválido');
  }
  const bytes = Buffer.from(envelope.payload, 'base64');
  const key = crypto.createPublicKey(config.publicKey);
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !crypto.verify(null, bytes, key, Buffer.from(envelope.signature, 'base64'))
  ) {
    throw Error('Firma del parche inválida');
  }
  const m = JSON.parse(bytes.toString('utf8'));
  if (
    m.patchVersion !== undefined &&
    (typeof m.patchVersion !== 'string' ||
      !/^[0-9A-Za-z.+-]{1,100}$/.test(m.patchVersion) ||
      m.baseVersion !== config.version)
  ) {
    throw Error('Parche incompatible o caducado');
  }
  if (
    m.schema !== 1 ||
    !['stable', 'beta'].includes(m.channel) ||
    m.runtimeId !== config.runtimeId ||
    m.platform !== config.platform ||
    m.arch !== config.arch ||
    !Number.isSafeInteger(m.build) ||
    m.build <= config.baseBuild ||
    typeof m.notes !== 'string' ||
    m.notes.length > 4000 ||
    !Number.isFinite(Date.parse(m.expiresAt)) ||
    (fresh && Date.parse(m.expiresAt) <= Date.now()) ||
    !Array.isArray(m.files) ||
    m.files.length < 3 ||
    m.files.length > 15000
  ) {
    throw Error('Parche incompatible o caducado');
  }
  const names = new Set();
  let total = 0;
  for (const f of m.files) {
    if (
      !f ||
      !safePath(f.path) ||
      names.has(f.path.toLowerCase()) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > MAX_FILE
    ) {
      throw Error('Archivo de parche inválido');
    }
    names.add(f.path.toLowerCase());
    total += f.size;
    if (total > MAX_TOTAL) {
      throw Error('Parche demasiado grande');
    }
  }
  for (const required of [
    'dist/main/index.js',
    'dist/preload/index.js',
    'dist/renderer/index.html',
  ]) {
    if (!m.files.some((f) => f.path === required)) {
      throw Error('Build incompleta');
    }
  }
  return m;
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
function regularFile(root, name) {
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw Error('Enlace no permitido en la build');
    }
  }
  if (!fs.statSync(current).isFile()) {
    throw Error('Archivo de build inválido');
  }
  return current;
}
async function boundedFetch(url, limit, fetcher, signal, allowEmpty = false) {
  const response = await fetcher(url, { redirect: 'error', signal });
  if (allowEmpty && response.status === 204) {
    return null;
  }
  if (!response.ok || !response.body) {
    throw Error(`No se pudo descargar el parche (${response.status})`);
  }
  if (Number(response.headers.get('content-length')) > limit) {
    throw Error('Descarga demasiado grande');
  }
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > limit) {
        throw Error('Descarga demasiado grande');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
function createRuntime({ config, root, installedRoot, fetcher = globalThis.fetch }) {
  const github = config.githubRepository
    ? createGitHubFeed({ repository: config.githubRepository, fetcher })
    : undefined;
  const statePath = path.join(root, 'state.json');
  let state;
  try {
    state = readJson(statePath);
  } catch {
    state = {};
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    state = {};
  }
  const validId = (id) => typeof id === 'string' && /^\d+-[a-f0-9]{64}$/.test(id);
  for (const key of ['active', 'previous', 'pending', 'ready']) {
    if (!validId(state[key])) {
      delete state[key];
    }
  }
  let currentRoot = installedRoot,
    currentBuild = config.baseBuild,
    currentId;
  const save = () => atomicJson(statePath, state);
  const slot = (id) => {
    if (!validId(id)) {
      throw Error('Build inválida');
    }
    return path.join(root, 'builds', id);
  };
  function verifySlot(id) {
    const dir = slot(id);
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw Error('Build inválida');
    }
    const envelope = readJson(regularFile(dir, 'manifest.json'));
    const m = verifyEnvelope(envelope, config, false);
    if (id !== `${m.build}-${hash(Buffer.from(envelope.payload, 'base64'))}`) {
      throw Error('Identidad de build inválida');
    }
    for (const f of m.files) {
      const name = regularFile(dir, f.path);
      const stat = fs.statSync(name);
      if (stat.size !== f.size || hash(fs.readFileSync(name)) !== f.sha256) {
        throw Error('Build dañada');
      }
    }
    // Reject additional JS/package.json files which could change Node module resolution.
    const expected = new Set(['manifest.json', ...m.files.map((f) => f.path)]);
    function walk(at, prefix = '') {
      for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
        const rel = prefix + entry.name;
        if (entry.isSymbolicLink()) {
          throw Error('Build inválida');
        }
        if (entry.isDirectory()) {
          walk(path.join(at, entry.name), rel + '/');
        } else if (!expected.has(rel)) {
          throw Error('Archivo no firmado en la build');
        }
      }
    }
    walk(dir);
    return { dir, m };
  }
  function boot() {
    if (state.pending && state.attempted) {
      state.failed = state.pending;
      delete state.pending;
      delete state.attempted;
      save();
    }
    const id = state.pending || state.active;
    if (id) {
      try {
        const result = verifySlot(id);
        currentRoot = result.dir;
        currentBuild = result.m.build;
        currentId = id;
        if (state.pending) {
          state.attempted = true;
          save();
        }
      } catch {
        state.failed = id;
        delete state.pending;
        delete state.attempted;
        if (state.active === id) {
          delete state.active;
        }
        save();
        if (state.active && state.active !== id) {
          try {
            const previous = verifySlot(state.active);
            currentRoot = previous.dir;
            currentBuild = previous.m.build;
            currentId = state.active;
          } catch {
            /* installed fallback */
          }
        }
        // The installed build is always the final recovery point.
      }
    }
    return path.join(currentRoot, 'dist', 'main', 'index.js');
  }
  function healthy() {
    if (state.pending && currentId === state.pending) {
      state.previous = state.active;
      state.active = state.pending;
      state.highest = Math.max(Number(state.highest) || 0, currentBuild);
      delete state.pending;
      delete state.attempted;
      delete state.ready;
      save();
    }
    const builds = path.join(root, 'builds');
    if (fs.existsSync(builds)) {
      for (const name of fs.readdirSync(builds)) {
        if (
          validId(name) &&
          ![state.active, state.previous, state.ready, state.pending].includes(name)
        ) {
          const target = slot(name);
          try {
            if (!fs.lstatSync(target).isSymbolicLink()) {
              fs.rmSync(target, { recursive: true, force: true });
            }
          } catch {
            /* Retry cleanup at the next healthy boot; antivirus may still hold a file. */
          }
        }
      }
    }
  }
  function feedUrl(channel) {
    if (!['stable', 'beta'].includes(channel)) {
      throw Error('Canal de parches inválido');
    }
    const url = new URL(config.feed);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw Error('El feed debe usar HTTPS');
    }
    return new URL(
      `${config.runtimeId}/${channel}-${config.platform}-${config.arch}.json`,
      url.href.replace(/\/?$/, '/'),
    ).href;
  }
  async function check(signal, channel = 'stable') {
    if (!['stable', 'beta'].includes(channel)) {
      throw Error('Canal de parches inválido');
    }
    if (!config.publicKey || (!config.feed && !github)) {
      return null;
    }
    if (github) {
      let selected = null;
      for (const candidate of await github.candidates(config, channel, signal)) {
        const m = verifyEnvelope(candidate.envelope, config, false);
        if (m.channel !== channel) {
          throw Error('El parche no pertenece al canal seleccionado');
        }
        if (Date.parse(m.expiresAt) <= Date.now()) {
          continue;
        }
        const id = `${m.build}-${hash(Buffer.from(candidate.envelope.payload, 'base64'))}`;
        if (m.build <= Math.max(currentBuild, Number(state.highest) || 0) || id === state.failed) {
          continue;
        }
        if (!selected || m.build > selected.m.build) {
          selected = { ...candidate, m, id };
        }
      }
      return selected;
    }
    const url = feedUrl(channel);
    const bytes = await boundedFetch(url, 2_100_000, fetcher, signal, true);
    if (bytes === null) {
      return null;
    }
    const envelope = JSON.parse(bytes.toString('utf8'));
    const m = verifyEnvelope(envelope, config);
    if (m.channel !== channel) {
      throw Error('El parche no pertenece al canal seleccionado');
    }
    const id = `${m.build}-${hash(Buffer.from(envelope.payload, 'base64'))}`;
    if (m.build <= Math.max(currentBuild, Number(state.highest) || 0) || id === state.failed) {
      return null;
    }
    return { envelope, m, id, url };
  }
  let downloading = false;
  async function stage(candidate, progress, signal) {
    if (downloading) {
      throw Error('Ya se está preparando un parche');
    }
    downloading = true;
    const temp = path.join(root, 'staging-' + crypto.randomUUID());
    try {
      const m = verifyEnvelope(candidate.envelope, config);
      if (m.build <= Math.max(currentBuild, Number(state.highest) || 0)) {
        throw Error('Build anterior a la instalada');
      }
      const id = `${m.build}-${hash(Buffer.from(candidate.envelope.payload, 'base64'))}`;
      const assets = github
        ? candidate.assets || (await github.assets(candidate.releaseId, signal))
        : undefined;
      fs.mkdirSync(temp, { recursive: true });
      const payload = path.join(temp, 'payload');
      const prepared = path.join(temp, 'build');
      fs.mkdirSync(payload);
      fs.mkdirSync(prepared);
      let downloaded = 0,
        reused = 0;
      const totalBytes = m.files.reduce((total, f) => total + f.size, 0);
      for (const [index, f] of m.files.entries()) {
        signal?.throwIfAborted();
        let bytes;
        try {
          const source = regularFile(currentRoot, f.path);
          if (fs.statSync(source).size === f.size) {
            const local = fs.readFileSync(source);
            if (hash(local) === f.sha256) {
              bytes = local;
            }
          }
        } catch {
          /* A missing or changed file is downloaded from the signed build. */
        }
        if (bytes) {
          reused += f.size;
        } else {
          progress({
            phase: 'downloading',
            percent: totalBytes ? Math.round(((downloaded + reused) / totalBytes) * 100) : 0,
            downloaded,
            reused,
          });
          bytes = github
            ? await github.asset(
                assets.find((asset) => asset.name === `${f.sha256}.blob`),
                f.size,
                signal,
              )
            : await boundedFetch(
                new URL(`blobs/${f.sha256}`, feedUrl(m.channel)).href,
                f.size,
                fetcher,
                signal,
              );
          if (bytes.length !== f.size || hash(bytes) !== f.sha256) {
            throw Error('El archivo descargado no supera la comprobación de integridad');
          }
          downloaded += f.size;
        }
        fs.writeFileSync(path.join(payload, String(index)), bytes, { flag: 'wx' });
        progress({
          phase: 'downloading',
          percent: totalBytes ? Math.round(((downloaded + reused) / totalBytes) * 100) : 100,
          downloaded,
          reused,
        });
        if (index % 16 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      for (const [index, f] of m.files.entries()) {
        signal?.throwIfAborted();
        const dest = path.join(prepared, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(path.join(payload, String(index)), dest);
        progress({
          phase: 'installing',
          percent: Math.round(((index + 1) / m.files.length) * 100),
          downloaded,
          reused,
        });
        if (index % 16 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      for (const [index, f] of m.files.entries()) {
        signal?.throwIfAborted();
        const bytes = fs.readFileSync(regularFile(prepared, f.path));
        if (bytes.length !== f.size || hash(bytes) !== f.sha256) {
          throw Error('El archivo descargado no supera la comprobación de integridad');
        }
        progress({
          phase: 'verifying',
          percent: Math.round(((index + 1) / m.files.length) * 100),
          downloaded,
          reused,
        });
        if (index % 16 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      atomicJson(path.join(prepared, 'manifest.json'), candidate.envelope);
      fs.mkdirSync(path.join(root, 'builds'), { recursive: true });
      const dest = slot(id);
      if (fs.existsSync(dest)) {
        verifySlot(id);
      } else {
        fs.renameSync(prepared, dest);
      }
      state.ready = id;
      save();
      return id;
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
      downloading = false;
    }
  }
  function activate() {
    if (!state.ready) {
      throw Error('No hay ningún parche preparado');
    }
    verifySlot(state.ready);
    state.pending = state.ready;
    state.attempted = false;
    save();
  }
  function rollback() {
    if (state.pending) {
      throw Error('Ya hay un reinicio pendiente');
    }
    if (!state.active) {
      throw Error('Ya estás en la build del instalador');
    }
    state.failed = state.active;
    // Return to the previous verified build, or to the installer baseline.
    if (state.previous) {
      verifySlot(state.previous);
    }
    state.active = state.previous;
    delete state.previous;
    delete state.ready;
    save();
  }
  return {
    boot,
    healthy,
    check,
    stage,
    activate,
    rollback,
    snapshot: () => ({
      build: currentBuild,
      enabled: Boolean(config.publicKey && (config.feed || github)),
      ready: Boolean(state.ready),
      rollback: Boolean(state.active),
      pending: Boolean(state.pending),
      recovered: Boolean(state.failed),
    }),
  };
}
module.exports = { createRuntime, verifyEnvelope, hash, safePath, atomicJson };
