# draw.tikz

An interactive, visual editor for creating electrical circuit diagrams for LaTeX/CircuiTi*k*Z with ease.

**Use it online: <https://micas.pages.esat.kuleuven.cloud/>** (log in with your ESAT GitLab account)

draw.tikz is a fork of [CircuiTi*k*Z-Designer](https://github.com/Circuit2TikZ/CircuiTikZ-Designer) by Manuel Kirzinger, Philipp Wiedemann and Christof Pfannenmüller (FAU), licensed under [GPL-3.0](LICENSE). The goal is to extend it step by step towards a general GUI for Ti*k*Z drawings.

## Todos

- why not always save in .tikz? why is json needed? -> put 
- save groups of own components
- Import external Tikz files if possible
- Customizable saving: choose a project folder where the .json and .tikz are autosaved automatically (easier to retrieve, no loss when browser storage is overwritten)

## Changes compared to CircuiTi*k*Z-Designer

- **Variable sources:** a "Variable" switch on all voltage and current sources draws a diagonal arrow over the symbol (also exported to Ti*k*Z)
- **Transistor arrow position:** environment setting for `\ctikzset{transistors/arrow pos=...}`, defaulting to the end of the terminal. The canvas symbols for this are generated with [scripts/generateArrowEndSymbols.py](scripts/generateArrowEndSymbols.py)
- **Enable axes:** the axes can be hidden like the grid; the grid setting is now also restored correctly
- **Rectangle arrays:** a "Draw as array" switch on rectangles draws extra offset outlines at the top and right (adjustable number of layers and offset), so a rectangle around a device shows an array of devices (also exported to Ti*k*Z)
- **Rectangles as frames:** unfilled rectangles without text can only be selected at their border, so components inside them can be clicked and the rectangle can be deselected
- **Straight lines and arrows** stay straight after undo, copy/paste and reloading, and diagonal segments stay straight when resizing
- **Flipping/rotating** a single component no longer moves it
- **Labels** are at the correct position directly after loading a JSON file
- No Google Analytics

## Overview

draw.tikz bridges the gap between visual circuit design and precise LaTeX code, letting you design, customize, and export diagrams without manually writing TikZ commands.
Whether you’re preparing academic papers, teaching materials, or engineering documentation, it provides:

- A clean, intuitive interface for fast diagram creation
- An extensive component library for all your circuit needs
- Real-time previews and instant export to high-quality LaTeX code

|                 Edit in draw.tikz                 |            Export to compilable Ti*k*Z code            |
| :-----------------------------------------------: | :----------------------------------------------------: |
| ![sallen-key edit](./examples/sallen-key.png) | ![sallen-key export](./examples/sallen-key_export.png) |

|               Use it in your LaTeX project!                |
| :--------------------------------------------------------: |
| ![sallen-key overleaf](./examples/sallen-key_overleaf.png) |

## Key Features

- **Visual Circuit Design:** Intuitive interface with multi-tab support and component grouping
- **Wide Component Library:** Includes most circuit elements plus some tikz components like rectangles, ellipses and arrows
- **Export Ready:** Generate clean LaTeX/TikZ code and compatible SVG exports for seamless document integration
- **Advanced Editing:** Rotate, scale, align, distribute, and snap components with clear visuals and flexible editing capabilities
- **Component Variants:** Easily switch between different versions of components and adjust their properties via the properties window
- **Cross-Platform Friendly:** Dark mode and mobile support for comfortable online editing anywhere
- **MathJax Support:** Write MathJax math expressions directly inside text components with real-time rendering

## How to use

All controls of the application are explained in the help menu in the top right corner via the circled questionmark in the application itself.

Drawings are stored in the browser (per address). Save your drawing regularly as a JSON file (Ctrl/⌘ + S) to be safe.

## Use locally (For debugging for example)

1. Have [Node.js](https://nodejs.org/) (v20) installed
2. Clone the repository
3. Run `npm ci` in the project directory
4. `npm start` serves the working tree on <http://localhost:1234> and reloads on every change. 

## Hosting (GitLab Pages)

[.gitlab-ci.yml](.gitlab-ci.yml) builds the app and publishes it with GitLab Pages on every push to `main`. The job needs a GitLab runner with the Docker executor. To run one on your own machine:

1. In GitLab: Settings > CI/CD > Runners > New project runner, tick "Run untagged jobs" and copy the token (`glrt-...`)
2. Run `scripts/gitlab-runner.sh` (installs, registers and starts the runner; asks for the token). `scripts/gitlab-runner.sh status` and `scripts/gitlab-runner.sh stop` check or stop it.

The runner is only needed for building; the published site stays online when the runner is off.

## Contributing

Report bugs and request features in the issues of the [GitLab project](https://gitlab.esat.kuleuven.be/willem.vandesteene/draw.tikz). Please always provide steps on how to reproduce a bug.

Bugs that also occur in the original CircuiTi*k*Z-Designer can be reported [upstream](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/issues).
