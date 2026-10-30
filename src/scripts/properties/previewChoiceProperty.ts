import { ChoiceEntry, ChoiceProperty, Undo } from "../internal"

export type PreviewChoiceEntry = ChoiceEntry & {
	/** a small svg (drawn with currentColor) showing what the choice looks like */
	preview: string
}

/**
 * a choice shown as buttons with only a picture of each option (the name is the tooltip), for settings which are easier to see than to describe
 */
export class PreviewChoiceProperty<T extends PreviewChoiceEntry> extends ChoiceProperty<T> {
	private previewLabel: string
	private buttons: HTMLButtonElement[] = []

	public constructor(label: string, choiceOptions: T[], initialValue?: T, tooltip = "", id = "") {
		super(label, choiceOptions, initialValue, tooltip, id)
		this.previewLabel = label
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const label = document.createElement("div")
		label.classList.add("col-12", "my-0")
		label.innerHTML = this.previewLabel
		row.appendChild(label)

		const group = document.createElement("div")
		group.classList.add("col-12", "my-0", "d-flex", "gap-2")
		group.setAttribute("role", "radiogroup")
		this.buttons = this.entries.map((entry) => {
			const button = document.createElement("button")
			button.type = "button"
			button.classList.add(
				"btn",
				"btn-outline-secondary",
				"flex-grow-1",
				"d-flex",
				"flex-column",
				"align-items-center"
			)
			button.setAttribute("role", "radio")
			// only the picture is shown, the name is for the tooltip and screen readers
			button.title = entry.name
			button.setAttribute("aria-label", entry.name)
			button.innerHTML = `<span class="choicePreview">${entry.preview}</span>`
			button.addEventListener("click", () => {
				this.updateValue(entry, true)
				Undo.addState()
			})
			group.appendChild(button)
			return button
		})
		row.appendChild(group)
		this.updateHTML()
		return row
	}

	protected disable(disabled = true): void {
		this.buttons.forEach((button) => (button.disabled = disabled))
	}

	public updateHTML(): void {
		this.buttons.forEach((button, index) => {
			const selected = this.entries[index].key == this.value?.key
			button.classList.toggle("active", selected)
			button.setAttribute("aria-checked", String(selected))
		})
	}
}
