import { EditableProperty } from "../internal"

/** sections which are collapsed until the user opens them: settings which are rarely needed */
const collapsedByDefault = new Set([
	"Info",
	"TikZ name",
	"Symbol Orientation",
	"Poles",
	"Stroke",
	"Fill",
	"Arrows",
	"Array",
	"Voltage label",
	"Current label",
])
const storageKey = "drawtikz-collapsed-sections"

/**
 * The header of a section in the properties window. Clicking it collapses or expands the rows after it (up to the next
 * header). Whether a section is collapsed is remembered per title in the browser.
 */
export class SectionHeaderProperty extends EditableProperty<string> {
	private labelElement: HTMLElement

	/** title -> collapsed, as changed by the user */
	private static userChoices: Record<string, boolean> = loadChoices()

	public static isCollapsed(title: string): boolean {
		return SectionHeaderProperty.userChoices[title] ?? collapsedByDefault.has(title)
	}

	public eq(first: string, second: string): boolean {
		return first == second
	}

	public buildHTML(): HTMLElement {
		let row = this.getRow()
		row.classList.add("propertySectionHeader")
		row.dataset.section = this.value ?? ""

		const button = document.createElement("button")
		button.type = "button"
		button.classList.add("col-12", "btn", "btn-link", "text-reset", "text-decoration-none", "p-0", "d-flex")
		button.classList.add("align-items-center", "gap-1", "fw-bold", "text-start")
		const chevron = document.createElement("span")
		chevron.classList.add("material-symbols-outlined", "sectionChevron")
		chevron.innerText = "expand_more"
		this.labelElement = document.createElement("span")
		this.labelElement.innerHTML = this.value ?? ""
		button.append(chevron, this.labelElement)
		button.addEventListener("click", () => {
			const collapsed = !SectionHeaderProperty.isCollapsed(this.value)
			SectionHeaderProperty.userChoices[this.value] = collapsed
			saveChoices(SectionHeaderProperty.userChoices)
			SectionHeaderProperty.applyCollapsed(row)
		})

		row.appendChild(button)
		return row
	}

	/**
	 * hides the rows of collapsed sections
	 * @param headerOrContainer a section header row (only its section is updated) or a container with sections
	 */
	public static applyCollapsed(headerOrContainer: HTMLElement) {
		const headers =
			headerOrContainer.classList.contains("propertySectionHeader") ?
				[headerOrContainer]
			:	Array.from(headerOrContainer.querySelectorAll<HTMLElement>(".propertySectionHeader"))
		for (const header of headers) {
			const collapsed = SectionHeaderProperty.isCollapsed(header.dataset.section)
			header.classList.toggle("collapsed", collapsed)
			// a separate class, so it does not interfere with properties which hide themselves with d-none
			let row = header.nextElementSibling
			while (row && !row.classList.contains("propertySectionHeader")) {
				row.classList.toggle("sectionCollapsed", collapsed)
				row = row.nextElementSibling
			}
		}
	}

	protected disable(disabled?: boolean): void {}

	public updateHTML(): void {
		if (this.labelElement) {
			this.labelElement.innerHTML = this.value
		}
	}

	public getMultiEditVersion(properties: SectionHeaderProperty[]): SectionHeaderProperty {
		const result = new SectionHeaderProperty(properties[0].value, this.tooltip, this.id)

		result.getHTMLElement()
		return result
	}
}

function loadChoices(): Record<string, boolean> {
	try {
		const choices = JSON.parse(localStorage.getItem(storageKey) ?? "{}")
		return choices && typeof choices == "object" ? choices : {}
	} catch {
		return {}
	}
}

function saveChoices(choices: Record<string, boolean>) {
	try {
		localStorage.setItem(storageKey, JSON.stringify(choices))
	} catch {
		// only a convenience
	}
}
