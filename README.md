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

- **Terminal:** a color thumbnail drawn with half-block characters. On macOS it uses the built-in `sips` to shrink the image. Elsewhere you get the caption and a link to the full image.
- **Desktop app:** the meme is embedded as an image (SVG with an inline JPEG).
- **Both:** "Open full image" links to the full-size PNG.

### Settings

| Environment variable | Effect |
|---|---|
| `MEME_FACTORY_MODEL` | Model for writing and judging. An alias like `haiku` or `sonnet`, or a full model id. Default `haiku`. |
| `TYPESAFE_API_KEY` | Uses Jev for template picking and judging, at about $0.0003 per meme |

Images are cached in `~/.cache/meme-factory/`. The last 50 approved memes are kept in the mod's store.

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
| `hooks/register.js` | Every mods API call: the `make_meme` tool, the `/meme` command, the pipeline, and the panel |
| `hooks/lib.js` | Pure helpers: prompts, parsing, memegen URLs, Jev request bodies, and BMP-to-half-block decoding |
| `hooks/templates.js` | The memegen.link template catalog |
| `tests/` | `claude plugin test` suites that stub the model, the shell, and the store |

## License

MIT
