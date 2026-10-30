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

/** a reusable component for the app, see src/scripts/utils/componentLibrary.ts */
type LibraryEntry = { name: string; text: string }

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
		let appText: string | undefined
		const sendLoad = () => panel.webview.postMessage({ type: "load", text: document.getText() })

		const changeListener = vscode.workspace.onDidChangeTextDocument((ev) => {
			// changes from outside the app, e.g. git checkout, undo in VS Code or editing the json as text
			if (ev.document.uri.toString() == document.uri.toString() && document.getText() != appText) {
				sendLoad()
			}
		})
		panel.onDidDispose(() => changeListener.dispose())

		const library = new ComponentFolderWatcher(document, (components) =>
			panel.webview.postMessage({ type: "library", components: components })
		)
		panel.onDidDispose(() => library.dispose())

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
					library.send()
					break
				case "edit":
					appText = message.text
					if (message.text != document.getText()) {
						const edit = new vscode.WorkspaceEdit()
						edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), message.text)
						await vscode.workspace.applyEdit(edit)
					}
					break
				case "export":
					exportAndRemember(message.format, message.content, message.path)
					break
				case "saveComponent":
					saveComponent(document, message.content)
					break
				case "pickComponent": {
					const component = await pickComponent(document)
					if (component) {
						panel.webview.postMessage({ type: "placeComponent", component: component })
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
		target = vscode.Uri.joinPath(drawingFolder, storedPath)
	} else {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? drawingFolder
		const exportFolder = vscode.workspace.getConfiguration("drawtikz").get<string>("defaultExportFolder") || "."
		const name = path.posix.basename(document.uri.path).replace(/\.drawtikz\.json$/i, "")
		target = await vscode.window.showSaveDialog({
			title: `Export ${format == "tikz" ? "CircuiTikZ code" : "SVG"}`,
			defaultUri: vscode.Uri.joinPath(workspaceFolder, exportFolder, name + "." + format),
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
 * Sends the reusable components (the *.drawtikz.json files in the component folder of the workspace) to the app of one
 * editor, again after every change of these files or of the setting drawtikz.componentFolder.
 */
class ComponentFolderWatcher {
	private watcher: vscode.FileSystemWatcher | undefined
	private configListener: vscode.Disposable
	private sendTimeout: ReturnType<typeof setTimeout> | undefined

	constructor(
		private readonly document: vscode.TextDocument,
		private readonly post: (components: LibraryEntry[]) => void
	) {
		this.watch()
		this.configListener = vscode.workspace.onDidChangeConfiguration((ev) => {
			if (ev.affectsConfiguration("drawtikz.componentFolder")) {
				this.watch()
				this.send()
			}
		})
	}

	/** the glob of the component files, relative to the workspace folder of the drawing */
	private pattern(): vscode.RelativePattern {
		const folder = componentFolder(this.document)
			.replace(/\\/g, "/")
			.replace(/^\.?\/+|\/+$/g, "")
		return new vscode.RelativePattern(
			workspaceFolderOf(this.document),
			(folder ? folder + "/" : "") + "**/*" + fileSuffix
		)
	}

	private watch() {
		this.watcher?.dispose()
		this.watcher = vscode.workspace.createFileSystemWatcher(this.pattern())
		const changed = () => this.sendSoon()
		this.watcher.onDidCreate(changed)
		this.watcher.onDidChange(changed)
		this.watcher.onDidDelete(changed)
	}

	/** several files can change at once (e.g. git checkout), send the list once afterwards */
	private sendSoon() {
		clearTimeout(this.sendTimeout)
		this.sendTimeout = setTimeout(() => this.send(), 300)
	}

	async send() {
		const files = await vscode.workspace.findFiles(this.pattern())
		const components: LibraryEntry[] = []
		for (const file of files) {
			try {
				components.push({ name: componentName(file), text: await readText(file) })
			} catch (e) {
				console.warn(`draw.tikz: could not read the component ${file.fsPath}`, e)
			}
		}
		this.post(components)
	}

	dispose() {
		clearTimeout(this.sendTimeout)
		this.watcher?.dispose()
		this.configListener.dispose()
	}
}

/**
 * writes a component file, by default into the component folder so it appears in the symbol picker
 */
async function saveComponent(document: vscode.TextDocument, content: string) {
	const folder = vscode.Uri.joinPath(workspaceFolderOf(document), componentFolder(document))
	const target = await vscode.window.showSaveDialog({
		title: "Save as reusable component",
		defaultUri: vscode.Uri.joinPath(folder, "component" + fileSuffix),
		filters: { "draw.tikz component": ["json"] },
	})
	if (!target) {
		return
	}
	// the save dialog only appends .json
	const file =
		/\.drawtikz\.json$/i.test(target.path) ? target : (
			target.with({ path: target.path.replace(/(\.json)?$/i, fileSuffix) })
		)
	await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content))
	if (!file.path.startsWith(folder.path + "/")) {
		vscode.window.showInformationMessage(
			`draw.tikz: saved ${vscode.workspace.asRelativePath(file)}. Only components in the folder ` +
				`"${componentFolder(document)}" (setting drawtikz.componentFolder) are listed in the symbol picker.`
		)
	}
}

/**
 * asks for a component file or any drawing to place into the drawing
 */
async function pickComponent(document: vscode.TextDocument): Promise<LibraryEntry | undefined> {
	const files = await vscode.window.showOpenDialog({
		title: "Place a component or drawing",
		defaultUri: vscode.Uri.joinPath(workspaceFolderOf(document), componentFolder(document)),
		filters: { "draw.tikz drawing": ["json"] },
		canSelectMany: false,
	})
	if (!files?.length) {
		return undefined
	}
	return { name: componentName(files[0]), text: await readText(files[0]) }
}

function componentFolder(document: vscode.TextDocument): string {
	return vscode.workspace.getConfiguration("drawtikz", document.uri).get<string>("componentFolder") || "components"
}

function workspaceFolderOf(document: vscode.TextDocument): vscode.Uri {
	return vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.joinPath(document.uri, "..")
}

function componentName(file: vscode.Uri): string {
	return path.posix.basename(file.path).replace(/\.drawtikz\.json$|\.json$/i, "")
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
			active?.scheme == "file" ?
				vscode.Uri.joinPath(active, "..")
			:	vscode.workspace.workspaceFolders?.[0]?.uri
	}
	if (!folder) {
		vscode.window.showErrorMessage("draw.tikz: open a folder first")
		return
	}
	const name = await vscode.window.showInputBox({
		title: "New draw.tikz drawing",
		prompt: `Name of the drawing (creates <name>${fileSuffix} in ${vscode.workspace.asRelativePath(folder)})`,
		validateInput: (value) => (/^[^\\/:*?"<>|]+$/.test(value.trim()) ? undefined : "Enter a valid file name"),
	})
	if (!name) {
		return
	}
	const file = vscode.Uri.joinPath(folder, name.trim().replace(/\.drawtikz\.json$/i, "") + fileSuffix)
	try {
		await vscode.workspace.fs.stat(file)
	} catch {
		await vscode.workspace.fs.writeFile(file, new Uint8Array())
	}
	await vscode.commands.executeCommand("vscode.openWith", file, "drawtikz.editor")
}
