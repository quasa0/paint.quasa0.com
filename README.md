# Paint

I wanted Microsoft Paint with GPT Image 2.5. So I built it.

Draw, select an area, and describe the edit. Paint puts the result back into your canvas, inside your selection.

**[Open Paint →](https://paint.quasa0.com)** · [Run locally](#run-locally) · [Contribute](CONTRIBUTING.md) · [MIT license](LICENSE)

<img src="docs/screenshots/paint-light.png" alt="Paint with a drawing open, classic drawing tools on the left, and saved drawings and version history on the right." width="1440">

## A paint app, with AI where you need it

- **Edit a selection.** Use a rectangle or free-form lasso, then tell GPT Image 2.5 what to change. Choose Flare or Sunburst and set the output quality.
- **Keep drawing while edits run.** Start separate AI jobs on different parts of the canvas. Each job has its own progress and cancel control.
- **Use the familiar tools.** Pencil, brushes, eraser, fill, eyedropper, text, lines, curves, and shapes. Move, resize, rotate, flip, or duplicate selections.
- **Go back to any version.** Drawings autosave in your browser. Each drawing keeps branching history, so an edit after Undo does not erase the other branch.
- **Work with your images.** Open, drop, or paste an image; export PNG, PNG at 2×, JPEG, WebP, or just the selection. Light and dark themes, custom colors, snapping, pan, and zoom are built in.

## Try an AI edit

1. Open an image or draw something.
2. Select an area with the rectangle or lasso tool.
3. Add your own OpenAI API key and enter a prompt, such as “Make this chart more impressive.”
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

Open the local URL printed by Vite. Drawing tools work without an API key; AI edits require an OpenAI account with access to the configured image models and API billing.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite server |
| `npm run lint` | Check the code with Oxlint |
| `npm run build` | Type-check and build the static app into `dist/` |
| `npm run preview` | Preview the production build locally |

To host your own copy, serve `dist/` from a static host. No application server or server-side API key is required. Each visitor supplies their own key.

## Your images and API key

Paint stores drawings and their version history in IndexedDB. It stores settings and your API key in localStorage, with an IndexedDB copy of the key. This storage belongs to the browser and site you use; clearing site data removes it. Export files you want to keep.

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
