# Contributing

Run `npm ci`, then `npm run dev`. Use Node.js 24, as specified in `.nvmrc`.

For a bug report, include your browser and OS, the steps to reproduce it, and what you expected. Attach a small example image or a screenshot if it helps. Keep API keys and private images out of issues and pull requests.

Before opening a pull request, run:

```sh
npm run lint
npm run build
```

Check the affected behavior in the browser. For changes to canvas operations, include selections, undo/redo, and saving/reopening the drawing. For AI changes, check that the result stays inside the selection and that cancellation and concurrent jobs still work. Real API calls require your own key and incur charges; ordinary UI work does not need them.

Keep changes focused and explain the problem and resulting behavior in the pull request. Add screenshots for visible interface changes. CI runs the lint and production-build checks.

The editor lives in `src/paint/`; React components subscribe to it through `src/hooks.ts`. Browser persistence uses one database schema in `src/paint/library.ts`.
