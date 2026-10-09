# Demo videos

The README's videos, built with [HyperFrames](https://github.com/heygen-com/hyperframes) (open source, rendered locally). Each video is one HTML file: the Meme Factory panel and gallery rebuilt as markup and animated with a seekable GSAP timeline, so they re-render exactly whenever the UI changes.

| File | Video | Length |
| --- | --- | --- |
| `index.html` | The whole flow: ask, pick, remix, post | 20s |
| `remix.html` | Remix in plain words | 8s |
| `post.html` | Post to a real channel, with a confirm | 9s |
| `gallery.html` | The browser gallery, light and dark | 8s |
| `anywhere.html` | Ghostty, Terminal.app, and a narrow window | 8s |
| `safety.html` | Nothing posts without you | 7s |
| `banner.html` | The README banner and social preview | still |

Shared pieces live in `assets/`: `mf.css` (the brand and the terminal, pane, keycap and caption styles), `mf.js` (typing, keycaps, captions, swaps, the cursor), the fonts, GSAP, and the meme images from [memegen.link](https://memegen.link).

## Re-render

Needs Node 22+ and FFmpeg. HyperFrames downloads its own headless Chrome on first use (`npx hyperframes browser ensure`).

```bash
scripts/check.sh remix.html 1,3,5   # lint, layout and contrast checks, plus snapshots
scripts/render.sh                   # every video → ../docs/media (MP4 + GIF + banner.png)
scripts/render.sh post              # just one
```

`npm run dev` opens the HyperFrames preview of `index.html` with a timeline you can scrub.

Fonts are under the SIL Open Font License (`assets/fonts/OFL-*.txt`).
