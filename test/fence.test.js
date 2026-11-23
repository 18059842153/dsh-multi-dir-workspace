// Regression test: the plugin's HTTP routes must consult connection.requestRejection
// before doing anything, and must answer with the rejection status when it fires.
//
// Run with: node test/fence.test.js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(HERE, '..', 'index.js')
const src = readFileSync(FILE, 'utf8')

let failed = 0
function check(name, cond, extra) {
  if (cond) console.log('OK ' + name)
  else { console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); failed++ }
}

// 1. connection must be declared as an injected service, otherwise ctx.connection is undefined.
check('inject declares connection', /export const inject = \[[^\]]*'connection'[^\]]*\]/s.test(src))

// 2. the handler must call requestRejection on the request.
check('route calls requestRejection(req)', /requestRejection\s*\(\s*req\s*\)/.test(src))

// 3. the rejection must short-circuit: status set + end, before the body is read.
const guardIdx = src.indexOf('requestRejection')
const readIdx = src.indexOf('readJson(req)')
check('guard runs before readJson', guardIdx !== -1 && readIdx !== -1 && guardIdx < readIdx,
  'guard=' + guardIdx + ' read=' + readIdx)
check('rejection sets statusCode and ends',
  /rejection !== undefined[\s\S]{0,200}statusCode\s*=\s*rejection[\s\S]{0,120}res\.end\(\)/.test(src))

// 4. behavioural check: run the real route with a stubbed ctx.
async function behaviour() {
  const mod = await import('file:///' + FILE.replace(/\\/g, '/'))
  let handler = null
  const fakeChild = {
    webServer: {
      register: (route) => { handler = route.handler; return () => {} },
    },
    effect: (fn) => { fn() },
  }
  const ctx = {
    effect: () => {},
    on: () => {},
    inject: (deps, cb) => { cb(fakeChild) },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    connection: { requestRejection: () => 401 },
    webServer: fakeChild.webServer,
    workingDirectory: { get: () => 'G:\\ds\\chajian' },
    sandboxPolicy: { registerWritableRoot: () => () => {} },
    systemPrompt: { context: () => () => {} },
    tools: { register: () => () => {} },
    agents: { list: () => [], currentInitiator: undefined },
  }
  try { await mod.apply(ctx) } catch { /* partial ctx may throw later; the handler is what matters */ }
  if (!handler) { console.log('SKIP behaviour (handler not captured)'); return }

  function fakeRes() {
    const r = { statusCode: 200, headers: null, body: '', ended: false,
      writeHead(c, h) { r.statusCode = c; r.headers = h },
      end(b) { r.ended = true; if (b) r.body += b } }
    return r
  }

  // Unauthenticated: fence must answer 401 and never reach the data path.
  const res1 = fakeRes()
  await handler({ method: 'POST', on: () => {}, headers: {} }, res1)
  check('rejected request answers 401', res1.statusCode === 401, 'got ' + res1.statusCode)
  check('rejected request writes no JSON body', res1.body === '', 'body=' + JSON.stringify(res1.body))
  check('rejected request ends response', res1.ended === true)

  // Authenticated: fence passes, GET returns the directory list.
  ctx.connection.requestRejection = () => undefined
  const res2 = fakeRes()
  await handler({ method: 'GET', on: () => {}, headers: {} }, res2)
  check('accepted request answers 200', res2.statusCode === 200, 'got ' + res2.statusCode)
  check('accepted request returns JSON', /directories/.test(res2.body), 'body=' + res2.body)
}

behaviour().then(() => {
  console.log(failed === 0 ? 'DONE all fence checks passed' : 'DONE ' + failed + ' FAILED')
  process.exit(failed === 0 ? 0 : 1)
}).catch(e => { console.log('FAIL harness ' + (e && e.stack || e)); process.exit(1) })
