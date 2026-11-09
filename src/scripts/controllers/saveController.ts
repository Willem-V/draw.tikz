import { Guide, PageFrame, PageSettings } from "../utils/pageFrame"
import { Palette, PaletteEntry } from "../utils/palette"
import {
	SelectionController,
	Undo,
	ExportController,
	ImportController,
	ComponentSaveObject,
	CircuitComponent,
	SelectionMode,
	MainController,
	GlobalTikzSettings,
	EnvironmentVariableController,
} from "../internal"

// bump this if something is removed or adjusted in how the save file is formatted. (No change necessary if something is added)
export let currentSaveVersion = "0.1"

export type SaveFileFormat = {
	version: string
	tikzSettings: GlobalTikzSettings
	components: ComponentSaveObject[]
	/** the named colors of the drawing, only if they differ from the default palette (see utils/palette.ts) */
	palette?: PaletteEntry[]
	/** the page frame of the figure (see utils/pageFrame.ts) */
	page?: PageSettings
	/** lines which components snap to, positions in cm */
	guides?: Guide[]
	guidesHidden?: boolean
	/** where the drawing was last exported to, relative to the save file (only used by the VS Code extension) */
	exports?: { tikz?: string; svg?: string }
	/** svg of the components for the symbol picker, only in reusable component files (see utils/componentLibrary.ts) */
	preview?: string
}

export let emtpySaveState: SaveFileFormat = {
	version: currentSaveVersion,
	tikzSettings: {} as GlobalTikzSettings,
	components: [],
}

/**
 * Controller for saving and loading the progress in json format
 */
export class SaveController {
	private static _instance: SaveController
	public static get instance(): SaveController {
		if (!SaveController._instance) {
			SaveController._instance = new SaveController()
		}
		return SaveController._instance
	}

	public currentlyLoadedSaveVersion: string = currentSaveVersion

	private constructor() {
		// All DOM wiring for the import modal now lives in ImportController. SaveController is
		// purely concerned with serialising the current scene and applying parsed save files.
	}

	save() {
		ExportController.instance.exportJSON(this.serialize())
	}

	/**
	 * the current drawing in the json save file format
	 * @param exports kept unchanged from the loaded file
	 */
	serialize(exports?: SaveFileFormat["exports"]): string {
		let componentArray = []
		for (const component of MainController.instance.circuitComponents) {
			componentArray.push(component.toJson())
		}
		let settingsData = EnvironmentVariableController.instance.toJson()
		let data: SaveFileFormat = {
			version: currentSaveVersion,
			tikzSettings: settingsData,
			components: componentArray,
		}
		const palette = Palette.instance.toJson()
		if (palette) {
			data.palette = palette
		}
		Object.assign(data, PageFrame.instance.toJson())
		if (exports) {
			data.exports = exports
		}

		return JSON.stringify(data, null, 4)
	}

	/**
	 * Open the unified import modal on the Upload tab (legacy Load-button behaviour).
	 *
	 * The real work — file reading, format detection, parsing, diagnostic reporting — is handled
	 * by {@link ImportController}. This method is kept as a thin alias so that every existing
	 * call-site (navbar button, Ctrl+O hotkey, etc.) keeps working unchanged.
	 */
	load() {
		ImportController.instance.open("upload")
	}

	loadFromJSON(saveFile: SaveFileFormat, selectComponents = false) {
		//delete current state if necessary
		if ((document.getElementById("loadCheckRemove") as HTMLInputElement).checked) {
			SelectionController.instance.selectAll()
			SelectionController.instance.removeSelection()
		}

		let components = []

		if (!("version" in saveFile)) {
			// old file format
			this.currentlyLoadedSaveVersion = ""
			//@ts-ignore
			for (const component of saveFile) {
				let c = SaveController.fromJson(component)
				if (c) {
					components.push(c)
				}
			}
		} else {
			this.currentlyLoadedSaveVersion = saveFile.version

			if (saveFile.tikzSettings) {
				// check if tikzSettings are present and load them
				EnvironmentVariableController.instance.fromJson(saveFile.tikzSettings)
			}
			// before the components, which use its colors
			Palette.instance.fromJson(saveFile.palette)
			PageFrame.instance.fromJson({ page: saveFile.page, guides: saveFile.guides, guidesHidden: saveFile.guidesHidden })

			for (const component of saveFile.components) {
				let c = SaveController.fromJson(component)
				if (c) {
					components.push(c)
				}
			}
		}

		if (selectComponents) {
			SelectionController.instance.deactivateSelection()
			SelectionController.instance.activateSelection()
			SelectionController.instance.selectComponents(components, SelectionMode.RESET)
		}
		Undo.addState()
		this.currentlyLoadedSaveVersion = currentSaveVersion
	}

	static fromJson(saveJson: ComponentSaveObject): CircuitComponent {
		return CircuitComponent.fromJson(saveJson)
	}
}
