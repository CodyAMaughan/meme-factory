# Meme Factory

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/create) for making memes without leaving your session.

1. **Ask for one.** Tell Claude "make a meme about this flaky test", or type `/meme standups that run long`.
2. **Keep working.** Drafts cook in a side panel. Claude's tool call returns right away, so nothing waits on the meme.
3. **Review.** The panel shows the 3 best drafts: a picture, the caption, and a judge score. Switch between them with `1` `2` `3`, type feedback ("meaner", "about Mondays", "different format") to remix, or press `a` to approve.
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

Requires **Claude Code v2.1.287 or later** (mods). Tested with v2.1.295.

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
| **Terminal.app, VS Code, Cursor**, other terminals, and anything inside tmux | A one-line note instead of the picture. Press `v` (**View**) to open the meme in a macOS Quick Look window (Esc closes it), or `o` to open it in your browser. |
| **Desktop app** | The meme, embedded as an image (SVG with an inline JPEG). |

The mod decides at startup whether to draw pictures, using the same terminal check Claude Code does. A wide window (about 144+ columns) puts the panel beside the transcript. Narrower windows put it above the prompt, where it scrolls with Page Up and Page Down.

### Settings

| Environment variable | Effect |
|---|---|
| `MEME_FACTORY_MODEL` | Model for writing and judging. An alias like `haiku` or `sonnet`, or a full model id. Default `haiku`. |
| `TYPESAFE_API_KEY` | Uses Jev for template picking and judging, at about $0.0003 per meme |

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
| `hooks/register.js` | Every mods API call: the `make_meme` tool, the `/meme` command, the pipeline, the panel, and the Quick Look viewer |
| `hooks/lib.js` | Pure helpers: prompts, parsing, memegen URLs, Jev request bodies, and PNG sizing |
| `hooks/templates.js` | The memegen.link template catalog |
| `tests/` | `claude plugin test` suites that stub the model, the shell, and the store |

## License

MIT
