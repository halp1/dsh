/**
 * dsh-plugin-open-in-editor, browser half.
 *
 * Every chat file link the agent writes (`[foo.ts](src/foo.ts#L12)`), and
 * every `@file` mention, reaches the right Sidebar through one call:
 * `ctx.sidebarRight.openResource('dsh-resource://file/session/<id>/<path>')`.
 * The Files tree does not; it opens through its tab's own actions.
 *
 * This plugin shadows that one public method. A `file` address whose
 * extension is not in the sidebar list (Markdown, images, PDF, Office by
 * default) is posted to the node half, which runs the VS Code CLI on the host.
 * Everything else, and every failure (no editor, a directory, a missing
 * file, a remote page), falls through to the original sidebar behavior.
 *
 * Shipped as-is in the client module system's closure-factory format.
 * @module dsh-plugin-open-in-editor/client
 */
window.__ModuleLoader__.load({ id: 'dsh-plugin-open-in-editor', factory: (require) => {
  'use strict';
  const module = { exports: {} };

  const FILE_SESSION_PREFIX = 'dsh-resource://file/session/';
  const CONFIG_ROUTE = 'open-in-editor/config';
  const OPEN_ROUTE = 'open-in-editor/open';
  const WRAPPED = Symbol.for('dsh-plugin-open-in-editor.wrapped');
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  /**
   * Parse a session file address.
   * @param {string} address - a `dsh-resource://…` address.
   * @returns {{ sessionId: string, path: string } | undefined} the session and its (relative or absolute) path.
   */
  function parseSessionFile(address) {
    if (typeof address !== 'string' || !address.startsWith(FILE_SESSION_PREFIX)) return undefined;
    const end = address.search(/[?#]/);
    const [id, ...segments] = address.slice(FILE_SESSION_PREFIX.length, end === -1 ? undefined : end).split('/');
    if (id === undefined || id === '' || segments.length === 0) return undefined;
    try {
      return { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') };
    } catch {
      return undefined;
    }
  }

  /**
   * The lowercased extension of a path's final segment ('' for none or dotfiles).
   * @param {string} path - file path.
   * @returns {string} the extension without its dot.
   */
  function extensionOf(path) {
    const name = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  }

  /**
   * Resolve a workspace-relative path against the session cwd (POSIX or Windows).
   * @param {string | undefined} cwd - session workspace root.
   * @param {string} path - relative or absolute path.
   * @returns {string | undefined} an absolute path, or undefined when it cannot be made absolute.
   */
  function absolutePathOf(cwd, path) {
    if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)) return path;
    if (cwd === undefined || cwd === '') return undefined;
    if (path === '') return cwd;
    const windows = /^[A-Za-z]:[/\\]/.test(cwd) && cwd.includes('\\');
    const separator = windows ? '\\' : '/';
    const rel = path.replace(/^(?:\.\/)+/, '');
    return `${cwd.replace(/[/\\]+$/, '')}${separator}${windows ? rel.replace(/\//g, '\\') : rel}`;
  }

  /**
   * Decide where one openResource call goes.
   * @param {{ address: string, options?: { params?: { line?: unknown } }, cwdOf: (sessionId: string) => string | undefined, sidebarExtensions: ReadonlySet<string> }} input
   * @returns {{ path: string, line?: number, workspace?: string } | undefined} the editor target, or undefined for the sidebar.
   */
  function editorTarget({ address, options, cwdOf, sidebarExtensions }) {
    const parsed = parseSessionFile(address);
    if (parsed === undefined || parsed.path === '') return undefined;
    if (sidebarExtensions.has(extensionOf(parsed.path))) return undefined;
    const cwd = cwdOf(parsed.sessionId);
    const path = absolutePathOf(cwd, parsed.path);
    if (path === undefined) return undefined;
    const line = options?.params?.line;
    return {
      path,
      ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
      ...(cwd === undefined || cwd === '' ? {} : { workspace: cwd }),
    };
  }

  /** Whether this page is served from the host machine itself. */
  function isLocalPage() {
    return typeof location !== 'undefined' && LOOPBACK.has(location.hostname);
  }

  /**
   * Shadow `openResource` on the sidebar controller.
   * @param {{ openResource: (address: string, options?: object) => void }} sidebar - `ctx.sidebarRight`.
   * @param {{ cwdOf: (sessionId: string) => string | undefined, config: () => Promise<{ available: boolean, sidebarExtensions: ReadonlySet<string>, localOnly: boolean } | undefined>, open: (target: object) => Promise<boolean>, isLocal?: () => boolean, onError?: (error: unknown) => void }} deps
   * @returns {() => void} restores the original method.
   */
  function install(sidebar, deps) {
    const hadOwn = Object.prototype.hasOwnProperty.call(sidebar, 'openResource');
    const previous = sidebar.openResource;
    const original = previous[WRAPPED] ?? previous;
    const isLocal = deps.isLocal ?? isLocalPage;
    const fallback = (address, options) => {
      try {
        if (options === undefined) original.call(sidebar, address);
        else original.call(sidebar, address, options);
      } catch (error) {
        deps.onError?.(error);
      }
    };
    const route = async (address, options) => {
      const config = await deps.config();
      if (config === undefined || !config.available || (config.localOnly && !isLocal())) return false;
      const target = editorTarget({ address, options, cwdOf: deps.cwdOf, sidebarExtensions: config.sidebarExtensions });
      if (target === undefined) return false;
      return deps.open(target);
    };
    function openResource(address, options) {
      // Non-file addresses (plans, subagent chats, change reviews) never wait.
      if (parseSessionFile(address) === undefined) {
        return options === undefined ? original.call(sidebar, address) : original.call(sidebar, address, options);
      }
      route(address, options).then(
        (opened) => { if (!opened) fallback(address, options); },
        (error) => { deps.onError?.(error); fallback(address, options); },
      );
    }
    openResource[WRAPPED] = original;
    sidebar.openResource = openResource;
    return () => {
      if (sidebar.openResource !== openResource) return;
      if (hadOwn) sidebar.openResource = previous;
      else delete sidebar.openResource;
    };
  }

  /** Read the host config once; a failed read disables routing (sidebar only). */
  function createConfigReader(fetcher) {
    let pending;
    return () => pending ??= (async () => {
      try {
        const response = await fetcher(CONFIG_ROUTE, { headers: { accept: 'application/json' } });
        if (!response.ok) return undefined;
        const payload = await response.json();
        return {
          available: payload.available === true,
          sidebarExtensions: new Set(Array.isArray(payload.sidebarExtensions) ? payload.sidebarExtensions : []),
          localOnly: payload.localOnly !== false,
        };
      } catch {
        return undefined;
      }
    })();
  }

  /** POST one target; true when the host launched the editor. */
  function createOpener(fetcher) {
    return async (target) => {
      const response = await fetcher(OPEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target),
      });
      return response.ok;
    };
  }

  module.exports = {
    name: 'open-in-editor',
    inject: ['sidebarRight', 'sessions'],
    apply(ctx) {
      const fetcher = (input, init) => fetch(input, init);
      const config = createConfigReader(fetcher);
      // Warm the config so the first click does not wait on it.
      void config();
      ctx.effect(() => install(ctx.sidebarRight, {
        cwdOf: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
        config,
        open: createOpener(fetcher),
        onError: error => console.warn('[open-in-editor]', error),
      }), 'open-in-editor: route file links to the editor');
    },
    // Exposed for tests and devtools.
    parseSessionFile,
    extensionOf,
    absolutePathOf,
    editorTarget,
    install,
    createConfigReader,
  };
  return module.exports;
} });
