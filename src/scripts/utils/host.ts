/**
 * Communication with the program hosting the app. In the browser there is no host. In the VS Code extension the app runs
 * in a webview and the drawing is stored in a *.drawtikz.json file of the workspace, which the extension reads and writes.
 */

/** messages from the app to the VS Code extension */
export type ToHostMessage =
	| { type: "ready" }
	| { type: "edit"; text: string }
	| { type: "export"; format: ExportFormat; content: string; path?: string }

/** messages from the VS Code extension to the app */
export type FromHostMessage =
	| { type: "load"; text: string }
	// path relative to the drawing's file
	| { type: "exported"; format: ExportFormat; path: string }

export type ExportFormat = "tikz" | "svg"

declare function acquireVsCodeApi(): { postMessage(message: ToHostMessage): void }

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null

export const isVSCodeHost = vscode !== null

export function postToHost(message: ToHostMessage) {
	vscode?.postMessage(message)
}

export function onHostMessage(handler: (message: FromHostMessage) => void) {
	if (isVSCodeHost) {
		window.addEventListener("message", (ev: MessageEvent<FromHostMessage>) => handler(ev.data))
	}
}

/**
 * VS Code receives every key pressed in the webview and would also run its own shortcuts for them (e.g. Ctrl+E opens quick open).
 * Stop the shortcuts which the app handles itself. Ctrl+S is still passed on so VS Code saves the file.
 */
export function keepShortcutsInWebview() {
	const appKeys = new Set(["a", "c", "v", "x", "z", "y", "r", "e", "o"])
	// registered after hotkeys-js, which also listens on the document, so the app shortcuts still work
	document.addEventListener("keydown", (ev) => {
		if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && appKeys.has(ev.key.toLowerCase())) {
			ev.stopPropagation()
		}
	})
}
