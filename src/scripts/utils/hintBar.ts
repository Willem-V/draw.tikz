import { MainController, Modes, SelectionController } from "../internal"

export type KeyHint = {
	/** the text of the key, e.g. "Space" */
	key: string
	/** what the key does */
	action: string
}

/**
 * The bar at the bottom of the canvas which shows what is going on and which keys can be used right now.
 * Drawing wires, placing and moving show their own hints, otherwise the bar shows the hints for the selection.
 */
export class HintBar {
	/** wires, placing or moving show their hints, the selection does not replace them */
	private static busy = false

	/**
	 * shows the hints of an action until {@link clear} is called
	 * @param title what the user is doing, e.g. "Moving"
	 * @param value shown in bold after the title, e.g. the current wire mode
	 */
	public static show(title: string, value: string, hints: KeyHint[]) {
		HintBar.busy = true
		HintBar.render(title, value, hints)
	}

	/**
	 * ends the hints of an action, the bar goes back to the hints of the selection
	 */
	public static clear() {
		HintBar.busy = false
		HintBar.updateSelection()
	}

	/**
	 * shows the keys for the selected components, call after the selection changed
	 */
	public static updateSelection() {
		if (HintBar.busy) {
			return
		}
		const selected = SelectionController.instance.currentlySelectedComponents.length
		if (selected > 0 && MainController.instance.mode == Modes.DRAG_PAN) {
			HintBar.render(`${selected} selected`, "", transformHints())
		} else {
			document.getElementById("hintBar")?.classList.add("d-none")
		}
	}

	private static render(title: string, value: string, hints: KeyHint[]) {
		const bar = document.getElementById("hintBar")
		if (!bar) {
			return
		}
		const status = document.createElement("span")
		status.textContent = value ? `${title}: ` : title
		status.appendChild(document.createElement("b")).textContent = value

		const hintElements = hints.map((hint) => {
			const element = document.createElement("span")
			element.appendChild(document.createElement("kbd")).textContent = hint.key
			element.append(` ${hint.action}`)
			return element
		})
		bar.replaceChildren(status, ...hintElements)
		bar.classList.remove("d-none")
	}
}

/**
 * the keys which rotate and flip what is selected or moved
 */
export function transformHints(): KeyHint[] {
	const ctrl = MainController.instance.isMac ? "⌘" : "Ctrl"
	return [
		{ key: `${ctrl}+R`, action: "rotate ↻" },
		{ key: `${ctrl}+Shift+R`, action: "rotate ↺" },
		{ key: "Shift+X", action: "flip at x-axis" },
		{ key: "Shift+Y", action: "flip at y-axis" },
	]
}
