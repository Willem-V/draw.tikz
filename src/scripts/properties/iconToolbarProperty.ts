import { EditableProperty } from "../internal"

/**
 * a button of an {@link IconToolbarProperty}
 */
export type ToolbarButton = {
	/** name of a Material Symbol */
	icon: string
	/** short text next to the icon, e.g. "45°" */
	text?: string
	/** extra classes for the icon, e.g. "rotateText" to turn it by 90° */
	iconClasses?: string[]
	tooltip: string
	onClick: (ev: MouseEvent) => void
}

/**
 * one row of small icon buttons, in groups (e.g. rotate | flip | order). Wraps on narrow panels.
 */
export class IconToolbarProperty extends EditableProperty<never> {
	private groups: ToolbarButton[][]
	private buttons: HTMLButtonElement[] = []

	public constructor(groups: ToolbarButton[][], id = "") {
		super(undefined as never, "", id)
		this.groups = groups
	}

	public eq(first: never, second: never): boolean {
		return false
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const toolbar = document.createElement("div")
		toolbar.classList.add("col-12", "btn-toolbar", "gap-2", "propertyToolbar")
		toolbar.setAttribute("role", "toolbar")
		for (const group of this.groups) {
			const groupElement = document.createElement("div")
			groupElement.classList.add("btn-group")
			groupElement.setAttribute("role", "group")
			for (const definition of group) {
				const button = document.createElement("button")
				button.type = "button"
				button.classList.add("btn", "btn-outline-primary", "d-flex", "align-items-center", "gap-1", "px-2")
				button.setAttribute("aria-label", definition.tooltip)
				button.setAttribute("data-bs-title", definition.tooltip)
				button.setAttribute("data-bs-toggle", "tooltip")
				const icon = document.createElement("span")
				icon.classList.add("material-symbols-outlined", ...(definition.iconClasses ?? []))
				icon.innerText = definition.icon
				button.appendChild(icon)
				if (definition.text) {
					const text = document.createElement("small")
					text.innerText = definition.text
					button.appendChild(text)
				}
				button.addEventListener("click", definition.onClick)
				this.buttons.push(button)
				groupElement.appendChild(button)
			}
			toolbar.appendChild(groupElement)
		}
		row.appendChild(toolbar)
		return row
	}

	protected disable(disabled = true): void {
		this.buttons.forEach((button) => (button.disabled = disabled))
	}

	public updateHTML(): void {}

	public getMultiEditVersion(properties: IconToolbarProperty[]): IconToolbarProperty {
		const result = new IconToolbarProperty(this.groups, this.id)
		result.getHTMLElement()
		return result
	}
}

/**
 * the rotate and flip buttons for a component or the selection
 */
export function transformButtons(
	rotate: (angleDeg: number) => void,
	flip: (horizontalAxis: boolean) => void,
	what: string
): ToolbarButton[][] {
	return [
		[
			{ icon: "rotate_left", tooltip: `Rotate ${what} 90° counter clockwise`, onClick: () => rotate(90) },
			{ icon: "rotate_right", tooltip: `Rotate ${what} 90° clockwise`, onClick: () => rotate(-90) },
			{
				icon: "rotate_left",
				text: "45°",
				tooltip: `Rotate ${what} 45° counter clockwise`,
				onClick: () => rotate(45),
			},
			{ icon: "rotate_right", text: "45°", tooltip: `Rotate ${what} 45° clockwise`, onClick: () => rotate(-45) },
		],
		[
			{
				icon: "flip",
				iconClasses: ["rotateText"],
				tooltip: `Flip ${what} vertically`,
				onClick: () => flip(true),
			},
			{ icon: "flip", tooltip: `Flip ${what} horizontally`, onClick: () => flip(false) },
		],
	]
}

/**
 * the buttons which change the drawing order of components
 */
export function orderButtons(
	toForeground: () => void,
	forward: () => void,
	backward: () => void,
	toBackground: () => void
): ToolbarButton[] {
	return [
		{ icon: "flip_to_front", tooltip: "Bring to the foreground", onClick: toForeground },
		{ icon: "arrow_upward", tooltip: "One step towards the foreground", onClick: forward },
		{ icon: "arrow_downward", tooltip: "One step towards the background", onClick: backward },
		{ icon: "flip_to_back", tooltip: "Move to the background", onClick: toBackground },
	]
}
