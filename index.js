/**
 * dsh-multi-dir-workspace —— 宿主半边（纯 JS，零 DSH 包依赖）。
 *
 * DSH 内核的 Workspace 严格单目录，插件无法改动内核；本插件在其之上"叠加"
 * 多目录能力，做四件事：
 *   ① 维护一份"附加目录"清单，持久化到 $DSH_HOME/multi-dir-workspace.json；
 *   ② 通过 systemPrompt.context 把清单元数据告诉模型（让它知道可用绝对路径）；
 *   ③ 给每个 agent 的会话注册 sandboxPolicy 可写根目录（读取本就全通过）；
 *   ④ 注册 workspace_directories 工具 + HTTP 路由，供模型与界面增删/切换目录。
 *
 * 设计取舍：不 import 任何 DSH 包（连 schemastery 都不 import），只用 node:
 * 内建，任何一步出错都只 warn，绝不向上抛，避免连累宿主启动。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'multi-dir-workspace'

/** 依赖的服务：声明后 apply 才开始，保证 ctx 上服务可用。 */
export const inject = [
  'tools',
  'systemPrompt',
  'workingDirectory',
  'sandboxPolicy',
  'agents',
  'webServer',
  'connection',
]

const ROUTE = '/dsh-multi-dir-workspace/dirs'

function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(os.homedir(), '.dsh')
}

/** Windows 路径大小写不敏感；用它统一去重 / 匹配。 */
function sameDir(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function apply(ctx) {
  const home = resolveHome()
  const store = path.join(home, 'multi-dir-workspace.json')
  const warn = (message, error) => {
    const text = `multi-dir-workspace: ${message}${error ? ` — ${error && error.message ? error.message : String(error)}` : ''}`
    try { ctx.logger && ctx.logger.warn && ctx.logger.warn(text) } catch { /* ignore */ }
  }

  function loadDirs() {
    const out = []
    try {
      const data = JSON.parse(fs.readFileSync(store, 'utf8'))
      if (data && Array.isArray(data.directories)) {
        for (const d of data.directories) {
          if (typeof d !== 'string' || !path.isAbsolute(d)) continue
          const abs = path.resolve(d)
          if (!out.some(existing => sameDir(existing, abs))) out.push(abs)
        }
      }
    } catch { /* fresh start */ }
    return out
  }

  let dirs = loadDirs()

  // 当前工作目录：跨会话跟踪（v1 与"全局清单"设计一致）。工具 cd 与 UI cd 都会更新它。
  let currentCwd = ''
  try { currentCwd = String(ctx.workingDirectory.defaultDirectory || '') } catch { /* ignore */ }

  function saveDirs() {
    try {
      fs.mkdirSync(home, { recursive: true })
      fs.writeFileSync(store, JSON.stringify({ directories: dirs }, null, 2) + '\n', 'utf8')
    } catch (error) {
      warn('could not persist directories', error)
    }
  }

  function normalizeDir(candidate) {
    if (typeof candidate !== 'string' || candidate.trim() === '') throw new Error('empty path')
    const abs = path.resolve(candidate)
    let stat
    try { stat = fs.statSync(abs) } catch { throw new Error(`directory does not exist: ${abs}`) }
    if (!stat.isDirectory()) throw new Error(`not a directory: ${abs}`)
    return abs
  }

  /** 选一个存活的 agent 作为 workingDirectory 变更的载体。 */
  function pickAgent() {
    try {
      if (ctx.agents && typeof ctx.agents.currentInitiator === 'function') {
        const agent = ctx.agents.currentInitiator()
        if (agent) return agent
      }
    } catch { /* ignore */ }
    try {
      const list = ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
      return list.length ? list[0] : undefined
    } catch { return undefined }
  }

  /**
   * 工作区自身的根目录：即使不在附加清单里，也始终允许 cd 回去。
   * `session.header.cwd` 是会话不可变的原始项目目录（见 dsh-working-directory
   * src/index.ts:167 `agent.session.header.cwd ?? this.defaultDirectory`），
   * 正是"工作区根"的权威来源。
   */
  function originDir() {
    const agent = pickAgent()
    const header = agent && agent.session && agent.session.header
    if (header && typeof header.cwd === 'string' && header.cwd) return path.resolve(header.cwd)
    try {
      const def = ctx.workingDirectory && ctx.workingDirectory.defaultDirectory
      return typeof def === 'string' && def ? path.resolve(def) : ''
    } catch { return '' }
  }

  function isAttached(abs) {
    if (dirs.some(d => sameDir(d, abs))) return true
    const origin = originDir()
    return !!origin && sameDir(origin, abs)
  }

  /**
   * 当前生效的工作目录：以"活着的会话"的 cwd 为准。
   * 插件加载时 `defaultDirectory` 往往还是 profile 目录（会话还没建立），
   * 直接把它当当前目录会让界面显示错误路径 —— 所以这里优先问
   * workingDirectory.get(session)，再退到工作区根目录。
   */
  function currentDir() {
    const agent = pickAgent()
    if (agent && agent.session) {
      try {
        const cwd = ctx.workingDirectory.get(agent.session)
        if (typeof cwd === 'string' && cwd) return path.resolve(cwd)
      } catch { /* ignore */ }
    }
    const origin = originDir()
    if (origin) return origin
    return currentCwd
  }

  async function cdTo(candidate, signal) {
    const abs = path.resolve(candidate)
    if (!isAttached(abs)) throw new Error(`directory is not attached: ${abs}`)
    // 目录可能已被移除但仍存在于磁盘；确保调用时确实可用。
    const real = normalizeDir(abs)
    const agent = pickAgent()
    if (!agent) throw new Error('no active agent to switch working directory')
    const cwd = await ctx.workingDirectory.set(agent, real, signal)
    currentCwd = cwd || real
    return currentCwd
  }

  // ---- sandbox write grants: one set per live agent/session ----------------
  const agentGrants = new Map() // agent -> Map<dir, dispose>

  function disposeAgent(agent) {
    const grants = agentGrants.get(agent)
    if (!grants) return
    for (const dispose of grants.values()) {
      try { dispose() } catch (error) { warn('grant cleanup failed', error) }
    }
    agentGrants.delete(agent)
  }

  function syncAgent(agent) {
    const session = agent && agent.session
    if (!session || !ctx.sandboxPolicy || typeof ctx.sandboxPolicy.registerWritableRoot !== 'function') return
    let grants = agentGrants.get(agent)
    if (!grants) { grants = new Map(); agentGrants.set(agent, grants) }
    const wanted = new Set(dirs)
    for (const [dir, dispose] of [...grants]) {
      if (!wanted.has(dir)) {
        try { dispose() } catch (error) { warn('grant cleanup failed', error) }
        grants.delete(dir)
      }
    }
    for (const dir of wanted) {
      if (grants.has(dir)) continue
      try {
        const dispose = ctx.sandboxPolicy.registerWritableRoot(session, dir)
        grants.set(dir, dispose)
      } catch (error) {
        // Symlinks / invalid roots are rejected by the policy; reading still works.
        warn(`cannot grant write access to ${dir}`, error)
      }
    }
  }

  function syncAll() {
    try {
      for (const agent of ctx.agents.list()) syncAgent(agent)
    } catch (error) { warn('grant sync failed', error) }
  }

  function addDir(candidate) {
    const abs = normalizeDir(candidate)
    if (!dirs.some(d => sameDir(d, abs))) {
      dirs.push(abs)
      saveDirs()
      syncAll()
    }
    return abs
  }

  function removeDir(candidate) {
    const abs = path.resolve(candidate)
    const before = dirs.length
    dirs = dirs.filter(d => !sameDir(d, abs))
    if (dirs.length !== before) {
      saveDirs()
      syncAll()
    }
  }

  // ---- prompt context: tell the model the directories exist ----------------
  ctx.effect(() => {
    const disposeContext = ctx.systemPrompt.context({
      name: 'multi-dir-workspace:directories',
      order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY') + 5,
      interpolate: false,
      text: () => {
        if (dirs.length === 0) return ''
        const list = dirs.map(d => `- ${d}`).join('\n')
        const cwd = currentDir()
        return [
          'Additional working directories attached to this workspace (use absolute paths to read them; they are writable in workspace-write mode):',
          list,
          cwd ? `Current working directory: ${cwd}.` : '',
          'Use the workspace_directories tool with action "cd" to make one of them the current working directory.',
        ].filter(Boolean).join('\n')
      },
    })

    const disposeTool = ctx.tools.register({
      name: 'workspace_directories',
      description: 'List, add, remove, or enter the extra directories attached to the workspace. Use absolute paths; reads work everywhere and writes are granted in workspace-write mode.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'remove', 'cd'],
            description: 'list: show all directories; add/remove: change the list (requires path); cd: make a directory the current working directory (requires path).',
          },
          path: {
            type: 'string',
            description: 'Absolute directory path, required for add/remove/cd.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            directories: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            message: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const action = (args && args.action) || 'list'
        if (action === 'list') return { directories: [...dirs], cwd: currentDir() }
        if (action === 'add') {
          if (!args || !args.path) throw new Error('path is required for add')
          addDir(args.path)
          return { directories: [...dirs], cwd: currentDir(), message: 'directory added' }
        }
        if (action === 'remove') {
          if (!args || !args.path) throw new Error('path is required for remove')
          removeDir(args.path)
          return { directories: [...dirs], cwd: currentDir(), message: 'directory removed' }
        }
        if (action === 'cd') {
          if (!args || !args.path) throw new Error('path is required for cd')
          const cwd = await cdTo(args.path, exec && exec.signal)
          return { cwd, directories: [...dirs] }
        }
        throw new Error(`unknown action: ${action}`)
      },
    })

    return () => { disposeContext(); disposeTool() }
  }, 'multi-dir-workspace: registrations')

  // ---- grant lifecycle -----------------------------------------------------
  ctx.effect(() => {
    syncAll()
    return () => {
      for (const agent of [...agentGrants.keys()]) disposeAgent(agent)
    }
  }, 'multi-dir-workspace: grants')

  ctx.on('agent/created', ({ agent }) => {
    syncAgent(agent)
    // 新 agent 会话的初始 cwd 可能更贴近真实状态；仅在尚未显式切换时同步一次。
    if (!currentCwd && agent && agent.session) {
      try { currentCwd = String(ctx.workingDirectory.get(agent.session) || '') } catch { /* ignore */ }
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { disposeAgent(agent) })

  // ---- HTTP routes for the client UI --------------------------------------
  ctx.inject(['webServer'], child => child.effect(() => {
    const dispose = child.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        // 安全栅栏：与官方 web 路由同一道 Host/Origin + 浏览器认证检查。
        // 没有它，浏览器里任意网页都能 POST 到这里改工作目录、授予沙箱写权限。
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        const send = (status, obj) => {
          try {
            const payload = JSON.stringify(obj)
            res.writeHead(status, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': Buffer.byteLength(payload),
              'Cache-Control': 'no-store',
            })
            res.end(payload)
          } catch (error) { warn('response write failed', error) }
        }
        try {
          if (req.method === 'GET' || !req.method) {
            return send(200, { directories: [...dirs], cwd: currentDir() })
          }
          if (req.method === 'POST') {
            const body = await readJson(req)
            if (body.action === 'add') addDir(body.path)
            else if (body.action === 'remove') removeDir(body.path)
            else if (body.action === 'cd') {
              const cwd = await cdTo(body.path)
              return send(200, { ok: true, cwd, directories: [...dirs] })
            } else return send(400, { ok: false, error: 'unknown action' })
            return send(200, { ok: true, cwd: currentDir(), directories: [...dirs] })
          }
          return send(405, { ok: false, error: 'method not allowed' })
        } catch (error) {
          return send(400, { ok: false, error: error && error.message ? error.message : String(error) })
        }
      },
    })
    return () => { dispose() }
  }, 'multi-dir-workspace: routes'))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > 1024 * 1024) {
        settled = true
        reject(new Error('request body too large'))
        try { req.destroy() } catch { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (error) { reject(error) }
    })
    req.on('error', error => { if (!settled) { settled = true; reject(error) } })
  })
}
