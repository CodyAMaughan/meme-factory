# Contributing to Meme Factory

Thanks for helping. Issues, ideas and pull requests are all welcome. Every pull request is reviewed by the maintainer before it merges, so expect questions, and keep changes small enough to review in one sitting.

## Before you start

- **Bugs:** open an issue with the bug template. Include your Claude Code version (`claude --version`), your terminal or the Desktop app, and what you saw.
- **Features:** open an issue first for anything bigger than a small fix, so we can agree on the shape before you build it.
- **Security issues:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Claude Code v2.1.287 or later and `python3`.

```bash
git clone https://github.com/CodyAMaughan/meme-factory
cd meme-factory
claude --plugin-dir .          # loads your checkout; hooks/ hot-reloads on save
```

In the Desktop app, set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of your checkout, then start a new session.

## Check your change

```bash
claude plugin validate --strict .
claude plugin test .
```

Both must pass. CI runs them on every pull request.

- Add or update a test in `tests/` for every behaviour you change. The suites stub the model, the shell, the store and the connectors, so they run offline in a couple of seconds.
- If you change the panel, try it docked (a window 144+ columns wide) and inline (a narrow window), in a terminal that draws images (Ghostty, kitty) and one that doesn't (Terminal.app).
- If you change the gallery, check it in light and dark mode and at phone width.
- If the UI changes in a way the demo videos show, update `demo/` and re-render (see [demo/README.md](demo/README.md)), or say so in the pull request and the maintainer will.

## Code style

- Match the code around you: plain ES modules, no build step, no dependencies. `gallery/server.py` uses the Python standard library only.
- Keep pure logic in `hooks/lib.js`, where it's easy to test. Mods API calls go in `hooks/register.js`.
- Treat anything from a model, the gallery page or a connector as untrusted input. Validate it before it reaches a tool call, a process, or a prompt.
- UI copy is short and plain: say what happens, in the words the user sees.

## Pull requests

- One change per pull request, with a clear title and a short description of what changed and why.
- Fill in the checklist in the pull request template.
- By contributing, you agree your work is released under the [MIT License](LICENSE) and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
