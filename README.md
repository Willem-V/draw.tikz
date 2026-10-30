<h1>
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="src/icons/logo-dark.svg" />
		<img src="src/icons/logo-light.svg" alt="draw.tikz" height="64" />
	</picture>
</h1>

An interactive, visual editor for creating electrical circuit diagrams for LaTeX/CircuiTi*k*Z with ease.

draw.tikz is a fork of [CircuiTi*k*Z-Designer](https://github.com/Circuit2TikZ/CircuiTikZ-Designer) by Manuel Kirzinger, Philipp Wiedemann and Christof Pfannenmüller (FAU), licensed under [GPL-3.0](LICENSE). The goal is to extend it step by step towards a general GUI for Ti*k*Z drawings.

## Two ways to use it

### 1. Online

**<https://willem-v.github.io/draw.tikz/>**

Drawings are stored in the browser (per address). Save your drawing regularly as a JSON file (Ctrl/⌘ + S) to be safe.

### 2. VS Code extension

The extension opens `*.drawtikz.json` files in the draw.tikz editor inside VS Code, so a drawing is a normal file that lives (and is versioned) next to your LaTeX project.

1. Download `draw-tikz-<version>.vsix` from the latest [release](https://github.com/Willem-V/draw.tikz/releases)
2. In VS Code: Extensions view > `...` > **Install from VSIX...** (or `code --install-extension draw-tikz-<version>.vsix`)
3. Right-click a folder in the Explorer > **New drawing** (or the command `draw.tikz: New drawing`), or open any existing `*.drawtikz.json`

Saving and undo/redo go through VS Code like for any other file. Exporting to Ti*k*Z or SVG writes the file into the workspace: the first export of a drawing suggests the folder from the setting `drawtikz.defaultExportFolder` (default `fig`), later exports overwrite the same file.

Reusable components ("Save as component", see below) are saved into the folder from the setting `drawtikz.componentFolder` (default `components`). All drawings in that folder are listed under "My components" in the symbol picker and update when the files change.

All controls of the editor are explained in the help menu (circled question mark in the top right corner).

## Changes compared to CircuiTi*k*Z-Designer

- **VS Code extension:** edit `*.drawtikz.json` files in VS Code and export straight into the LaTeX project (see above)
- **Variable sources:** a "Variable" switch on all voltage and current sources draws a diagonal arrow over the symbol (also exported to Ti*k*Z)
- **Transistor arrow position:** environment setting for `\ctikzset{transistors/arrow pos=...}`, defaulting to the end of the terminal. The canvas symbols for this are generated with [scripts/generateArrowEndSymbols.py](scripts/generateArrowEndSymbols.py)
- **Enable axes:** the axes can be hidden like the grid; the grid setting is now also restored correctly
- **Rectangle arrays:** a "Draw as array" switch on rectangles draws extra offset outlines at the top and right (adjustable number of layers and offset), so a rectangle around a device shows an array of devices (also exported to Ti*k*Z)
- **Rectangles as frames:** unfilled rectangles without text can only be selected at their border, so components inside them can be clicked and the rectangle can be deselected
- **Straight lines and arrows** stay straight after undo, copy/paste and reloading, and diagonal segments stay straight when resizing
- **Flipping/rotating** a single component no longer moves it
- **Labels** are at the correct position directly after loading a JSON file
- **Line width for symbols:** every node and path symbol has a "Line width" setting that scales all its strokes like CircuiTi*k*Z's `line width` option (also exported to Ti*k*Z and SVG)
- **Resizable blocks:** the generic two port (split) blocks and the European blank (not) ports have width, height and "Lock aspect ratio" instead of a scale, adjustable with drag handles on the canvas and exported with the matching CircuiTi*k*Z keys. Two port blocks can also contain text (`t=`)
- **Block with pins and Mux** (Block diagram group): a rectangle, and a mux trapezoid with separate left and right height, with a configurable number of pins on each side (left, right, top, bottom; 0–16), resizable with handles. The mux can also have square pins. Both are exported as a CircuiTi*k*Z `muxdemux`, so the pins are available as `lpin 1`, `rpin 2`, `tpin 1`, `bpin 3`, …
- **Symbol picker:** the symbol panel pops up in the middle of the screen (Q or I) and can be used with the keyboard like a picker in vim: type to search (fuzzy or regex), Enter places the highlighted symbol, Ctrl+J/K moves while typing, Tab switches to normal mode with h/j/k/l, gg/G and / (Tab goes back), Esc closes
- **SVG export for Office:** text inside symbols (e.g. T, Q and Q̄ on flip-flops) and labels no longer disappear when the exported SVG is used in PowerPoint or Word
- **Grid switch** at startup now matches whether the grid is visible
- **Reusable components:** select a part of a drawing and click "Save as component" (properties panel, also on a group) to save it as its own `.drawtikz.json` file. It shows up under "My components" in the symbol picker and is placed like a symbol: it follows the cursor, snaps to the grid, can be rotated and flipped, and a click places it as a group. "Import file..." in the same group places any drawing. In the browser the components are kept in the browser storage; in VS Code they are the files in the component folder of the workspace
- No Google Analytics, no Electron desktop app

## Features

- **Visual circuit design** with multi-tab support and component grouping
- **Component library** with most CircuiTi*k*Z elements plus Ti*k*Z shapes like rectangles, ellipses and arrows
- **Export** to clean CircuiTi*k*Z code and to SVG
- **Editing:** rotate, scale, align, distribute and snap components; switch component variants and adjust their properties in the properties window
- **MathJax** math in text components, rendered live

## Development

Requires [Node.js](https://nodejs.org/) v20.

**Web app:** run `npm ci`, then `npm start` serves the working tree on <http://localhost:1234> and reloads on every change.

**VS Code extension** (in [vscode/](vscode)): the extension bundles the built web app.

```sh
npm ci                      # in the project root, the extension build uses its parcel
cd vscode
npm ci
npm run package             # builds the app and extension, writes draw-tikz-<version>.vsix
code --install-extension draw-tikz-<version>.vsix
```

`npm run check` type-checks the extension code.

## Hosting and releases (GitHub Actions)

Two workflows in [.github/workflows](.github/workflows):

- **[pages.yml](.github/workflows/pages.yml):** every push to `main` builds the web app and publishes it with GitHub Pages (Settings > Pages > Source: GitHub Actions)
- **[release.yml](.github/workflows/release.yml):** a version tag `vX.Y.Z` builds the VS Code extension, creates a GitHub Release with the `.vsix` attached and publishes it to the VS Code Marketplace

To release a new extension version:

1. Bump `version` in [package.json](package.json) (shown in the app) and [vscode/package.json](vscode/package.json) (the workflow fails if the tag does not match both) and commit
2. `git tag vX.Y.Z && git push origin main vX.Y.Z`

GitHub Actions is free for public repositories.

### VS Code Marketplace

The release workflow also publishes the extension to the [VS Code Marketplace](https://marketplace.visualstudio.com/manage) under the publisher `willem-v`, with Trusted Publishing (OpenID Connect from GitHub Actions, no stored token). This needs a Trusted Publishing policy on the publisher for owner `Willem-V`, repository `draw.tikz` and workflow `release.yml`. The Marketplace page shows `vscode/README.md`; images there must use `https` URLs (no SVG).

**Open VSX** (VSCodium, Cursor, ...) is prepared as a comment in the workflow: create a token at <https://open-vsx.org>, add it as repository secret `OVSX_PAT` and uncomment the step.

## Contributing

Report bugs and request features in the [GitHub issues](https://github.com/Willem-V/draw.tikz/issues). Please always provide steps on how to reproduce a bug.

Bugs that also occur in the original CircuiTi*k*Z-Designer can be reported [upstream](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/issues).

## Todos

- **Reusable component groups:** save a selection as its own JSON file and import it into another drawing, both in VS Code and in the browser
- **Import Ti*k*Z/JSON files:** add the contents of an existing JSON drawing or Ti*k*Z file to the current drawing. Ti*k*Z needs a conversion of the code to the JSON format
