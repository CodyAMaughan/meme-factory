# Meme Factory

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/create) for making memes without leaving your session.

1. **Ask for one.** Tell Claude "make a meme about this flaky test", or type `/meme standups that run long`.
2. **Keep working.** Drafts cook in a side panel. Claude's tool call returns right away, so nothing waits on the meme.
3. **Review.** The panel shows the 3 best drafts: a picture, the caption, and a judge score. Switch between them with `1` `2` `3`, type feedback ("meaner", "about Mondays", "different format") to remix, or press `a` to approve. Press `v` to do all of this in your browser instead: the [gallery](#browser-gallery) works from any terminal.
4. **Post.** After you approve, pick a destination: Slack, LinkedIn, X, Discord, Teams, Email, or type any other site. The mod hands the meme to Claude, which posts it through **your connected connectors** once it's free. Claude confirms the exact channel or account with you before it posts anything. A ✓ marks destinations that look connected in the session, and **Browse connectors** opens the [connector directory](https://claude.ai/directory) for anything else.

The mod doesn't include any posting integrations. Posting goes through whichever connectors you've already added to Claude.

## Install

```bash
claude plugin marketplace add CodyAMaughan/meme-factory
claude plugin install meme-factory@meme-factory
```

Or, from inside a session (Claude Code v2.1.275+):

```
/plugin install meme-factory --marketplace CodyAMaughan/meme-factory
```

Requires **Claude Code v2.1.287 or later** (mods), and `python3` for the browser gallery. Tested with v2.1.293 (Desktop) and v2.1.295 (CLI).

## How it works

| Step | What runs |
|---|---|
| Pick 3 templates out of 209 | Claude (Haiku by default) through the mod's own model call, or [Jev](https://typesafe.ai) if `TYPESAFE_API_KEY` is set |
| Write 2 captions per template | Claude (Haiku by default) |
| Judge and rank them | Claude, or Jev if `TYPESAFE_API_KEY` is set |
| Render | [memegen.link](https://memegen.link) (free, URL-based) |
| Post | Claude, using your connectors |

The model calls go through your Claude Code session's own credentials, so you don't need an API key. They count toward your plan's usage like any other request.

### Pictures

| Where | What you see |
|---|---|
| **Ghostty**, **kitty** 0.28+, or cmux | The real meme, in the panel. These terminals support the kitty graphics protocol, which Claude Code's `Image` element uses. |
| **iTerm2** 3.7.3+ | Usually the real meme, if you start Claude with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude`. iTerm2 supports the protocol but fails Claude Code's detection ([anthropics/claude-code#95448](https://github.com/anthropics/claude-code/issues/95448)). Export the variable in your shell: setting it in `settings.json` doesn't work. |
| **Terminal.app, VS Code, Cursor**, other terminals, and anything inside tmux | A one-line note instead of the picture. Press `v` to open the browser gallery. |
| **Desktop app** | The meme, embedded as an image (SVG with an inline JPEG). |

The mod decides at startup whether to draw pictures, using the same terminal check Claude Code does. A wide window (about 144+ columns) puts the panel beside the transcript. Narrower windows put it above the prompt, where it scrolls with Page Up and Page Down.

### Browser gallery

Press `v` in the panel, or run `/meme gallery`, and the Meme Factory opens a page in your browser. Everything you do there goes straight back to the Claude Code session:

- **Drafts:** click a draft to select it, double-click (or **Approve selected**) to approve, and type feedback to remix. You can also start a new meme from the page.
- **Post it:** after you approve, choose one of your favorites, a quick pick (✓ marks destinations that look connected), or type where it should go ("the #random channel on Slack", "my LinkedIn"). Claude works out the connector and the channel.
- **Settings** (`/meme settings`):
  - **Ask me before Claude posts a meme** (on by default). The mod holds any connector call that contains a meme link and asks you **Post it** or **Don't post**. It always asks, auto mode included.
  - **Favorite destinations:** each one is a label plus a description, in words, of where it goes.

The page is served by a small local server, `gallery/server.py`, which needs `python3` and nothing else. It listens on 127.0.0.1 only, answers only requests that carry the session's random token (passed on stdin, so other processes can't read it from `ps`), and refuses other origins and Host headers. It stops when the session ends.

### Settings

| Environment variable | Effect |
|---|---|
| `MEME_FACTORY_MODEL` | Model for writing and judging. An alias like `haiku` or `sonnet`, or a full model id. Default `haiku`. |
| `TYPESAFE_API_KEY` | Uses Jev for template picking and judging, at about $0.0003 per meme |

Posting settings and favorites live in the browser gallery's **Settings** tab and are kept in the mod's store.

Images are cached in `~/.cache/meme-factory/`. Claude Code won't draw a terminal image from a path it considers a network location, such as macOS's `/home` automount. The last 50 approved memes are kept in the mod's store.

## Develop

```bash
git clone https://github.com/CodyAMaughan/meme-factory
cd meme-factory
claude plugin validate --strict .
claude plugin test
claude --plugin-dir .          # hot-reloads hooks/ on save
```

In the Desktop app, set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of your checkout (in your environment, or under `env` in `~/.claude/settings.json`), then start a new session.

| File | Contents |
|---|---|
| `hooks/register.js` | Every mods API call: the `make_meme` tool, the `/meme` command, the pipeline, the panel, the gallery bridge, and the ask-before-posting gate |
| `hooks/lib.js` | Pure helpers: prompts, parsing, memegen URLs, Jev request bodies, PNG sizing, and gallery state |
| `gallery/` | The browser gallery: `server.py` (local server) and `index.html` (the page) |
| `hooks/templates.js` | The memegen.link template catalog |
| `tests/` | `claude plugin test` suites that stub the model, the shell, and the store |

## License

MIT
