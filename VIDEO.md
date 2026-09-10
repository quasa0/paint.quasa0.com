# Paint video context

Last updated: 2026-09-10. This document records the launch-video work and the later GitHub demo changes from this thread.

## Current state

Revision 4 is the latest launch edit: a silent, square, 16.5-second demonstration of three concurrent AI edits. Remotion creates the edit and all animation. The opening says: “I wanted Microsoft Paint with GPT Image 2.5. So I built it.” The address is `paint.quasa0.com`.

The [README](README.md) now displays `docs/demo.webp` directly. It is an animated WebP, not an MP4 player. This implements the request to show the demo without a collapsible “spoiler” box. The optimized MP4 remains available as a public GitHub attachment; its URL appears below as code to avoid another automatic embed.

No video work remains pending at this checkpoint. The user has not requested another cut or a new recording.

## Direction and revision history

The original task was a launch video for Twitter. The story is personal and concrete: a familiar Paint app with selection-based GPT Image 2.5 editing.

| Revision | Recording | What changed |
| --- | --- | --- |
| v1 | `Screen Recording 2026-09-09 at 18.16.42.mov` | Charcoal presentation. The user rejected the dark treatment. |
| v2 | Same recording | White presentation, larger headline and address, colorful OpenAI “2.5” graphics, and a blue URL pill. A 12-second edit made with the earlier Python/FFmpeg renderer. |
| v3 | `Screen Recording 2026-09-09 at 19.24.08.mov` | Rebuilt in Remotion after the user explicitly required it. Expanded to 16.5 seconds to show three concurrent edits. Still used the decorative model graphics and blue URL pill. |
| v4 | Same newer recording | Removed those graphics and the URL pill after explicit user rejection. Uses plain typography, a larger recording, and quieter motion. This is the latest delivered video. |

Preserve these decisions in future edits:

- Use Remotion for cuts, speed changes, camera motion, captions, and other animation. FFmpeg can prepare source media and encode the finished render.
- Keep the background white and the model name plain black text. Do not restore the balloon “2”, smiley period, decorative “5”, or highlighted URL pill.
- Show the address as unboxed text at the lower right. Keep the app recording large enough to understand the actions.
- Use the recording’s native selection UI. Revision 4 removed added blue outlines, numbered markers, spinners, and the arrow.
- Show real recorded results. Caption descriptions are paraphrases; they must not imply that invented prompts or gestures occurred. Disclose shortened waits and accelerated playback.

The user asked to study the media in [OpenAI’s Images 2.5 announcement](https://openai.com/index/introducing-chatgpt-images-2-5/). The local reference collection contains eight videos and 57 images. Its white presentation, typography, and explanatory captions informed the edit. The later rejection of the decorative graphics overrides that earlier reference direction. Revision 4 contains no OpenAI announcement graphics or demo footage.

## Source and timing

The current source is `Screen Recording 2026-09-09 at 19.24.08.mov` at the repository root: 2726×2372, approximately 56.817 seconds, variable frame rate, and no audio. It shows separate prompts for the diagram, quote, and attribution, followed by the actual generated results. Preserve the original recording.

The composition is `AiPaintLaunch`: 1440×1440, 30 fps, 495 frames. Its source proxy is 2048 pixels wide at 30 fps. Both source offsets and composition offsets use a 30 fps timebase in the code.

| Output time | Source time | Treatment |
| --- | --- | --- |
| 0.0–0.7 s | 0.2 s | Hold the opening view. |
| 0.7–3.9 s | 0.2–5.0 s | Diagram selection and prompt, 1.5×. |
| 3.9–6.7 s | 5.0–10.6 s | Quote selection and prompt, 2×. |
| 6.7–9.5 s | 13.0–18.6 s | Attribution selection and prompt, 2×. |
| 9.5–10.3 s | 18.6–20.2 s | Concurrent jobs, 2×. |
| 10.3–13.3 s | 44.0–53.0 s | Results arrive, 3×. |
| 13.3–16.5 s | 53.0–56.2 s | Final result at normal speed; return to the complete app. |

The cut removes the source pause at 10.6–13.0 seconds and the generation wait at 20.2–44.0 seconds. Camera zoom reaches 1.20× and returns to 1×. Captions include “Generation wait shortened” and “Playback accelerated”. The final caption is “Edited where you choose.”

## Files and Git coverage

All paths below are relative to the repository root. The `launch-video/` directory and raw recordings exist in the original working copy but are ignored by Git. A fresh clone does not contain the Remotion project, original recordings, reference downloads, local font, or launch exports.

| File | Purpose | Size |
| --- | --- | --- |
| `launch-video/ai-paint-launch-v4-master.mp4` | 1440×1440 Remotion master | 10,859,121 bytes |
| `launch-video/ai-paint-launch-v4-twitter.mp4` | 1080×1080 upload export | 6,110,200 bytes |
| `launch-video/ai-paint-launch-v4-poster.jpg` | Poster from composition frame 460 | 324,476 bytes |
| `launch-video/ai-paint-demo-github.mp4` | Optimized 1080×1080 MP4 | 2,046,416 bytes |
| `docs/demo.webp` | Current inline README animation; tracked in Git | 3,419,102 bytes |

The Remotion project is `launch-video/remotion/`. Its main composition is `src/LaunchVideo.tsx`; `src/Root.tsx` declares the dimensions and duration. `scripts/prepare.mjs` prepares assets, and `scripts/render.mjs` exports the videos and poster. `launch-video/encode-github.sh` produces the optimized MP4.

For older details, see the local `launch-video/edit-notes.md`, `launch-video/reference-notes.md`, and `launch-video/archive/`. Those notes describe earlier checkpoints: the reference notes still describe graphics removed in v4, and the edit notes’ statement that nothing was published predates the GitHub work. This document records the later state.

The landing page has separate local encodes in `public/demo/`: `demo-av1.mp4` (945,886 bytes), `demo-h265.mp4` (1,053,909 bytes), and `demo-h264.mp4` (1,724,718 bytes). These derive from the same v4 master but are separate from the GitHub MP4. At this checkpoint, Git tracks the posters in that directory but excludes its MP4 files under the global `*.mp4` rule. A fresh clone therefore also needs those video assets before it can reproduce the landing-page demo.

## Reproduce the outputs

The local package pins Remotion to 4.0.523 and React to 19.2.8. Asset preparation requires FFmpeg, the original MOV, and macOS’s `/System/Library/Fonts/SFNS.ttf`. The script copies that font into ignored local assets; do not assume the font is part of the public repository.

From `launch-video/remotion/`, run:

```sh
npm ci
npm run assets
npm run check
npm run preview
npm run render
```

`preview` renders selected frames into `qa/`; it does not start a server. `render` writes both MP4s and the poster. The renderer uses four workers, H.264, yuv420p, the slow preset, and CRF 17 for the master or CRF 18 for the upload export. It closes its browser and removes its temporary bundle on completion or cancellation. `npm run studio` is available for interactive editing; stop it when finished.

From the repository root, run `sh launch-video/encode-github.sh` for the smaller MP4. It scales the master with Lanczos and uses H.264 High Level 4.0, yuv420p, preset `veryslow`, CRF 22, four threads, and fast start. It removes audio and copied metadata. It preserves all 495 frames at 30 fps.

To recreate the README animation from that MP4:

```sh
/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg -hide_banner \
  -i launch-video/ai-paint-demo-github.mp4 \
  -vf 'fps=15,scale=720:720:flags=lanczos' \
  -c:v libwebp_anim -quality 76 -compression_level 4 \
  -loop 0 -an -y docs/demo.webp
```

The default FFmpeg executable on the editing Mac lacked `libwebp_anim`; the `ffmpeg-full` build provided it. Elsewhere, use a build with that encoder. The output has 225 encoded frames after duplicate-frame coalescing and a duration of 16.532 seconds, reflecting frame-time rounding at 15 fps. An earlier 900×900, 30 fps WebP was 9.8 MB and was rejected for size.

## GitHub embedding findings

The public MP4 attachment is:

`https://github.com/user-attachments/assets/6245a070-693a-441e-bf85-2317e5b477cf`

The first upload played while signed in but returned 404 anonymously. Re-uploading and committing the attachment through GitHub’s web editor resolved that problem. Anonymous download then returned the complete MP4, with the same SHA-256 as the local file. Verify public access after future uploads; an authenticated preview alone is insufficient.

On September 10, GitHub’s README renderer produced a collapsible attachment frame for each of these tested forms: a bare attachment URL, a direct `<video src>` element, the same URL with `?raw=true`, and an image linked to the attachment URL. A `<video>` with a nested `<source>` produced no player. These are observed renderer behaviors, not assumptions about every Markdown host.

The working README markup is simply `![Paint demo](docs/demo.webp)`. Do not wrap that image in a link to the MP4 attachment: GitHub replaced the entire linked image with its video frame. The animation currently has no MP4 playback controls. This is the tradeoff used to satisfy the request for a demo with no collapsible wrapper.

Relevant commits: `0bbafc8` finalized the public MP4 attachment; `09f2f4e` contains the WebP alongside concurrent app changes; `f4c8499` changes the README to the final direct-image markup. Preserve unrelated app changes when working in this checkout.

## Verification and next-edit checks

The v4 exports passed TypeScript checks, full video decoding, frame-count checks, and visual review of the encoded opening, selections, results, and final frame. Both MP4s use fast start. A per-frame check confirmed that the plain URL remained visible throughout all 495 frames.

The optimized MP4 is about 67% smaller than the v4 upload export. Against the master scaled to 1080×1080, it measured mean VMAF 96.997. A CRF 25 candidate was smaller at 1,331,441 bytes but scored 95.770 and softened small interface text, so CRF 22 was selected.

Pillow decoded every frame of the final WebP. Helium checks confirmed that the README image loaded at 720×720, had no enclosing `<details>`, and animated across successive screenshots. All video-render and encoder processes started for this work exited; no local server remains from the video work.

For a new cut, inspect the new recording before changing timing, then render preview frames before the full export. Check small interface text, caption timing, the final result, and the URL in the encoded output. Recheck GitHub’s actual render after publication. Keep raw recordings, downloaded reference media, and local fonts out of an unrelated documentation commit.
