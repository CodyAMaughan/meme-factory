# Changelog

All notable changes to Meme Factory. Versions follow [semantic versioning](https://semver.org).

## 0.8.2 (2026-10-09)

- **Slack works in the desktop app, for real this time.** Two causes, both found by testing inside the desktop app:
  - In auto mode, the mod's own Slack calls (the channel list and the upload steps) were refused, because auto mode's classifier had no request of yours to judge them against. The mod now approves exactly those calls of its own; the final share only after you press **Post it**.
  - The desktop app wraps a connector's reply text as a JSON string, so the channel list parsed as empty. Replies are unwrapped now, and each channel is listed once.
- When Slack's channels can't load, the panel says why, with **Try again** and **Ask Claude to post it**, instead of showing no Slack.
- "Teams" no longer appears from the desktop app's own tools mentioning "agent teams".
- **Troubleshooting:** a `meme_factory_debug` tool reports connectors, channels, the last problem and a short log, can re-check them, and can test Slack's upload steps without sharing anything. `MEME_FACTORY_DEBUG=1` also writes each step to the transcript.

Tested in the Claude desktop app (auto mode), in Ghostty (auto mode) and in a default-mode terminal session.

## 0.8.1 (2026-10-09)

- **Slack shows up in the desktop app.** The desktop app can leave on-demand connector tools out of the tool list a mod sees, so the panel offered no Slack channels. The mod now asks the Slack connector for your channels by name when it isn't listed. You may get a one-time permission prompt for Slack.
- **Parallel captions.** On memes that compare or stack things (Drake, before/after, Galaxy Brain, dilemmas), the writer prefers boxes that echo each other, ideally one word swapped: "Software Factory" / "Meme Factory". The judge rewards it. It's a preference, not a rule.

## 0.8.0 (2026-10-09)

- **Your own memegen server, no watermark.** Three optional settings: `MEMEGEN_URL` renders memes on another memegen server (such as one you host), `MEMEGEN_API_KEY` removes the watermark (or `MEMEGEN_WATERMARK` sets your own), and the browser gallery loads pictures from that server. The key is sent only when the mod downloads a picture, as a header curl reads from stdin, so it never appears in a URL, a posted link, or the process list. Without these settings nothing changes.

## 0.7.1 (2026-10-09)

- Ask-before-posting recognizes your memes on any memegen server, by their image path, so a self-hosted server is covered too. Tested: posts Claude makes directly, and through a subagent, both wait for your OK.
- The picture check needs no setup and is on by default. Its helper approves its own reads of the mod's pictures in `~/.cache/meme-factory`, and nothing else, so there's no permission rule to add. Turn it off in **Settings → Drafting**.
- Demo videos re-rendered: a new "Choose the meme" clip, the `m` key, and the panel wordmark in its brand colors.

## 0.7.0 (2026-10-09)

### Pictures that read
- Narrow label boxes (Distracted Boyfriend, Left Exit, Two Buttons and 25 more, measured from memegen's template config) hold at most four words, so text never shrinks to a speck.
- A meme you name is never dropped by the one-liner filter: its shortest draft stays.
- **The picture check** (optional, Settings → Drafting): a helper agent looks at each rendered meme and fixes text that covers a face or can't be read, by shortening that box or moving the text above the picture. It runs behind the drafts.

### Choosing the meme
- **Choose the meme** in the gallery: search all 210 templates and draft three takes on the one you click, or pick it before your next meme.

### Also
- `MEME_FACTORY_DEBUG=1` logs the drafting pipeline to `~/.cache/meme-factory/debug.json`.

## 0.6.0 (2026-10-09)

### Funnier, and the right meme for the joke
- Every template has a card: the kind of joke it tells, what each box is for, and what it's not for. The writer works out the joke's shape first and picks memes that fit it.
- One-liners: at most six words a box and twelve a meme; longer drafts are dropped, and boxes that sit over a face stay short.
- A tougher judge: fit first, then surprise, specificity and brevity, with the shorter caption winning ties. Candidates are shown in a shuffled order.
- Opus writes and Sonnet judges by default; **Settings → Drafting** has a faster Sonnet-only option, and environment variables pick models per job.

### Steering
- Name a meme ("side eye", "use Drake") and it's always drafted.
- **More like this** (`m`) drafts three takes on the meme you're looking at.
- Words in quotes are used exactly as written, and the chat box can set a caption outright.
- New template: Side-Eyeing Chloe.

### Also
- The panel, the gallery and the repo share one wordmark: the sticker on Desktop and in the gallery, its colors in the terminal.
- README: models and your plan, and an optional Jev section.

## 0.5.0 (2026-10-08)

### A new look
- The "Highlighter" palette and a meme-caption wordmark on a chartreuse sticker, in the panel and the gallery, with an eggplant dark mode.
- The panel shows draft picks and scores in its tabs (`● Drake 9`), the Write / Judge / Render stages, and a compact strip of up to six rows in narrow windows.
- The gallery has a progress bar, PICKED and TOP SCORE stickers, a chat column, and the panel's keys.

### Posting
- A **Post to** list (favorites, your Slack channels, places Claude can reach, + Add a connector), quick picks `1` `2` `3`, and `p` to post.
- One post at a time, a confirm step when ask-before-posting is on, and clear posted and couldn't-post states with the message link.
- Destinations match whole words, so `#dev` doesn't catch `#devops`.

### Fixes
- New meme and Check again in the gallery now work. The mod tells the gallery server which events it handles.
- Reloading the gallery page keeps working.
- Truncated or empty image downloads are never drawn or uploaded.
- A judge that doesn't answer keeps the drafts. Junk scores no longer show `NaN`.
- Stored settings and history are validated. Favorites are deduplicated and capped at 20.
- The gallery server rejects malformed input, compares the token in constant time, and sends a stricter Content Security Policy.

### Also
- Demo videos built with HyperFrames (`demo/`), and an adversarial test suite.

## 0.4.0 and earlier

- Post to Slack from the panel, with the image uploaded by the mod and signed "Fresh from the Meme Factory".
- A chat box that turns plain words into remixes, picks, approvals and posts.
- The browser gallery, posting settings, and ask-before-posting.
- Real meme images in Ghostty and kitty, and a note in terminals that can't draw them.
- The first release: make, approve and post memes from Claude Code.
