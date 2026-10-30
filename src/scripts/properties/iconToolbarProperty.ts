import { EditableProperty } from "../internal"

/**
 * a button of an {@link IconToolbarProperty}
 */
export type ToolbarButton = {
	/** name of a Material Symbol */
	icon: string
	/** short text under the icon, e.g. "90°". Without it only the icon is shown */
	text?: string
	/** extra classes for the icon, e.g. "rotateText" to turn it by 90° */
	iconClasses?: string[]
	tooltip: string
	onClick: (ev: MouseEvent) => void
}

/**
 * a captioned row of buttons which belong together, e.g. "Rotate" or "Layer"
 */
export type ToolbarGroup = {
	label: string
	buttons: ToolbarButton[]
}

/**
 * the tools at the top of the properties window: rows of icon buttons, each row with a caption (Rotate, Flip, Layer, ...)
 */
export class IconToolbarProperty extends EditableProperty<never> {
	private groups: ToolbarGroup[]
	private buttons: HTMLButtonElement[] = []

	public constructor(groups: ToolbarGroup[], id = "") {
		super(undefined as never, "", id)
		this.groups = groups
	}

	public eq(first: never, second: never): boolean {
		return false
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const toolbar = document.createElement("div")
		toolbar.classList.add("col-12", "propertyToolbar")
		toolbar.setAttribute("role", "toolbar")
		for (const group of this.groups) {
			const caption = document.createElement("div")
			caption.classList.add("propertyToolbarCaption")
			caption.innerText = group.label
			const groupElement = document.createElement("div")
			groupElement.classList.add("btn-group", "w-100")
			groupElement.setAttribute("role", "group")
			groupElement.setAttribute("aria-label", group.label)
			for (const definition of group.buttons) {
				const button = document.createElement("button")
				button.type = "button"
				button.classList.add("btn", "btn-outline-secondary", "propertyToolbarButton")
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
			toolbar.append(caption, groupElement)
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
 * the rotate and flip rows for a component or the selection
 */
export function transformGroups(
	rotate: (angleDeg: number) => void,
	flip: (horizontalAxis: boolean) => void,
	what: string
): ToolbarGroup[] {
	return [
		{
			label: "Rotate",
			buttons: [
				{
					icon: "rotate_left",
					text: "90°",
					tooltip: `Rotate ${what} 90° counter clockwise`,
					onClick: () => rotate(90),
				},
				{
					icon: "rotate_right",
					text: "90°",
					tooltip: `Rotate ${what} 90° clockwise`,
					onClick: () => rotate(-90),
				},
				{
					icon: "rotate_left",
					text: "45°",
					tooltip: `Rotate ${what} 45° counter clockwise`,
					onClick: () => rotate(45),
				},
				{
					icon: "rotate_right",
					text: "45°",
					tooltip: `Rotate ${what} 45° clockwise`,
					onClick: () => rotate(-45),
				},
			],
		},
		{
			label: "Flip",
			buttons: [
				{
					icon: "flip",
					iconClasses: ["rotateText"],
					text: "Vertical",
					tooltip: `Flip ${what} vertically (mirror at the horizontal axis)`,
					onClick: () => flip(true),
				},
				{
					icon: "flip",
					text: "Horizontal",
					tooltip: `Flip ${what} horizontally (mirror at the vertical axis)`,
					onClick: () => flip(false),
				},
			],
		},
	]
}

/**
 * the row which changes the drawing order of components: what is in front covers what is behind it
 */
export function layerGroup(
	toForeground: () => void,
	forward: () => void,
	backward: () => void,
	toBackground: () => void
): ToolbarGroup {
	return {
		label: "Layer",
		buttons: [
			{
				icon: "flip_to_front",
				text: "To front",
				tooltip: "Bring to the front of everything",
				onClick: toForeground,
			},
			{ icon: "move_up", text: "Forward", tooltip: "One layer forward", onClick: forward },
			{ icon: "move_down", text: "Backward", tooltip: "One layer backward", onClick: backward },
			{ icon: "flip_to_back", text: "To back", tooltip: "Send behind everything", onClick: toBackground },
		],
	}
}
