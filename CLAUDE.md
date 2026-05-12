# Claude Code Notes

## Project overview
webOS Synergy service that bridges iMessages from a Mac running [Message Bridge](https://github.com/dremin/message-bridge) into the native webOS Messages app. The Mac exposes a JSON REST API; this service polls it and writes DB8 records that extend `com.palm.chatthread:1` and `com.palm.immessage:1`, which the Messages app renders automatically.

The server running at `192.168.10.3:8080` is the Message Bridge instance on Jon's Mac. The Message Bridge API returns messages **newest-first**.

## Platform constraints
- **ES5 only** — no arrow functions, no `let`/`const`, no template literals, no destructuring. The device runs a very old Node.js.
- All sync operations must be resumable — webOS kills long background syncs. Design for partial completion.
- See `notes.md` for Futures, Kinds, DB8, ActivityManager, and debugging notes.

## Architecture
- `service/serviceEndPoints.js` — all sync logic
- `service/prologue.js` — Foundations imports, Base64, `calcSyncDateTime`, `logNoticeably`
- `app/source/iMessageBridge.js` — Enyo UI (server/port config, manual sync trigger)
- DB8 kinds: `com.wosa.imessage.immessage:1` (messages), `com.wosa.imessage.chatthread:1` (threads), `com.wosa.imessage.transport:1` (server config)
- HTTP is done via `wget -q -O -` through `child_process.exec` in `httpRequestAssistant`

## Bugs fixed (May 2026)
1. **Duplicate message flood** — `DB.find` in `syncChatAssistant` fetched ALL messages from ALL threads with no filter. Once total count exceeded DB8's ~500-record page limit, old messages fell off and were re-inserted every sync. Fixed: added `where` clause filtering by `iMessageId` (current thread's remote ID).

2. **Recursive sync loop** — When new chat threads were discovered, the code called `DB.put` (fire-and-forget) then immediately called `sync` recursively. Because the puts hadn't completed yet, the recursive sync saw the threads as still missing, created them again, and called sync again → infinite loop. Fixed: removed the recursive call. New threads get their messages on the next periodic sync.

3. **Missing `return` after early guard** in `syncChatAssistant` — set `future.result` but didn't stop execution. Fixed.

4. **`args` used before declaration** in `onDeleteAssistant` — `logNoticeably(args)` before `var args = ...`. Fixed.

5. **Global variable leaks** — `replyAddincomingress`, `syncActivity`, `imsgDispatches` in `serviceEndPoints.js` and `c3` in `prologue.js` were all missing `var`. Fixed.

6. **Null crash on failure path** — Both `syncAssistant` and `syncChatAssistant` accessed `future.result.results.length` without first checking `returnValue`. Crashes when any earlier step in the chain fails. Fixed: added `returnValue` guard before each `results` access.

7. **Username failure continued as success** in `syncChatAssistant` — error branch returned `{returnValue: true}` instead of `false`, causing the chain to proceed with blank credentials. Fixed.

8. **Malformed URL when host includes `http://`** — `httpRequestAssistant` builds `"http://" + host + ":" + port`, so a host like `"http://192.168.10.3"` produces `http://http://192.168.10.3:8080/...`. Old webOS wget exits 0 on a bad URL but returns empty stdout, causing the connection test to silently fail. Fixed: `httpRequestAssistant` now strips the protocol prefix and any embedded port from `host` before building the URL.

## Known remaining issues

### Auth credentials never sent
`syncAssistant` and `syncChatAssistant` both compute `base64Auth` from the keymanager credentials but never pass it to `httpRequestAssistant`, which has no parameter for it. `wget` sends no auth header. This is invisible if Message Bridge runs without authentication (common for local use) but would silently fail if auth is enabled. Fix requires: adding an `auth` parameter to `httpRequestAssistant`, threading it through both sync functions, and adding `--header='Authorization: ...'` to the wget command.

### `sendIM` send path confirmed working, but blocked by Message Bridge Mac permissions
`sendIM` POSTs `{"address": iMessageReplyId, "isReply": true, "message": text}` to `POST /chats`. This request reaches Message Bridge and is correctly decoded. However, Message Bridge returns HTTP 400 when its internal AppleScript call to Messages.app fails. This is a **Mac-side issue**: the process running Message Bridge must have Automation permission to control Messages.app (System Settings → Privacy & Security → Automation). If that permission is revoked (e.g. after a macOS update), all sends silently fail with 400. To diagnose: try sending via the Message Bridge web UI at `http://192.168.10.3:8080/` — if that also fails, the problem is the Mac permissions, not this service. Note: BusyBox wget on the webOS device does NOT support `--post-file` or `--post-data` — POSTs must use Node.js `http.request`, not `child_process.exec` + wget.

## Sync delta optimization (May 2026)
`syncAssistant` previously called `syncChat` for every stored thread on every cycle (N HTTP requests). It now compares each remote thread's `lastReceived` ISO string against the `iMessageLastReceived` field stored in the DB8 chatthread record. `syncChat` is only called when that value has changed, so steady-state (no new messages) costs exactly 1 HTTP request (`GET /chats`). The field is written on `DB.put` for new threads and via `DB.merge` immediately before calling `syncChat` for changed threads. Existing threads without `iMessageLastReceived` will do one extra syncChat on the first cycle after upgrade (graceful migration).

## Deployment note
After installing a new .ipk, the service process continues running the old code. You must restart Luna or remove/re-add the Synergy account for changes to take effect. See `notes.md` → Debugging section for the restart command.
