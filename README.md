# Paint

I wanted Microsoft Paint with GPT Image 2.5. So I built it.

Draw, select an area, and describe the edit. Paint puts the result back into your canvas, inside your selection.

**[Open Paint →](https://paint.quasa0.com/app/)** · [Run locally](#run-locally) · [Contribute](CONTRIBUTING.md) · [MIT license](LICENSE)

https://github.com/user-attachments/assets/9be3b54f-4b81-4c8f-87de-09b1baeede30

## A paint app, with AI where you need it

- **Edit a selection.** Use a rectangle or free-form lasso, then tell GPT Image 2.5 what to change. Choose Flare or Sunburst and set the output quality.
- **Keep drawing while edits run.** Start separate AI jobs on different parts of the canvas. Each job has its own progress and cancel control.
- **Use the familiar tools.** Pencil, brushes, eraser, fill, eyedropper, text, lines, curves, and shapes. Move, resize, rotate, flip, or duplicate selections.
- **Go back to any version.** Drawings autosave in your browser. Each drawing keeps branching history, so an edit after Undo does not erase the other branch.
- **Work with your images.** Open, drop, or paste an image; export PNG, PNG at 2×, JPEG, WebP, or just the selection. Light and dark themes, custom colors, snapping, pan, and zoom are built in.

## Try an AI edit

1. Open an image or draw something.
2. Select an area with the rectangle or lasso tool.
3. Sign in with OpenAI (uses your ChatGPT plan) or add your own API key, then enter a prompt, such as “Make this chart more impressive.”
4. Generate. Continue working elsewhere while the edit runs, or undo the result if you prefer the original.

By default, the model receives the selection's bounding rectangle. **Image → AI sees surroundings too** includes nearby pixels for context. For a lasso, the request can include pixels outside its outline but inside that rectangle; Paint clips the returned patch to the lasso. Pixels outside the selection stay unchanged.

<details>
<summary>See the dark theme</summary>

![Paint in dark mode](docs/screenshots/paint-dark.png)

</details>

## Run locally

Use Node.js 24 LTS and npm. `.nvmrc` selects the same Node version as CI.

```sh
git clone https://github.com/quasa0/paint.quasa0.com.git
cd paint.quasa0.com
npm ci
npm run dev
```

Open the local URL printed by Vite. Drawing tools work without an account. AI edits need either an OpenAI sign-in (ChatGPT Plus, Pro or Team) or an API key with access to the image models. The sign-in path is relayed by the Vercel function in `api/codex-images.ts`, which the dev server also runs.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite server |
| `npm run lint` | Check the code with Oxlint |
| `npm run build` | Type-check and build the static app into `dist/` |
| `npm run preview` | Preview the production build locally |

To host your own copy, deploy to Vercel (the `api/` function relays sign-in requests) or serve `dist/` from a static host with the API-key path only. No server-side key is required; each visitor brings their own account.

## Your images and API key

Paint stores drawings and their version history in IndexedDB. It stores settings, your API key and sign-in tokens in localStorage, with an IndexedDB copy. This storage belongs to the browser and site you use; clearing site data removes it. Export files you want to keep.

AI requests go directly from your browser to OpenAI's [image edits API](https://developers.openai.com/api/docs/guides/image-generation). Paint has no backend that collects your key or drawings. AI edits send your prompt and the image region described above to OpenAI, and OpenAI bills your account. The browser stores the key as readable text, so use the app only on devices and deployments you trust.

## Code map

React and TypeScript provide the interface; Canvas 2D handles pixels. Vite builds the static app.

| Location | Responsibility |
| --- | --- |
| `src/paint/editor.ts` | Tools, selections, editor state, and concurrent AI jobs |
| `src/paint/ai.ts` | Image request preparation, OpenAI calls, and result placement |
| `src/paint/doc.ts` and `draw.ts` | Canvas operations and drawing primitives |
| `src/paint/library.ts` | Browser database, saved drawings, and versions |
| `src/components/` | Menus, workspace, palette, dialogs, and sidebars |

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and useful reproduction details.

## License

[MIT](LICENSE). Built by [Anatolii / quasa0](https://github.com/quasa0).
