import * as SVG from "@svgdotjs/svg.js"
import {
	CanvasController,
	CircuitComponent,
	ComponentPlacer,
	ComponentSaveObject,
	EnvironmentVariableController,
	ExportController,
	InstanceComponent,
	MainController,
	Modes,
	SaveFileFormat,
	currentSaveVersion,
} from "../internal"
import { isVSCodeHost, postToHost } from "./host"

/**
 * Reusable components: a selection saved as its own *.drawtikz.json file, which is placed into drawings as a linked
 * instance (see InstanceComponent): the drawing only stores the path of the file, so the instances update when the file
 * changes.
 *
 * A component is identified by its path. In VS Code that is the path of the file relative to the workspace folder (any
 * folder, any file name), which the extension reads and watches. In the browser the files are kept in the localStorage and
 * the path is the name of the entry.
 */

export type LibraryEntry = {
	/** the path of the file relative to the workspace folder (VS Code) or the name of the entry (browser) */
	name: string
	/** the content of the file (SaveFileFormat) */
	text: string
}

/** something which shows the content of a component file and has to reload when it changes */
export interface ComponentUser {
	source: string
	reload(): void
}

const fileSuffix = ".drawtikz.json"
const storageKey = "drawtikz-library"

export class ComponentLibrary {
	private static _instance: ComponentLibrary
	public static get instance(): ComponentLibrary {
		return ComponentLibrary._instance ?? (ComponentLibrary._instance = new ComponentLibrary())
	}

	/** browser: the entries in the storage. VS Code: the files sent by the extension, null for files which don't exist */
	private files = new Map<string, string | null>()
	private requested = new Set<string>()
	private users = new Set<ComponentUser>()

	/** the known components: in the browser all entries of the library, in VS Code the files used in this drawing */
	public get entries(): LibraryEntry[] {
		return [...this.files.entries()]
			.filter(([, text]) => text !== null)
			.map(([name, text]) => ({ name: name, text: text as string }))
			.sort((a, b) => a.name.localeCompare(b.name))
	}

	/** called after every change of the entries, e.g. to rebuild the picker group */
	public onChange: () => void = () => {}

	private constructor() {
		if (!isVSCodeHost) {
			for (const entry of loadFromStorage()) {
				this.files.set(entry.name, entry.text)
			}
		}
	}

	/**
	 * the content of a component file. In VS Code the file is requested from the extension if it is not known yet, the
	 * users are reloaded when it arrives.
	 * @returns undefined if the file is not (yet) available
	 */
	public getText(path: string): string | undefined {
		const text = this.files.get(path)
		if (text === undefined && isVSCodeHost && !this.requested.has(path)) {
			this.requested.add(path)
			postToHost({ type: "requestComponent", path: path })
		}
		return text ?? undefined
	}

	/**
	 * the content of a component file changed (VS Code: sent by the extension, null if the file doesn't exist)
	 */
	public setFile(path: string, text: string | null) {
		this.requested.add(path)
		if (this.files.get(path) === text) {
			return
		}
		this.files.set(path, text)
		this.fileChanged(path)
	}

	private fileChanged(path: string) {
		for (const user of [...this.users]) {
			if (user.source == path) {
				user.reload()
			}
		}
		this.onChange()
	}

	/** if the content of the file is known */
	public isLoaded(path: string): boolean {
		return typeof this.files.get(path) == "string"
	}

	public addUser(user: ComponentUser) {
		this.users.add(user)
	}
	public removeUser(user: ComponentUser) {
		this.users.delete(user)
	}

	/**
	 * adds an entry or replaces the one with the same name (browser only, VS Code reads the files from the workspace)
	 */
	public add(entry: LibraryEntry) {
		this.files.set(entry.name, entry.text)
		saveToStorage(this.entries)
		this.fileChanged(entry.name)
	}

	/**
	 * removes an entry (browser only, in VS Code the file is deleted instead). Instances in drawings show a placeholder.
	 */
	public remove(name: string) {
		this.files.delete(name)
		saveToStorage(this.entries)
		this.fileChanged(name)
	}

	/**
	 * saves the given components (the selection) as a component file: a download in the browser (and added to the library),
	 * a file chosen in a save dialog of VS Code
	 */
	public save(components: CircuitComponent[]) {
		if (components.length == 0) {
			return
		}
		const text = componentsToFile(components)
		if (isVSCodeHost) {
			postToHost({ type: "saveComponent", content: text })
			return
		}
		const name = window.prompt("Name of the component")?.trim()
		if (!name) {
			return
		}
		this.add({ name: name, text: text })
		ExportController.instance.exportJSON(text, name, [fileSuffix, ".json"])
	}

	/**
	 * VS Code: lets the user choose a component file or enter its path. Browser: lets the user choose a file (a component or
	 * any drawing), which is added to the library.
	 * The component is placed afterwards.
	 */
	public importFile() {
		if (isVSCodeHost) {
			postToHost({ type: "pickComponent" })
			return
		}
		const input = document.createElement("input")
		input.type = "file"
		input.accept = ".json"
		input.addEventListener("change", async () => {
			const file = input.files?.[0]
			if (!file) {
				return
			}
			const entry: LibraryEntry = { name: entryName(file.name), text: await file.text() }
			this.add(entry)
			this.startPlacing(entry.name)
		})
		input.click()
	}

	/**
	 * places an instance of the component like a symbol: it follows the cursor and snaps to the grid until a click places it
	 */
	public startPlacing(path: string) {
		if (ComponentPlacer.instance.component) {
			ComponentPlacer.instance.placeCancel()
		}
		MainController.instance.switchMode(Modes.COMPONENT)
		ComponentPlacer.instance.placeComponent(InstanceComponent.newForPlacement(path))
	}
}

/**
 * adds the "My components" group at the top of the symbol picker and rebuilds it whenever the library changes
 * @param hidePicker closes the picker after an entry was chosen
 */
export function addLibraryToPicker(accordion: HTMLElement, hidePicker: () => void) {
	const groupID = "collapseGroup-My-components"
	const accordionGroup = document.createElement("div")
	accordionGroup.classList.add("accordion-item")
	accordionGroup.innerHTML = `
		<h2 class="accordion-header">
			<button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#${groupID}"
				aria-controls="${groupID}" aria-expanded="true">My components</button>
		</h2>
		<div class="accordion-collapse collapse show" id="${groupID}" data-bs-parent="#leftOffcanvasAccordion">
			<div class="accordion-body iconLibAccordionBody"></div>
		</div>`
	accordion.prepend(accordionGroup)
	const body = accordionGroup.querySelector(".accordion-body") as HTMLDivElement

	/** a picker item, which (like the symbols) reacts on mouseup so it also works with the keyboard navigation of the picker */
	const addItem = (title: string, searchData: string, onChoose: () => void) => {
		const item = body.appendChild(document.createElement("div"))
		item.classList.add("libComponent", "libraryComponent")
		item.title = title
		item.setAttribute("searchData", searchData)
		item.ariaRoleDescription = "button"
		const listener = (ev: Event) => {
			ev.preventDefault()
			hidePicker()
			onChoose()
		}
		item.addEventListener("mouseup", listener)
		item.addEventListener("touchstart", listener, { passive: false })
		return item
	}

	const render = () => {
		body.replaceChildren()
		for (const entry of ComponentLibrary.instance.entries) {
			const item = addItem(entry.name, "my component " + entry.name, () =>
				ComponentLibrary.instance.startPlacing(entry.name)
			)
			const preview = previewOf(entry)
			if (preview) {
				item.innerHTML = preview
			} else {
				item.classList.add("libraryComponentText")
				item.textContent = entry.name
			}
			if (!isVSCodeHost) {
				const removeButton = item.appendChild(document.createElement("button"))
				removeButton.classList.add("btn-close", "libraryComponentRemove")
				removeButton.title = `Remove "${entry.name}" from the library`
				// the item places the component on mouseup
				removeButton.addEventListener("mouseup", (ev) => ev.stopPropagation())
				removeButton.addEventListener("click", (ev) => {
					ev.stopPropagation()
					ComponentLibrary.instance.remove(entry.name)
				})
			}
		}
		const importItem = addItem(
			isVSCodeHost ?
				"Place a component or drawing: choose a file or enter its path relative to the workspace folder"
			:	"Import a component or drawing from a file",
			"import file json path",
			() => ComponentLibrary.instance.importFile()
		)
		importItem.classList.add("libraryComponentText")
		importItem.innerHTML =
			isVSCodeHost ?
				`<span class="material-symbols-outlined">file_open</span> From file or path...`
			:	`<span class="material-symbols-outlined">file_open</span> Import file...`
	}
	ComponentLibrary.instance.onChange = render
	render()
}

/**
 * the preview svg stored in the file of an entry
 */
function previewOf(entry: LibraryEntry): string | undefined {
	try {
		const preview = (JSON.parse(entry.text) as SaveFileFormat).preview
		return typeof preview == "string" && preview.startsWith("<svg") ? preview : undefined
	} catch {
		return undefined
	}
}

/**
 * the name of a library entry for a file name
 */
export function entryName(fileName: string): string {
	return fileName.replace(/\.drawtikz\.json$|\.json$/i, "")
}

/**
 * serializes the components to a component file. The components are shifted by whole grid steps so a grid point close to
 * their center is the origin: terminals which are on the grid stay on the grid and the file opens centered as a drawing.
 */
function componentsToFile(components: CircuitComponent[]): string {
	const bbox = components.map((component) => component.bbox).reduce((merged, bbox) => merged.merge(bbox))
	const grid = CanvasController.gridSpacing
	const offset = new SVG.Point(Math.round(bbox.cx / grid) * grid, Math.round(bbox.cy / grid) * grid)

	// shift the components themselves, serialize them and shift them back
	components.forEach((component) => component.moveRel(new SVG.Point(-offset.x, -offset.y)))
	let saveObjects: ComponentSaveObject[]
	let preview: string
	try {
		saveObjects = components.map((component) => {
			const saveObject = component.toJson()
			// like copy/paste: names have to be unique in a drawing
			if ("name" in saveObject) {
				saveObject.name = ""
			}
			return saveObject
		})
		preview = previewSVG(components)
	} finally {
		components.forEach((component) => component.moveRel(offset))
	}

	const file: SaveFileFormat = {
		version: currentSaveVersion,
		tikzSettings: EnvironmentVariableController.instance.toJson(),
		components: saveObjects,
		preview: preview,
	}
	return JSON.stringify(file, null, 4)
}

/**
 * creates the components of a component file (or any drawing). The environment settings of the file are ignored, the
 * components get the ones of the current drawing.
 */
export function componentsFromFile(file: SaveFileFormat): CircuitComponent[] {
	// files of old versions are only a list of components
	const saveObjects: ComponentSaveObject[] = Array.isArray(file) ? file : (file.components ?? [])
	return saveObjects.map((saveObject) => CircuitComponent.fromJson(saveObject)).filter((component) => component)
}

/**
 * a small svg of the components for the picker. The colors stay the theme variables of the app, so it fits dark and light mode
 */
function previewSVG(components: CircuitComponent[]): string {
	const svg = new SVG.Svg()
	const defsMap = new Map<string, SVG.Element>()
	const elements = components.map((component) => component.toSVG(defsMap))
	if (defsMap.size > 0) {
		const defs = new SVG.Defs()
		defsMap.forEach((element) => defs.add(element))
		svg.add(defs)
	}
	elements.forEach((element) => svg.add(element))
	svg.find(".draggable").forEach((element) => element.removeClass("draggable"))

	const bbox = components.map((component) => component.bbox).reduce((merged, bbox) => merged.merge(bbox))
	const margin = 2
	svg.viewbox(bbox.x - margin, bbox.y - margin, bbox.w + 2 * margin, bbox.h + 2 * margin)
	svg.attr({ width: null, height: null })
	return svg.svg()
}

function loadFromStorage(): LibraryEntry[] {
	try {
		const entries = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
		return Array.isArray(entries) ? entries : []
	} catch (e) {
		console.warn("draw.tikz: could not read the component library from the browser storage", e)
		return []
	}
}

function saveToStorage(entries: LibraryEntry[]) {
	try {
		localStorage.setItem(storageKey, JSON.stringify(entries))
	} catch (e) {
		console.warn("draw.tikz: could not save the component library in the browser storage", e)
		alert("The component library could not be saved in the browser storage (full or blocked).")
	}
}
