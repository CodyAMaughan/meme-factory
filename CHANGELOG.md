# Changelog

All notable changes to Meme Factory. Versions follow [semantic versioning](https://semver.org).

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
