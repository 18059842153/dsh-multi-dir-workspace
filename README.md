# dsh-multi-dir-workspace

A DSH plugin that lets a workspace work with **multiple directories**.

## Why

DSH core workspaces are strictly single-directory (`Workspace.path`). A plugin cannot
patch the core (it lives in `app.asar`), so this plugin layers multi-directory support
on top of the public extension points:

1. An **attached-directories list**, persisted at `$DSH_HOME/multi-dir-workspace.json`.
2. A **prompt context** telling the model every attached directory (so it can use
   absolute paths to read them).
3. **Sandbox write grants** registered per live session via
   `sandboxPolicy.registerWritableRoot` (reads are already permitted everywhere).
4. A `workspace_directories` **tool** (`list` / `add` / `remove` / `cd`) and an HTTP
   route for the UI.
5. One **workspace chip** in the global header, immediately before the session title
   (`conversation.header.leading`). The chip shows the current directory name and opens a
   popover anchored to it (above by default, flipping below when there is no room, with a
   caret pointing at the trigger) to add / switch / remove directories with the native
   picker.

## Usage

- The chip sits in the header next to the session title and shows the current directory
  name, so it is visible in every session and on the empty New Session screen too.
- Click it to open the popover:
  - **+ 添加目录 / Add directory** opens the native directory picker and attaches the result.
  - **切换 / Use** switches the session's working directory to that directory.
  - **移除 / Remove** detaches it.
- Or ask the model: *"add D:\shared\libs to the workspace"* — it calls the
  `workspace_directories` tool.
- The built-in `working_directory` tool also works for `cd`.

## Notes / limitations

- The chip is registered in exactly one place, a root-scope slot, so it is rendered once
  per page and does not depend on a session existing.
- Attached directories are global (one list), not per-workspace, in v1.
- Write grants are runtime-only and re-registered on session start; on Windows only
  DSH's own file tools honor the extra grants (child process permissions are unchanged).
- Paths are canonicalized with `path.resolve`; symlink roots are rejected by the
  sandbox policy for writes but remain readable.

