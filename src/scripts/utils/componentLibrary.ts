import * as SVG from "@svgdotjs/svg.js"
import {
	CanvasController,
	CircuitComponent,
	ComponentPlacer,
	ComponentSaveObject,
	EnvironmentVariableController,
	ExportController,
	GroupComponent,
	MainController,
	Modes,
	SaveFileFormat,
	currentSaveVersion,
} from "../internal"
import { isVSCodeHost, postToHost } from "./host"

/**
 * Reusable components: a selection saved as its own *.drawtikz.json file, which can be placed into any drawing from the
 * "My components" group of the symbol picker.
 *
 * Where the files come from depends on the host: in VS Code the extension sends the files in the component folder of the
 * workspace (setting drawtikz.componentFolder), in the browser the files are kept in the localStorage.
 */

export type LibraryEntry = {
	/** the file name without .drawtikz.json */
	name: string
	/** the content of the file (SaveFileFormat) */
	text: string
}

const fileSuffix = ".drawtikz.json"
const storageKey = "drawtikz-library"

export class ComponentLibrary {
	private static _instance: ComponentLibrary
	public static get instance(): ComponentLibrary {
		return ComponentLibrary._instance ?? (ComponentLibrary._instance = new ComponentLibrary())
	}

	private _entries: LibraryEntry[] = []
	public get entries(): readonly LibraryEntry[] {
		return this._entries
	}

	/** called after every change of the entries, e.g. to rebuild the picker group */
	public onChange: () => void = () => {}

	private constructor() {
		if (!isVSCodeHost) {
			this._entries = loadFromStorage()
		}
	}

	/**
	 * replaces all entries (VS Code: the files of the component folder)
	 */
	public setEntries(entries: LibraryEntry[]) {
		this._entries = [...entries].sort((a, b) => a.name.localeCompare(b.name))
		this.onChange()
	}

	/**
	 * adds an entry or replaces the one with the same name (browser only, VS Code reads the files from the workspace)
	 */
	public add(entry: LibraryEntry) {
		this.setEntries([...this._entries.filter((existing) => existing.name != entry.name), entry])
		saveToStorage(this._entries)
	}

	/**
	 * removes an entry (browser only, in VS Code the file is deleted instead)
	 */
	public remove(name: string) {
		this.setEntries(this._entries.filter((entry) => entry.name != name))
		saveToStorage(this._entries)
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
	 * lets the user choose a file (a component or any drawing) and places its components.
	 * In the browser the file is also added to the library.
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
			this.startPlacing(entry)
		})
		input.click()
	}

	/**
	 * places the components of the entry like a symbol: they follow the cursor and snap to the grid until a click places them
	 */
	public startPlacing(entry: LibraryEntry) {
		if (ComponentPlacer.instance.component) {
			ComponentPlacer.instance.placeCancel()
		}
		let components: CircuitComponent[]
		try {
			components = componentsFromFile(JSON.parse(entry.text))
		} catch (e) {
			console.error(`draw.tikz: could not load the component "${entry.name}"`, e)
			alert(`The component "${entry.name}" could not be loaded: ${e}`)
			return
		}
		if (components.length == 0) {
			return
		}
		MainController.instance.switchMode(Modes.COMPONENT)
		ComponentPlacer.instance.placeComponent(GroupComponent.forPlacement(components))
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
				ComponentLibrary.instance.startPlacing(entry)
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
		const importItem = addItem("Import a component or drawing from a file", "import file json", () =>
			ComponentLibrary.instance.importFile()
		)
		importItem.classList.add("libraryComponentText")
		importItem.innerHTML = `<span class="material-symbols-outlined">file_open</span> Import file...`
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
function componentsFromFile(file: SaveFileFormat): CircuitComponent[] {
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
