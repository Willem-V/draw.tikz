import * as vscode from "vscode"
import * as path from "path"

/**
 * draw.tikz for VS Code: *.drawtikz.json files open in a webview running the draw.tikz app (built into media/app).
 * The file stays a normal text document, so VS Code handles saving, dirty state, hot exit and git.
 */

type ExportFormat = "tikz" | "svg"

/** messages from the app, see src/scripts/utils/host.ts */
type FromAppMessage =
	| { type: "ready" }
	| { type: "edit"; text: string }
	| { type: "export"; format: ExportFormat; content: string; path?: string }
	| { type: "saveComponent"; content: string }
	| { type: "pickComponent" }
	| { type: "requestComponent"; path: string }

const fileSuffix = ".drawtikz.json"

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider("drawtikz.editor", new DrawTikzEditorProvider(context), {
			// the app keeps its own state (undo history, view), so don't reload it when the tab is hidden
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		}),
		vscode.commands.registerCommand("drawtikz.newDrawing", newDrawing)
	)
}

export function deactivate() {}

class DrawTikzEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
		const appFolder = vscode.Uri.joinPath(this.context.extensionUri, "media", "app")
		panel.webview.options = { enableScripts: true, localResourceRoots: [appFolder] }
		panel.webview.html = await this.getHtml(panel.webview, appFolder)

		// the text last sent by the app, to not send its own edits back to it
		// the texts which the app sent and which VS Code may still report as changes. Comparing only with the latest text
		// reloaded the drawing (and lost the selection) when the app made several edits quickly, because the change event of
		// an older edit arrives after the app already sent a newer text
		const ownTexts = new Set<string>()
		const sendLoad = () => {
			ownTexts.clear()
			panel.webview.postMessage({ type: "load", text: document.getText() })
		}

		const changeListener = vscode.workspace.onDidChangeTextDocument((ev) => {
			// changes from outside the app, e.g. git checkout, undo in VS Code or editing the json as text
			if (ev.document.uri.toString() == document.uri.toString() && !ownTexts.delete(document.getText())) {
				sendLoad()
			}
		})
		panel.onDidDispose(() => changeListener.dispose())

		// the component files which the drawing links to, watched so the instances update when a file changes
		const components = new ComponentFiles(document, (path, text) =>
			panel.webview.postMessage({ type: "componentFile", path: path, text: text })
		)
		panel.onDidDispose(() => components.dispose())

		const exportAndRemember = async (format: ExportFormat, content: string, storedPath?: string) => {
			const relativePath = await exportDrawing(document, format, content, storedPath)
			if (relativePath === undefined) {
				return
			}
			if (relativePath != storedPath) {
				// the app stores the path in the drawing, which then becomes an edit of the file
				panel.webview.postMessage({ type: "exported", format: format, path: relativePath })
			}
			vscode.window
				.showInformationMessage(`draw.tikz: exported to ${relativePath}`, "Export to another file")
				.then((choice) => choice && exportAndRemember(format, content))
		}

		panel.webview.onDidReceiveMessage(async (message: FromAppMessage) => {
			switch (message.type) {
				case "ready":
					sendLoad()
					break
				case "edit":
					if (message.text != document.getText()) {
						ownTexts.add(message.text)
						const edit = new vscode.WorkspaceEdit()
						edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), message.text)
						await vscode.workspace.applyEdit(edit)
					}
					break
				case "export":
					exportAndRemember(message.format, message.content, message.path)
					break
				case "requestComponent":
					components.request(message.path)
					break
				case "saveComponent": {
					const saved = await saveComponent(document, message.content)
					if (saved) {
						const choice = await vscode.window.showInformationMessage(
							`draw.tikz: saved ${saved}`,
							"Place it in this drawing"
						)
						if (choice) {
							await components.request(saved)
							panel.webview.postMessage({ type: "placeComponent", path: saved })
						}
					}
					break
				}
				case "pickComponent": {
					const picked = await pickComponent(document)
					if (picked) {
						// the app needs the content of the file before it places the component
						await components.request(picked)
						panel.webview.postMessage({ type: "placeComponent", path: picked })
					}
					break
				}
			}
		})
	}

	/**
	 * the built index.html of the app with a base url pointing to its files and a content security policy
	 */
	private async getHtml(webview: vscode.Webview, appFolder: vscode.Uri): Promise<string> {
		const indexFile = vscode.Uri.joinPath(appFolder, "index.html")
		let html: string
		try {
			html = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexFile))
		} catch {
			return `<body><p>The draw.tikz app is missing in the extension (${indexFile.fsPath}). Run "npm run build" in the vscode folder.</p></body>`
		}
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data: blob:`,
			// MathJax and the Computer Modern font for SVG text are loaded from jsdelivr
			`script-src ${webview.cspSource} https://cdn.jsdelivr.net`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
			`font-src ${webview.cspSource} data: https://fonts.gstatic.com https://cdn.jsdelivr.net`,
			`connect-src ${webview.cspSource} https://cdn.jsdelivr.net`,
		].join("; ")
		const base = webview.asWebviewUri(appFolder).toString() + "/"
		return html.replace(
			/<head>/i,
			`<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${csp}">`
		)
	}
}

/**
 * writes an export of the drawing, e.g. into the figure folder of the LaTeX project. Without a stored path a save dialog asks where.
 * @returns the path relative to the drawing, or undefined if cancelled
 */
async function exportDrawing(
	document: vscode.TextDocument,
	format: ExportFormat,
	content: string,
	storedPath?: string
): Promise<string | undefined> {
	const drawingFolder = vscode.Uri.joinPath(document.uri, "..")
	let target: vscode.Uri | undefined
	if (storedPath) {
		// the old path is filled in, so Enter overwrites the file, but it can be edited (missing folders are created)
		const input = await vscode.window.showInputBox({
			title: `Export ${format == "tikz" ? "CircuiTikZ code" : "SVG"}`,
			prompt: "Path of the export file, relative to the drawing",
			value: storedPath,
			valueSelection: [storedPath.lastIndexOf("/") + 1, storedPath.length - path.posix.extname(storedPath).length],
			validateInput: (value) => (value.trim() ? undefined : "Enter a path"),
		})
		if (!input) {
			return undefined
		}
		target = vscode.Uri.joinPath(drawingFolder, input.trim())
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."))
	} else {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? drawingFolder
		// without the setting the export is suggested next to the drawing
		const exportFolder = vscode.workspace.getConfiguration("drawtikz").get<string>("defaultExportFolder") || ""
		const name = path.posix.basename(document.uri.path).replace(/\.drawtikz\.json$/i, "")
		target = await vscode.window.showSaveDialog({
			title: `Export ${format == "tikz" ? "CircuiTikZ code" : "SVG"}`,
			defaultUri: vscode.Uri.joinPath(
				exportFolder ? workspaceFolder : drawingFolder,
				exportFolder,
				name + "." + format
			),
			filters: format == "tikz" ? { TikZ: ["tikz", "tex", "pgf"] } : { SVG: ["svg"] },
		})
		if (!target) {
			return undefined
		}
	}

	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
	return path.posix.relative(drawingFolder.path, target.path)
}

/**
 * The component files which the drawing links to (instances in the app). A file is identified by its path relative to the
 * workspace folder, any folder and file name works. The files are read when the app asks for them and sent again after
 * every change, so the instances in the app update.
 */
class ComponentFiles {
	private watchers = new Map<string, vscode.Disposable>()
	private timeouts = new Map<string, ReturnType<typeof setTimeout>>()

	constructor(
		private readonly document: vscode.TextDocument,
		private readonly post: (path: string, text: string | null) => void
	) {}

	/** reads the file, sends its content to the app and keeps sending it when it changes */
	async request(relativePath: string) {
		const file = componentUri(this.document, relativePath)
		if (!file) {
			this.post(relativePath, null)
			vscode.window.showWarningMessage(
				`draw.tikz: the component path "${relativePath}" must be relative and inside the workspace folder`
			)
			return
		}
		await this.send(relativePath, file)
		if (!this.watchers.has(relativePath)) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceFolderOf(this.document), escapeGlob(relativePath))
			)
			const changed = () => this.sendSoon(relativePath, file)
			this.watchers.set(
				relativePath,
				vscode.Disposable.from(
					watcher,
					watcher.onDidCreate(changed),
					watcher.onDidChange(changed),
					watcher.onDidDelete(changed)
				)
			)
		}
	}

	/** a save often changes the file several times, send it once afterwards */
	private sendSoon(relativePath: string, file: vscode.Uri) {
		clearTimeout(this.timeouts.get(relativePath))
		this.timeouts.set(
			relativePath,
			setTimeout(() => this.send(relativePath, file), 150)
		)
	}

	private async send(relativePath: string, file: vscode.Uri) {
		try {
			this.post(relativePath, await readText(file))
		} catch {
			// the file does not exist (anymore)
			this.post(relativePath, null)
		}
	}

	dispose() {
		this.timeouts.forEach((timeout) => clearTimeout(timeout))
		this.watchers.forEach((watcher) => watcher.dispose())
	}
}

/**
 * the file of a component path (relative to the workspace folder, with / or \\), undefined if the path is not inside the workspace folder
 */
function componentUri(document: vscode.TextDocument, relativePath: string): vscode.Uri | undefined {
	const normalized = path.posix.normalize(relativePath.trim().replace(/\\/g, "/"))
	if (
		!normalized ||
		normalized == "." ||
		normalized.startsWith("/") ||
		/^[a-zA-Z]:/.test(normalized) ||
		/(^|\/)\.\.(\/|$)/.test(normalized)
	) {
		return undefined
	}
	return vscode.Uri.joinPath(workspaceFolderOf(document), normalized)
}

/** a path as a glob pattern which only matches this path */
function escapeGlob(relativePath: string): string {
	return path.posix.normalize(relativePath.trim().replace(/\\/g, "/")).replace(/[*?[\]{}()!]/g, (c) => `[${c}]`)
}

/**
 * writes a component file to a place chosen in a save dialog (any folder in the workspace works)
 * @returns the path of the file relative to the workspace folder, undefined if cancelled or outside of the workspace folder
 */
async function saveComponent(document: vscode.TextDocument, content: string): Promise<string | undefined> {
	const workspaceFolder = workspaceFolderOf(document)
	const target = await vscode.window.showSaveDialog({
		title: "Save as reusable component",
		defaultUri: vscode.Uri.joinPath(vscode.Uri.joinPath(document.uri, ".."), "component" + fileSuffix),
		filters: { "draw.tikz component": ["json"] },
	})
	if (!target) {
		return undefined
	}
	// the save dialog only appends .json
	const file =
		/\.drawtikz\.json$/i.test(target.path) ? target : (
			target.with({ path: target.path.replace(/(\.json)?$/i, fileSuffix) })
		)
	await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content))
	const relative = path.posix.relative(workspaceFolder.path, file.path)
	if (relative.startsWith("..")) {
		vscode.window.showWarningMessage(
			`draw.tikz: saved ${file.fsPath}, but components can only be placed from inside the workspace folder`
		)
		return undefined
	}
	return relative
}

/**
 * asks for a component file or any drawing to place into the drawing: type a path relative to the workspace folder, pick
 * one of the drawings in the workspace or browse for a file
 * @returns the path relative to the workspace folder
 */
async function pickComponent(document: vscode.TextDocument): Promise<string | undefined> {
	const workspaceFolder = workspaceFolderOf(document)
	const own = path.posix.relative(workspaceFolder.path, document.uri.path)
	const found = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workspaceFolder, "**/*" + fileSuffix),
		"**/node_modules/**",
		500
	)
	const drawings = found
		.map((file) => path.posix.relative(workspaceFolder.path, file.path))
		.filter((relative) => relative != own)
		.sort()

	const browseLabel = "$(folder-opened) Browse for a file..."
	const quickPick = vscode.window.createQuickPick()
	quickPick.title = "Place a component or drawing"
	quickPick.placeholder = "Type a path relative to the workspace folder, or choose a drawing"
	const refresh = () => {
		const typed = quickPick.value.trim()
		const items: vscode.QuickPickItem[] = [{ label: browseLabel }]
		if (typed && !drawings.includes(typed)) {
			items.push({ label: typed, description: "use this path", alwaysShow: true })
		}
		items.push(...drawings.map((label) => ({ label })))
		quickPick.items = items
	}
	refresh()
	quickPick.onDidChangeValue(refresh)

	const choice = await new Promise<string | undefined>((resolve) => {
		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems[0]?.label ?? quickPick.value.trim())
			quickPick.hide()
		})
		quickPick.onDidHide(() => resolve(undefined))
		quickPick.show()
	})
	quickPick.dispose()
	if (!choice) {
		return undefined
	}
	if (choice != browseLabel) {
		return choice
	}
	const files = await vscode.window.showOpenDialog({
		title: "Place a component or drawing",
		defaultUri: workspaceFolder,
		filters: { "draw.tikz drawing": ["json"] },
		canSelectMany: false,
	})
	if (!files?.length) {
		return undefined
	}
	const relative = path.posix.relative(workspaceFolder.path, files[0].path)
	if (relative.startsWith("..")) {
		vscode.window.showWarningMessage("draw.tikz: components can only be placed from inside the workspace folder")
		return undefined
	}
	return relative
}

function workspaceFolderOf(document: vscode.TextDocument): vscode.Uri {
	return vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.joinPath(document.uri, "..")
}

async function readText(file: vscode.Uri): Promise<string> {
	return new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
}

/**
 * asks for a name and creates an empty drawing in the selected folder (explorer context menu), next to the active file or in the workspace
 */
async function newDrawing(folder?: vscode.Uri) {
	if (folder) {
		const stat = await vscode.workspace.fs.stat(folder)
		if (stat.type != vscode.FileType.Directory) {
			folder = vscode.Uri.joinPath(folder, "..")
		}
	} else {
		const active = vscode.window.activeTextEditor?.document.uri
		folder =
			active?.scheme == "file" ? vscode.Uri.joinPath(active, "..") : vscode.workspace.workspaceFolders?.[0]?.uri
	}
	if (!folder) {
		vscode.window.showErrorMessage("draw.tikz: open a folder first")
		return
	}
	const input = await vscode.window.showInputBox({
		title: "New draw.tikz drawing",
		prompt: `Name or relative path of the drawing, e.g. figures/circuit (creates <name>${fileSuffix} in ${vscode.workspace.asRelativePath(folder)})`,
		validateInput: (value) => validateDrawingPath(value),
	})
	if (!input) {
		return
	}
	const segments = splitDrawingPath(input)
	const fileName = (segments.pop() ?? "").replace(/\.drawtikz\.json$/i, "") + fileSuffix

	// subfolders that don't exist yet are only created after confirmation, as the path might contain a typo
	let target = folder
	const missing: string[] = []
	for (const segment of segments) {
		target = vscode.Uri.joinPath(target, segment)
		if (missing.length == 0) {
			try {
				const stat = await vscode.workspace.fs.stat(target)
				if (stat.type != vscode.FileType.Directory) {
					vscode.window.showErrorMessage(`draw.tikz: "${segment}" exists but is not a folder`)
					return
				}
				continue
			} catch {}
		}
		missing.push(segment)
	}
	if (missing.length > 0) {
		const choice = await vscode.window.showWarningMessage(
			`The folder "${segments.join("/")}" does not exist yet. Create it (and ${fileName})?`,
			{ modal: true, detail: "Choose Cancel if the path contains a typo." },
			"Create folder"
		)
		if (choice !== "Create folder") {
			return
		}
		await vscode.workspace.fs.createDirectory(target) // creates missing parents too, like mkdir -p
	}

	const file = vscode.Uri.joinPath(target, fileName)
	try {
		await vscode.workspace.fs.stat(file)
	} catch {
		await vscode.workspace.fs.writeFile(file, new Uint8Array())
	}
	await vscode.commands.executeCommand("vscode.openWith", file, "drawtikz.editor")
}

/** the folders and the file name of a path entered for a new drawing (both / and \\ separate folders) */
function splitDrawingPath(value: string): string[] {
	return value
		.trim()
		.split(/[\\/]+/)
		.filter((segment) => segment.length > 0)
}

/** an error message if the path is not a valid relative path inside the folder, otherwise undefined */
function validateDrawingPath(value: string): string | undefined {
	const trimmed = value.trim()
	if (!trimmed || /[\\/]$/.test(trimmed)) {
		return "Enter a file name"
	}
	if (/^([\\/]|[a-zA-Z]:)/.test(trimmed)) {
		return "Enter a path relative to the folder"
	}
	for (const segment of splitDrawingPath(trimmed)) {
		if (segment == "." || segment == "..") {
			return "'.' and '..' are not allowed in the path"
		}
		if (/[:*?"<>|]/.test(segment)) {
			return "The path contains invalid characters"
		}
	}
	return undefined
}
