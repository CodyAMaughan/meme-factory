<p align="center">
  <img src="docs/media/banner.png" alt="Meme Factory. Fresh from the factory. A Claude Code mod: ask for a meme, keep working." width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-d9f24a?labelColor=19141f"></a>
  <a href="https://code.claude.com/docs/en/plugins/mods/create"><img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-d9f24a?labelColor=19141f"></a>
  <a href="https://github.com/CodyAMaughan/meme-factory/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/CodyAMaughan/meme-factory/actions/workflows/ci.yml/badge.svg"></a>
</p>

**Fresh from the factory.** Meme Factory is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/create). Ask Claude for a meme and three drafts cook in a side panel while you keep working. Pick one, remix it in plain words, approve it, and post it to Slack, signed *Fresh from the [Meme Factory](https://github.com/CodyAMaughan/meme-factory)*.

<p align="center">
  <a href="docs/media/hero.mp4"><img src="docs/media/hero.gif" alt="Asking Claude for a meme: the Meme Factory panel docks beside the transcript, drafts three memes while Claude keeps fixing a test, then the meme is picked, remixed, approved and posted to a Slack channel." width="100%"></a>
</p>

## Install

**Paste this into Claude Code** and it sets everything up:

```text
Install the Meme Factory mod for me. Run `claude plugin marketplace add CodyAMaughan/meme-factory`
and then `claude plugin install meme-factory@meme-factory`. Check that `claude --version` is 2.1.287
or later and that `python3` is available, and tell me if either isn't. Then tell me to run
/reload-plugins (or restart Claude Code) and try `/meme standups that run long`. If I don't have
the Slack connector, point me to https://claude.ai/directory to add it.
```

Or run the commands yourself:

```bash
claude plugin marketplace add CodyAMaughan/meme-factory
claude plugin install meme-factory@meme-factory
```

Inside a session, `/plugin install meme-factory --marketplace CodyAMaughan/meme-factory` does the same.

**Requirements:** Claude Code **v2.1.287 or later** (mods), in the terminal or the Desktop app. `python3` for the browser gallery. To post, a Slack connection (the [Slack connector](https://claude.ai/directory), or Slack's Claude Code plugin) or any other connector that can post. Slack shows the picture only where the mod can upload it ([Pictures or links](#pictures-or-links)).

## How it works

1. **Ask.** Tell Claude "make a meme about this flaky test", or type `/meme standups that run long`. The tool returns right away, so nothing waits on the meme.
2. **Pick.** Three drafts land in the panel, each with a judge's score. Switch with `1` `2` `3`.
3. **Remix in plain words.** Type in the chat box (`t` jumps to it): "meaner", "make it about the PM", "use 2", "different format", "approve it and post it to #social".
4. **Approve and post.** `a` approves. Pick a channel (favorites first) and press `p`, or say where in the chat box ("post it to #social"). Confirm in the panel, and it posts while you keep working. You get the message link.

Each screen shows its own actions first, then the same keys in the same place: `c` Copy, `n` New (a fresh start, chat included), `v` Browser and `t` Talk. After you send a message in the chat box, or click the panel's header, the keys work again.

### Steer it

- **Name the meme.** "a side eye meme about…", "use Drake", "the woman yelling at a cat". A meme you name is always drafted.
- **More like this** (`m`): three fresh takes on the meme you're looking at, instead of new formats.
- **Your own words.** Put them in quotes: `/meme my wife watching me work, top "me: I built a meme factory"`. Quoted words are used exactly as written. To set a caption outright, say it in the chat box: *make the bottom say "my wife:"*.
- **Different format** when the meme itself is wrong for the joke.
- **Pick from the list.** In the browser gallery, **Choose the meme** searches every template ([210 built in, and more](#more-templates)) ("side eye", "two buttons") and drafts three takes on the one you click. Pick one before you've asked for a meme, and your next meme uses it.

### More templates

The 210 built-in templates are memegen.link's. Two sources add more, checked once a day:

- **Imgflip's popular list.** The [100 most-used templates on Imgflip](https://imgflip.com/memetemplates) include memes memegen doesn't have (Bernie "once again asking", Monkey Puppet, Absolute Cinema). The mod adds the top-and-bottom ones and renders them over Imgflip's picture. A model writes each one's card once, the same kind of card the built-in ones have, and skips a meme it doesn't know. Set `MEME_FACTORY_IMGFLIP=0` to leave them out.
- **Your own memegen server.** With `MEMEGEN_URL` set, templates on your server that memegen.link doesn't have join the list, with their text boxes where your server's config puts them. To add one, put a folder in your server's `templates/` with the picture (`default.jpg`) and a `config.yml` that places each box (see memegen's own templates for examples), then redeploy.

`meme_factory_debug` shows how many templates there are and when they were last checked.

Drafts are short on purpose: one-liners, at most six words a box, and four in the narrow label boxes of memes like Distracted Boyfriend. Every template carries a card that says what kind of joke it tells and what each box is for, and the writer picks the meme whose idea fits your joke before it writes a word.

### The picture check

After the drafts land, a helper agent looks at each rendered meme and fixes text that covers a face or is too small to read: it shortens that box, or moves the text above the picture. It runs behind the drafts, so nothing waits on it, and it uses your plan like the rest. There's nothing to set up: the helper may read only the mod's own pictures in `~/.cache/meme-factory`, and it approves those reads itself.

To skip it, turn off **Check the pictures** in the gallery's **Settings → Drafting**.

<table>
  <tr>
    <td width="50%"><a href="docs/media/remix.mp4"><img src="docs/media/remix.gif" alt="Typing meaner, use 2 and different format in the chat box, and the drafts changing each time"></a><br><b>Remix in plain words.</b> Claude turns what you type into actions.</td>
    <td width="50%"><a href="docs/media/pick.mp4"><img src="docs/media/pick.gif" alt="In the gallery, Choose the meme opens a picker; typing side eye finds Side-Eyeing Chloe, and clicking it drafts three takes on Chloe"></a><br><b>Choose the meme.</b> Search every template, or press <code>m</code> for more like the one you're on.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/media/post.mp4"><img src="docs/media/post.gif" alt="Opening the Post to list, choosing #eng-fun, confirming, and the meme landing in the channel"></a><br><b>Post to real channels.</b> Your Slack channels, your favorites, and a confirm step.</td>
    <td width="50%"><a href="docs/media/gallery.mp4"><img src="docs/media/gallery.gif" alt="Pressing v opens the browser gallery; a draft is picked and approved, then the page switches from light to dark"></a><br><b>The browser gallery.</b> Press <code>v</code> for the same flow with bigger pictures.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/media/anywhere.mp4"><img src="docs/media/anywhere.gif" alt="Three terminals side by side: Ghostty with the meme in the panel, Terminal.app with a one-line note, and a narrow window with a six-row strip"></a><br><b>Fits wherever you work.</b> Pictures where the terminal can draw them, a compact strip in narrow windows.</td>
    <td width="50%"><a href="docs/media/safety.mp4"><img src="docs/media/safety.gif" alt="Claude tries to post the meme to LinkedIn in auto mode, and a Meme Factory prompt asks first; the post is declined"></a><br><b>Nothing posts without you.</b> Ask-before-posting holds any post until you say so, even in auto mode or from a subagent.</td>
  </tr>
</table>

## Posting

After you approve, the **Post to** list shows where it can go:

| Destination | What happens |
|---|---|
| **Your Slack channels** | Listed when your Slack connection can list your channels and upload files. The mod uploads the image itself, so Slack shows the picture, signed *Fresh from the Meme Factory 🏭* with a link back here. You get the message link. |
| **Favorites** ★ | Channels or places you saved (★ Save after a post, or Settings). The first three are keys `1` `2` `3`. |
| **Through Claude** | Other connectors that can post (Gmail, or a Slack connection that can't upload), or anything you say in the chat box ("my LinkedIn", "#team on Slack"). After you confirm, the mod's posting helper, a background agent, finds the place with your connectors and posts the meme's link. Its answer comes back to the panel; your conversation with Claude never sees it. |
| **+ Add a connector** | Asks Claude to find one in the [connector directory](https://claude.ai/directory) and show you its Connect card. |

**Ask before posting** is on by default: every post waits for your **Post it** in the panel or the gallery, whichever way it goes out. Posts Claude makes for you in the conversation are held when Claude calls the connector, with a **Post it / Don't post** question, in every permission mode.

The posting helper is held to its job by its own hooks: it uses only your connectors (no shell, no files), and it posts once, and only the meme you approved. The panel shows the post the helper's hooks recorded, not what the helper says it did.

### Pictures or links

Slack shows the meme itself only when the mod can upload it, which takes a Slack connection with Slack's channel list and file upload tools (`slack_list_user_channels`, `slack_get_file_upload_url`, `slack_complete_file_upload`). Some Slack connections offer only messages, search and canvases, depending on the workspace; there the meme goes out as its link. To see which you have, ask Claude to run `meme_factory_debug` with `upload_check`: it tests the upload steps without sharing anything.

The mod includes no posting integrations of its own: it uses the connectors you've added to Claude.

## Pictures

| Where | What you see |
|---|---|
| **Ghostty**, **kitty** 0.28+, cmux | The real meme, in the panel (kitty graphics protocol). |
| **iTerm2** 3.7.3+ | The real meme if you start Claude with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude` ([why](https://github.com/anthropics/claude-code/issues/95448)). Export it in your shell; `settings.json` doesn't work. |
| **Terminal.app**, **VS Code**, **Cursor**, tmux | A one-line note. Press `v` for the browser gallery. |
| **Desktop app** | The meme, as an image. |

In a wide window (about 144+ columns) the panel docks beside the transcript. In a narrower one it's a strip of up to six rows above the prompt. When Claude starts a meme in a window under 144 columns, Claude Code won't open the side panel for the mod on its own, so the strip shows above the prompt with **Open the panel** (`e`). Once you've opened the panel yourself, Claude's memes open it from 110 columns.

## The browser gallery

Press `v` in the panel, or run `/meme gallery`. Everything there goes straight back to your session:

- **Drafts:** pick with a click or `1` `2` `3`, **Approve** with `a`, **Remix all** with `r`, and `/` for the chat box.
- **Post it:** favorites, a searchable list of your Slack channels, then **Post to #channel** (`p`), confirm (`y` / `n`), and the message link.
- **Settings** (`/meme settings`), saved as you change them: ask before posting, signing posts, favorites (in order, reorderable), and which connectors this session can post through.

It's a small local server (`gallery/server.py`, standard library only) on `127.0.0.1`. It answers only requests that carry the session's random token, refuses other origins and hosts, and stops when the session ends.

## Models and your plan

The mod's model calls run through **your Claude Code session's own credentials**: your subscription or your own account, with no API key and nothing to configure. They count toward your plan like any other request.

| Job | **Best drafts** (default) | **Fast** |
|---|---|---|
| Write the captions | Opus | Sonnet |
| Judge and rank them | Sonnet | Sonnet |
| Chat box | Sonnet | Sonnet |
| Posting helper | Sonnet | Sonnet |
| Typical batch | about 15 seconds | about 5 seconds |

Drafts cook in the background, so the default spends the extra seconds on funnier captions. Switch to **Fast** in the gallery's **Settings → Drafting** if you'd rather go easy on your plan. To pick models yourself, set any of these (an alias like `opus`, `sonnet` or `haiku`, or a full model id):

| Environment variable | Overrides |
|---|---|
| `MEME_FACTORY_WRITER_MODEL` | The writer |
| `MEME_FACTORY_JUDGE_MODEL` | The judge |
| `MEME_FACTORY_CHAT_MODEL` | The chat box |
| `MEME_FACTORY_MODEL` | All three |

Two more switches: `MEME_FACTORY_CHECK_PICTURES=1` forces the [picture check](#the-picture-check) on, and `MEME_FACTORY_DEBUG=1` logs each step of the drafting pipeline (models, timings, the drafts kept, the picture check) to `~/.cache/meme-factory/debug.json`, which helps with bug reports.

Posting settings, favorites and the drafting choice live in the gallery's **Settings** tab.

## Optional: Jev

Meme Factory works without any extra keys. If you have a [Jev](https://typesafe.ai) API key, the mod can hand two decisions to Jev instead of Claude: **picking the templates** and **judging the drafts**. Jev is a fast, low-cost decision API: about $0.0003 per meme, billed by Jev. The writing always stays with Claude.

1. Get an API key at [typesafe.ai](https://typesafe.ai).
2. Make it visible to Claude Code, in your shell profile:
   ```bash
   export TYPESAFE_API_KEY=your-key
   ```
   or under `env` in `~/.claude/settings.json`:
   ```json
   { "env": { "TYPESAFE_API_KEY": "your-key" } }
   ```
3. Restart Claude Code. Remove the key to go back to Claude for everything.

If Jev can't be reached, the mod falls back to Claude for that step. With a key set, Jev receives the meme request and the draft captions.

## Optional: your own memegen, no watermark

By default, pictures come from the public [memegen.link](https://memegen.link) API, which adds a small "Memegen.link" watermark. Three optional settings change that:

| Variable | Effect |
|---|---|
| `MEMEGEN_URL` | Render on another memegen server instead, such as one you host (`https://memes.example.com`). |
| `MEMEGEN_API_KEY` | Sent when the mod downloads images (in a header, read from stdin, so it never appears in a URL, a posted link, or the process list). With a valid key, downloads ask for `watermark=none`. |
| `MEMEGEN_WATERMARK` | With a key: your own watermark text instead of none, such as `example.com`. |
| `MEME_FACTORY_IMGFLIP` | `0` leaves out [Imgflip's popular templates](#more-templates). |

Set them like the Jev key (shell profile or `env` in `~/.claude/settings.json`) and restart Claude Code.

Two ways to get there:

- **memegen.link's own key.** memegen.link issues API keys to [GitHub sponsors](https://github.com/sponsors/jacebrowning) ($10/month and up) and on request. Set `MEMEGEN_API_KEY` only.
- **Host memegen yourself.** It's MIT-licensed and small. Stock memegen always watermarks unless it can reach memegen.link's private key service, so self-hosting needs two settings on the server: `DEFAULT_WATERMARK` (empty for none) and `API_KEYS` (comma-separated keys it accepts). They're a 10-line patch, on the `self-host` branch of a memegen clone. A small container is plenty (about 512 MB); it renders a meme in a fraction of a second and caches the results. Point the mod at it with `MEMEGEN_URL`, and hand out keys from `API_KEYS` to people you want to allow custom or no watermarks.

Previews in the browser gallery and posted links use the plain URL, so on memegen.link they still show the watermark. Images the mod downloads, shows in the panel, and uploads to Slack use the key.

## Privacy

- **Model calls** go through your Claude Code session's own credentials (see [Models and your plan](#models-and-your-plan)).
- **Pictures** are rendered by [memegen.link](https://memegen.link), or the server in `MEMEGEN_URL`, from the template and the caption text, and cached in `~/.cache/meme-factory/`. memegen.link says requests without a key may be used as training data.
- **Posts** go only where you send them, through your connectors. The posting helper can use only your connectors, and post only the meme you approved, once.
- **Templates:** once a day the mod reads Imgflip's public template list (and your server's, with `MEMEGEN_URL`). Nothing about you or your memes is sent.
- **Jev**, if you set `TYPESAFE_API_KEY`, receives the meme request and the draft captions.
- The mod keeps your settings and your last 50 approved memes in its local store.

## Troubleshooting

- **The panel didn't open.** A panel the mod opens by itself waits for a window at least 144 columns wide, so in a narrower one the strip shows above the prompt. Press **Open the panel** in it (`e`, after `ctrl+x tab` or a click), or run `/meme`.
- **No picture in the terminal.** See [Pictures](#pictures). Press `v` to see it in the browser.
- **"The gallery needs python3".** Install Python 3, or use the panel.
- **No Slack channels listed.** Listing them needs a Slack connection with the channel list ([Pictures or links](#pictures-or-links)). Without one, say where in the chat box ("post it to #social on Slack") and the posting helper finds it.
- **"Auto mode blocked the mod's Slack call."** Some Claude Code builds (the desktop app's 2.1.293, for one) put the mod's own Slack calls to auto mode's check, which refuses a call you didn't ask Claude for in the chat, such as a press of **Post it**. The mod then tries Slack's tools, and if those are refused too, the panel names the three tools to allow. Add them to `"permissions": { "allow": [...] }` in `~/.claude/settings.json`, spelled as the panel shows them (the desktop app's Slack names carry an ID). Other permission modes don't need them.
- **Added the Slack connector, but nothing changed.** If Slack's Claude Code plugin is enabled too, Claude Code loads only the plugin, since they're the same Slack server. Keep one: `claude plugin disable slack@claude-plugins-official` lets the connector load.

## Develop

```bash
git clone https://github.com/CodyAMaughan/meme-factory
cd meme-factory
claude plugin validate --strict .
claude plugin test .
claude --plugin-dir .          # hot-reloads hooks/ on save
```

In the Desktop app, set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of your checkout (in your environment, or under `env` in `~/.claude/settings.json`), then start a new session.

| Path | Contents |
|---|---|
| `hooks/register.js` | Every mods API call: the `make_meme` tool, `/meme`, the drafting pipeline, chat, Slack posting and the posting helper, the panel, the gallery bridge, and the ask-before-posting gate |
| `hooks/lib.js` | Pure helpers: prompts, parsing, memegen URLs, Jev requests, PNG sizing, connector detection, destinations, the posting helper's prompt and hooks |
| `hooks/templates.js` | The memegen.link template catalog |
| `gallery/` | The browser gallery: `server.py` and `index.html` |
| `tests/` | `claude plugin test` suites, with the model, shell and store stubbed |
| `demo/` | The videos above, built with [HyperFrames](https://github.com/heygen-com/hyperframes). See [demo/README.md](demo/README.md) to re-render. |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Every change is reviewed by the maintainer before it merges.

## License

[MIT](LICENSE). Meme templates are rendered by [memegen.link](https://memegen.link). Demo fonts are under the SIL Open Font License.
