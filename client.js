/*
 * dsh-multi-dir-workspace —— 浏览器半边（构建免费，直接被 __ModuleLoader__ 加载）。
 *
 * 放置决策：只注册一处 —— `conversation.header.leading`（会话标题之前的全局导航位，
 * root scope，没有会话时也渲染）。理由：
 *   ① 多目录属于「工作区」而非某个会话，语义上是全局的，不该塞进输入框工具行；
 *   ② 该座位是 single 单坑，不会被别的插件挤成列表里的一项；
 *   ③ root scope 保证空会话 hero 态也能看到，不会「新建会话时控件消失」；
 *   ④ 全页只有这一处渲染 —— 一个功能只出现一次。
 */
window.__ModuleLoader__.load({
  id: 'dsh-multi-dir-workspace',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    // The builtin React surface may not expose useRef; fall back to a state-held
    // mutable box, which React accepts as a ref object for DOM elements.
    var useRef = typeof React.useRef === 'function' ? React.useRef : null
    function useBox(init) {
      if (useRef) return useRef(init)
      var box = useState(function () { return { current: init } })
      return box[0]
    }

    var ROUTE = '/dsh-multi-dir-workspace/dirs'
    var NS = 'multi-dir-workspace'
    var STYLE_ID = 'mdw-styles-v3'
    // 全局导航位（root scope）：没有会话时也在，语义上属于「工作区」而不是会话。
    var SLOT = 'conversation.header.leading'

    // The composer clips overflow, so a fixed overlay must live on document.body.
    // react-dom is optional in the client module table: fall back to inline render.
    var ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }

    function portal(node) {
      try {
        if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body) {
          return ReactDOM.createPortal(node, document.body)
        }
      } catch { /* fall through */ }
      return node
    }

    var zh = {
      title: '多目录工作区',
      add: '添加目录',
      remove: '移除',
      use: '切换',
      current: '当前',
      none: '尚未附加其它目录',
      cwd: '当前工作目录',
      error: '操作失败',
      errNotExist: '目录不存在',
      errNotDir: '路径不是目录',
      errNotAttached: '目录未附加到本工作区',
      errTooLarge: '请求内容过大',
      errNoAgent: '没有可切换工作目录的活动会话',
      loading: '加载中…',
      close: '关闭',
      chipLabel: '工作区',
      chipTitle: '切换工作目录 / 管理附加目录',
      listTitle: '附加目录',
      switchTo: '切换到此目录',
      removeTitle: '从工作区移除',
    }
    var en = {
      title: 'Multi-directory workspace',
      add: 'Add directory',
      remove: 'Remove',
      use: 'Use',
      current: 'current',
      none: 'No extra directories attached',
      cwd: 'Current working directory',
      error: 'Operation failed',
      errNotExist: 'Directory does not exist',
      errNotDir: 'Path is not a directory',
      errNotAttached: 'Directory is not attached to this workspace',
      errTooLarge: 'Request body too large',
      errNoAgent: 'No active session to switch the working directory',
      loading: 'Loading…',
      close: 'Close',
      chipLabel: 'Workspace',
      chipTitle: 'Switch working directory / manage attached directories',
      listTitle: 'Attached directories',
      switchTo: 'Switch to this directory',
      removeTitle: 'Remove from workspace',
    }

    // ---- styling: injected once, theme-adaptive via DSH --dsw-alias-* tokens --
    var CSS = [
      '.mDW-wrap{display:inline-flex;align-items:center;min-width:0;margin-right:2px}',
      /* Header breadcrumb: borderless like the navigation it sits in, so it reads
         as "where this workspace is" rather than as a form control. */
      '.mDW-chip{display:inline-flex;align-items:center;gap:6px;height:28px;max-width:230px;padding:0 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#8b8b8b);font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .12s,color .12s,border-color .12s}',
      '.mDW-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.mDW-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}',
      '.mDW-chip[data-open="true"]{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.mDW-chip[data-active="true"]{color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.mDW-chipIcon{display:block;flex:none;opacity:.75}',
      '.mDW-chipLabel{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.mDW-chipCount{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:15px;height:15px;padding:0 4px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#2f3138);color:var(--dsw-alias-label-secondary,#a8a8a8);font-size:10px;line-height:1;font-variant-numeric:tabular-nums}',
      '.mDW-chipChev{display:block;flex:none;opacity:.5}',
      /* Popover: two layers on purpose. `.mDW-pop` is the position:fixed anchor
         box (no overflow, so the caret can stick out of it); `.mDW-card` is the
         visible card and owns the scroll. --mdw-caret-x keeps the arrow over the
         trigger. */
      '.mDW-pop{position:fixed;inset:auto;z-index:9000;display:flex;flex-direction:column;box-sizing:border-box;width:340px;max-width:calc(100vw - 24px);margin:0;padding:0;border:0;background:none;overflow:visible;animation:mDW-pop-in .13s ease-out}',
      '.mDW-card{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;max-height:var(--mdw-max-h,420px);overflow:auto;padding:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#25262b);color:var(--dsw-alias-label-primary,#e6e6e6);box-shadow:0 12px 32px rgba(0,0,0,.28)}',
      /* The panel grows out of the chip, so the motion starts on the anchored side. */
      '.mDW-pop[data-side="top"]{transform-origin:bottom center;animation-name:mDW-pop-up}',
      '.mDW-pop[data-side="bottom"]{transform-origin:top center}',
      '@keyframes mDW-pop-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}',
      '@keyframes mDW-pop-up{from{opacity:0;transform:translateY(4px) scale(.985)}to{opacity:1;transform:none}}',
      '.mDW-caret{position:absolute;left:var(--mdw-caret-x,24px);width:9px;height:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:var(--dsw-alias-bg-layer-2,#25262b);transform:translateX(-50%) rotate(45deg);pointer-events:none}',
      '.mDW-pop[data-side="top"] .mDW-caret{bottom:-6px;border-top-color:transparent;border-left-color:transparent}',
      '.mDW-pop[data-side="bottom"] .mDW-caret{top:-6px;border-right-color:transparent;border-bottom-color:transparent}',
      '.mDW-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;line-height:18px;padding:0 2px}',
      '.mDW-close{appearance:none;font:inherit;font-size:12px;line-height:18px;cursor:pointer;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#999);padding:2px 6px}',
      '.mDW-close:hover{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}',
      '.mDW-cwd{display:flex;flex-direction:column;gap:3px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}',
      '.mDW-cwdKey{color:var(--dsw-alias-label-tertiary,#909090);font-size:10px;line-height:14px;letter-spacing:.02em;text-transform:uppercase}',
      '.mDW-cwdVal{color:var(--dsw-alias-label-secondary,#c4c4c4);font-size:11px;line-height:16px;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.mDW-list{display:flex;flex-direction:column;gap:2px}',
      /* A row is a list item, not a table record: name first, path as context. */
      '.mDW-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;transition:background-color .12s,border-color .12s}',
      '.mDW-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}',
      '.mDW-row .mDW-chipIcon{opacity:.55}',
      '.mDW-rowCurrent{background:var(--dsw-alias-bg-layer-2,#2a2c33);border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}',
      '.mDW-rowCurrent .mDW-chipIcon{opacity:.9}',
      '.mDW-rowText{display:flex;flex-direction:column;flex:1;min-width:0;gap:1px}',
      '.mDW-rowName{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mDW-rowPath{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px;line-height:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.mDW-tag{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-brand-primary,#4176e6);color:#fff;font-size:10px;line-height:15px}',
      '.mDW-use,.mDW-remove,.mDW-add{appearance:none;font:inherit;cursor:pointer;border-radius:7px;font-size:12px;line-height:18px;transition:background-color .12s,color .12s,border-color .12s}',
      '.mDW-use{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-secondary,#aaa);opacity:0;transition:opacity .12s,color .12s,border-color .12s}',
      '.mDW-row:hover .mDW-use,.mDW-use:focus-visible{opacity:1}',
      '.mDW-use:hover{color:var(--dsw-alias-brand-primary,#4176e6);border-color:var(--dsw-alias-brand-primary,#4176e6)}',
      '.mDW-remove{flex:none;width:20px;height:20px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:14px;line-height:20px;opacity:0}',
      '.mDW-row:hover .mDW-remove,.mDW-remove:focus-visible{opacity:1}',
      '.mDW-remove:hover{color:var(--dsw-alias-state-error-primary,#d92d20)}',
      '.mDW-add{padding:7px 8px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:transparent;color:var(--dsw-alias-label-secondary,#aaa)}',
      '.mDW-add:hover{border-style:solid;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.mDW-add:disabled,.mDW-use:disabled,.mDW-remove:disabled{opacity:.55;cursor:not-allowed}',
      '.mDW-use:focus-visible,.mDW-remove:focus-visible,.mDW-add:focus-visible,.mDW-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}',
      '.mDW-empty{padding:10px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:12px}',
      '.mDW-sect{padding:2px 2px 0;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px;line-height:14px;letter-spacing:.03em;text-transform:uppercase}',
      '.mDW-error{padding:6px 8px;border-radius:8px;color:var(--dsw-alias-state-error-primary,#d92d20);background:rgba(217,45,32,.10);font-size:12px;line-height:16px}',
      '.mDW-loading{padding:8px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:12px}',
    ].join('\n')

    function ensureStyle() {
      try {
        if (typeof document === 'undefined' || !document.head) return
        if (document.getElementById(STYLE_ID)) return
        var el = document.createElement('style')
        el.id = STYLE_ID
        el.textContent = CSS
        document.head.appendChild(el)
      } catch { /* non-DOM environment (tests) */ }
    }

    function friendlyError(e, t) {
      var msg = String((e && e.message) || e || '')
      if (/does not exist/i.test(msg)) return t('errNotExist')
      if (/not a directory/i.test(msg)) return t('errNotDir')
      if (/not attached/i.test(msg)) return t('errNotAttached')
      if (/too large/i.test(msg)) return t('errTooLarge')
      if (/no active agent/i.test(msg)) return t('errNoAgent')
      return msg ? (t('error') + ': ' + msg) : t('error')
    }

    function getDirs() {
      return fetch(ROUTE, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .then(function (data) {
          return {
            directories: Array.isArray(data.directories) ? data.directories : [],
            cwd: typeof data.cwd === 'string' ? data.cwd : '',
          }
        })
    }

    function post(body) {
      return fetch(ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    }

    function FolderIcon() {
      return h('svg', {
        className: 'mDW-chipIcon', width: 14, height: 14, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, [
        h('path', {
          key: 'p',
          d: 'M1.9 4.4a1.1 1.1 0 0 1 1.1-1.1h3.1l1.4 1.7h5.5a1.1 1.1 0 0 1 1.1 1.1v5.5a1.1 1.1 0 0 1-1.1 1.1H3a1.1 1.1 0 0 1-1.1-1.1z',
        }),
      ])
    }

    function ChevronIcon() {
      return h('svg', {
        className: 'mDW-chipChev', width: 10, height: 10, viewBox: '0 0 12 12',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, [h('path', { key: 'p', d: 'M3 4.75 6 7.75l3-3' })])
    }

    /** Last path segment, tolerant of both separators and of a trailing one. */
    function baseName(p) {
      var s = String(p || '').replace(/[\\/]+$/, '')
      var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
      return i >= 0 ? s.slice(i + 1) : s
    }

    /** The path minus its last segment — the "where is that folder" context. */
    function parentOf(p) {
      var s = String(p || '').replace(/[\\/]+$/, '')
      var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
      return i > 0 ? s.slice(0, i) : s
    }

    function Popover(props) {
      var ctx = props.ctx
      var t = props.t
      var dirs = props.dirs
      var cwd = props.cwd
      var busy = props.busy
      var loading = props.loading
      var error = props.error
      var style = props.style
      var side = props.side
      var onClose = props.onClose
      var onAdd = props.onAdd
      var onRemove = props.onRemove
      var onUse = props.onUse
      var ref = useBox(null)

      // Top-layer rendering: the `popover` attribute escapes the composer's
      // overflow clip without needing react-dom. If the browser cannot promote
      // the element, drop the attribute so it still renders inline.
      useEffect(function () {
        var el = ref.current
        if (!el) return undefined
        var shown = false
        if (typeof el.showPopover === 'function') {
          try { el.showPopover(); shown = true } catch { shown = false }
        }
        if (!shown) {
          try { el.removeAttribute('popover') } catch { /* no-op */ }
        }
        return function () {
          if (shown && typeof el.hidePopover === 'function') {
            try { el.hidePopover() } catch { /* already closed */ }
          }
        }
      }, [])

      var same = function (a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') return false
        return a.toLowerCase ? a.toLowerCase() === b.toLowerCase() : a === b
      }

      // A raw absolute path is hard to scan; lead with the directory's own name
      // and keep the full path as the secondary line (and the row's tooltip).
      var rows = dirs.length
        ? dirs.map(function (d) {
          var isCurrent = props.cwd && same(d, props.cwd)
          return h('div', { key: d, className: 'mDW-row' + (isCurrent ? ' mDW-rowCurrent' : ''), title: d }, [
            h(FolderIcon, { key: 'icon' }),
            h('span', { key: 'txt', className: 'mDW-rowText' }, [
              h('span', { key: 'n', className: 'mDW-rowName' }, baseName(d)),
              h('span', { key: 'p', className: 'mDW-rowPath' }, parentOf(d)),
            ]),
            isCurrent ? h('span', { key: 'tag', className: 'mDW-tag' }, t('current')) : null,
            isCurrent ? null : h('button', {
              key: 'use', type: 'button', className: 'mDW-use', disabled: busy,
              title: t('switchTo'),
              onClick: function () { onUse(d) },
            }, t('use')),
            h('button', {
              key: 'remove', type: 'button', className: 'mDW-remove', disabled: busy,
              title: t('removeTitle'), 'aria-label': t('removeTitle'),
              onClick: function () { onRemove(d) },
            }, '×'),
          ])
        })
        : [h('div', { key: 'none', className: 'mDW-empty' }, t('none'))]

      // The current directory only needs its own line when it is not one of the
      // listed rows (it then has no "current" tag to carry that information).
      var cwdListed = !!cwd && dirs.some(function (d) { return same(d, cwd) })
      return h('div', {
        ref: ref,
        id: props.id,
        className: 'mDW-pop',
        popover: 'manual',
        role: 'dialog',
        'data-side': side || 'top',
        'aria-label': t('title'),
        'aria-busy': busy ? 'true' : 'false',
        style: style,
        onMouseDown: function (e) { e.stopPropagation() },
        onClick: function (e) { e.stopPropagation() },
      }, [
        h('span', { key: 'caret', className: 'mDW-caret', 'aria-hidden': 'true' }),
        h('div', { key: 'card', className: 'mDW-card' }, [
          h('div', { key: 'head', className: 'mDW-head' }, [
            h('span', { key: 'title' }, t('title')),
            h('button', {
              key: 'close', type: 'button', className: 'mDW-close',
              onClick: onClose, 'aria-label': t('close'),
            }, t('close')),
          ]),
          cwd && !cwdListed ? h('div', { key: 'cwd', className: 'mDW-cwd' }, [
            h('span', { key: 'k', className: 'mDW-cwdKey' }, t('cwd')),
            h('span', { key: 'v', className: 'mDW-cwdVal' }, cwd),
          ]) : null,
          dirs.length ? h('div', { key: 'sect', className: 'mDW-sect' }, t('listTitle')) : null,
          loading ? h('div', { key: 'loading', className: 'mDW-loading', role: 'status' }, t('loading')) : null,
          h('div', { key: 'list', className: 'mDW-list' }, rows),
          error ? h('div', { key: 'err', className: 'mDW-error', role: 'alert' }, friendlyError({ message: error }, t)) : null,
          h('button', {
            key: 'add', type: 'button', className: 'mDW-add', disabled: busy, onClick: onAdd,
          }, '+ ' + t('add')),
        ]),
      ])
    }

    function DirectoryChip(props) {
      var ctx = props.ctx
      var t = props.t
      var state = useState({ dirs: [], cwd: '', open: false, busy: false, loading: false, error: '' })
      var value = state[0]
      var setState = state[1]
      var btnRef = useBox(null)
      var popStyle = useState({})
      var setPopStyle = popStyle[1]
      var popId = 'mdw-popover'

      var aliveRef = useBox(true)

      function refresh() {
        setState(function (s) { return Object.assign({}, s, { loading: true }) })
        getDirs().then(function (data) {
          if (!aliveRef.current) return
          setState(function (s) { return Object.assign({}, s, { dirs: data.directories, cwd: data.cwd, loading: false, error: '' }) })
        }).catch(function (e) {
          if (!aliveRef.current) return
          setState(function (s) { return Object.assign({}, s, { loading: false, error: friendlyError(e, t) }) })
        })
      }

      useEffect(function () {
        ensureStyle()
        aliveRef.current = true
        refresh()
        return function () { aliveRef.current = false }
      }, [])

      // The chip mounts before the session exists, so the cwd captured on mount
      // can already be stale by the time the popover is opened. Re-read on open.
      useEffect(function () {
        if (!value.open) return
        refresh()
      }, [value.open])

      // Anchor the fixed popover against the chip: it grows upward from the
      // trigger (bottom pinned to the chip), flipping below only when there is
      // no room above. The arrow tracks the horizontal centre of the chip.
      useEffect(function () {
        if (!value.open) return
        function place() {
          var el = btnRef.current
          if (!el || typeof el.getBoundingClientRect !== 'function') return
          var r = el.getBoundingClientRect()
          var vw = window.innerWidth || 1024
          var vh = window.innerHeight || 768
          var width = 340
          var gap = 10
          var roomAbove = r.top - gap - 12
          var roomBelow = vh - r.bottom - gap - 12
          var above = roomAbove >= 200 || roomAbove >= roomBelow
          var left = Math.max(12, Math.min(r.left, vw - width - 12))
          var style = { left: left + 'px' }
          if (above) style.bottom = (vh - r.top + gap) + 'px'
          else style.top = (r.bottom + gap) + 'px'
          style['--mdw-max-h'] = Math.max(160, Math.min(420, above ? roomAbove : roomBelow)) + 'px'
          style['--mdw-caret-x'] = Math.max(14, Math.min(width - 14, r.left + r.width / 2 - left)) + 'px'
          setPopStyle({ side: above ? 'top' : 'bottom', css: style })
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return function () {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [value.open])

      // Dismiss on outside pointer / Escape.
      useEffect(function () {
        if (!value.open) return
        function onDown(e) {
          var el = btnRef.current
          if (el && e.target instanceof Node && el.contains(e.target)) return
          var pop = document.getElementById(popId)
          if (pop && e.target instanceof Node && pop.contains(e.target)) return
          setState(function (s) { return Object.assign({}, s, { open: false }) })
        }
        function onKey(e) {
          if (e.key === 'Escape') setState(function (s) { return Object.assign({}, s, { open: false }) })
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        return function () {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [value.open])

      function applyResult(res) {
        if (res && res.ok) {
          setState(function (s) {
            return Object.assign({}, s, {
              busy: false, error: '',
              dirs: Array.isArray(res.directories) ? res.directories : s.dirs,
              cwd: typeof res.cwd === 'string' ? res.cwd : s.cwd,
            })
          })
        } else {
          setState(function (s) { return Object.assign({}, s, { busy: false, error: (res && res.error) || t('error') }) })
        }
      }

      function fail(e) {
        setState(function (s) { return Object.assign({}, s, { busy: false, error: String((e && e.message) || e || '') }) })
      }

      function add() {
        var ui = ctx.uiWorkspace
        if (!ui || typeof ui.pickDirectory !== 'function') {
          setState(function (s) { return Object.assign({}, s, { error: t('error') }) })
          return
        }
        setState(function (s) { return Object.assign({}, s, { busy: true, error: '' }) })
        ui.pickDirectory().then(function (picked) {
          if (!picked) return setState(function (s) { return Object.assign({}, s, { busy: false }) })
          return post({ action: 'add', path: picked }).then(applyResult)
        }).catch(fail)
      }

      function remove(dir) {
        setState(function (s) { return Object.assign({}, s, { busy: true, error: '' }) })
        post({ action: 'remove', path: dir }).then(applyResult).catch(fail)
      }

      function use(dir) {
        setState(function (s) { return Object.assign({}, s, { busy: true, error: '' }) })
        post({ action: 'cd', path: dir }).then(applyResult).catch(fail)
      }

      var count = value.dirs.length
      // The trigger reads as "where this workspace is": the active folder's name,
      // falling back to the generic noun while the first read is still in flight.
      var label = value.cwd ? baseName(value.cwd) : t('chipLabel')
      return h('span', { className: 'mDW-wrap' }, [
        h('button', {
          key: 'chip',
          ref: btnRef,
          type: 'button',
          className: 'mDW-chip',
          title: value.cwd ? (t('chipTitle') + ' — ' + value.cwd) : t('chipTitle'),
          'data-open': value.open ? 'true' : 'false',
          'data-active': count ? 'true' : 'false',
          'aria-expanded': value.open ? 'true' : 'false',
          'aria-controls': popId,
          'aria-label': t('chipTitle'),
          onClick: function (e) {
            e.stopPropagation()
            setState(function (s) { return Object.assign({}, s, { open: !s.open }) })
          },
        }, [
          h(FolderIcon, { key: 'icon' }),
          h('span', { key: 'label', className: 'mDW-chipLabel' }, label),
          count ? h('span', { key: 'count', className: 'mDW-chipCount' }, String(count)) : null,
          h(ChevronIcon, { key: 'chev' }),
        ]),
        value.open ? portal(h(Popover, {
          key: 'pop',
          id: popId,
          ctx: ctx,
          t: t,
          dirs: value.dirs,
          cwd: value.cwd,
          busy: value.busy,
          loading: value.loading,
          error: value.error,
          style: popStyle[0].css,
          side: popStyle[0].side,
          onClose: function () { setState(function (s) { return Object.assign({}, s, { open: false }) }) },
          onAdd: add,
          onRemove: remove,
          onUse: use,
        })) : null,
      ])
    }

    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }) }, 'multi-dir-workspace: locale')
      var t = ctx.locale.bind(NS)

      // 唯一注册点：会话标题之前的全局导航位（root scope，空会话时也在）。
      ctx.slots.inject(SLOT, function () {
        return ctx.slots.register(
          { name: SLOT, id: 'multi-dir-workspace', label: function () { return t('title') } },
          function () { return h(DirectoryChip, { ctx: ctx, t: t }) },
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'uiWorkspace']
    return module.exports
  },
})
