import { Point } from "@svgdotjs/svg.js"
import {
	CanvasController,
	ComponentSaveObject,
	MainController,
	SaveController,
	SelectionController,
	SelectionMode,
	Undo,
} from "../internal"

/**
 * what is put on the system clipboard (as JSON text) when components are copied
 */
type ClipboardData = {
	/** marks the text as copied from draw.tikz */
	drawtikz: "clipboard"
	components: ComponentSaveObject[]
	/** center of the copied components, the pasted components are placed relative to it */
	selectionPos: { x: number; y: number }
}

/**
 * Copy, cut and paste via the system clipboard, so components can be copied between drawings in different browser tabs,
 * VS Code editors and between VS Code and the browser.
 *
 * The browser's copy/cut/paste events are used (instead of shortcuts and the async clipboard API), because they work in
 * every browser and in VS Code webviews without asking for permissions. The data is JSON text, so it can also be pasted
 * into a text editor, and the contents of a *.drawtikz.json file can be pasted into a drawing.
 * @class
 */
export class CopyPaste {
	/**
	 * puts the selected components on the clipboard
	 * @returns if something was copied
	 */
	public static copy(ev: ClipboardEvent): boolean {
		if (!SelectionController.instance.hasSelection()) {
			return false
		}
		const components = SelectionController.instance.currentlySelectedComponents.map((component) => {
			const saveObject = component.toJson()
			// names have to be unique in a drawing
			if ("name" in saveObject) {
				saveObject.name = ""
			}
			return saveObject
		})
		const bbox = SelectionController.instance.getOverallBoundingBox()
		const data: ClipboardData = {
			drawtikz: "clipboard",
			components: components,
			selectionPos: { x: bbox.cx, y: bbox.cy },
		}
		ev.clipboardData.setData("text/plain", JSON.stringify(data))
		ev.preventDefault()
		return true
	}

	/**
	 * pastes components from the clipboard: copied from draw.tikz or the contents of a *.drawtikz.json file.
	 * Other text on the clipboard is ignored.
	 */
	public static paste(ev: ClipboardEvent) {
		const parsed = CopyPaste.parse(ev.clipboardData.getData("text/plain"))
		if (!parsed) {
			return
		}
		ev.preventDefault()

		SelectionController.instance.deactivateSelection()
		SelectionController.instance.activateSelection()

		const pastedComponents = parsed.components
			.map((saveObject) => SaveController.fromJson(saveObject))
			.filter((component) => component)
		if (pastedComponents.length == 0) {
			return
		}
		SelectionController.instance.selectComponents(pastedComponents, SelectionMode.RESET)
		// copied components are pasted slightly offset, so they are visible next to the originals
		SelectionController.instance.moveSelectionTo(
			parsed.selectionPos ? parsed.selectionPos.add(new Point(20, 20)) : CanvasController.instance.lastCanvasPoint
		)
		Undo.addState()
	}

	/**
	 * puts the selected components on the clipboard and removes them
	 */
	public static cut(ev: ClipboardEvent) {
		if (!CopyPaste.copy(ev)) {
			return
		}
		for (const component of SelectionController.instance.currentlySelectedComponents) {
			MainController.instance.removeComponent(component)
		}
		Undo.addState()
	}

	/**
	 * the components in a clipboard text, or null if the text is not from draw.tikz
	 * @returns the components and, if copied from draw.tikz, the position they were copied from
	 */
	private static parse(text: string): { components: ComponentSaveObject[]; selectionPos?: Point } | null {
		let data: any
		try {
			data = JSON.parse(text)
		} catch {
			return null
		}
		if (data?.drawtikz == "clipboard" && Array.isArray(data.components)) {
			const clipboard = data as ClipboardData
			return {
				components: clipboard.components,
				selectionPos: new Point(clipboard.selectionPos.x, clipboard.selectionPos.y),
			}
		}
		// the contents of a drawing file (SaveFileFormat) are pasted at the cursor
		if (typeof data?.version == "string" && Array.isArray(data.components)) {
			return { components: data.components }
		}
		return null
	}
}

/**
 * if the user is typing in a text field, where copy and paste have to keep their normal behaviour
 */
export function isTextInput(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}
