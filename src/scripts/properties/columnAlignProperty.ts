import { EditableProperty, Undo } from "../internal"

/**
 * the text alignment of every column of a table: three buttons (left, center, right) per column.
 * Clicking the selected button again goes back to the alignment of the whole table.
 * The value is one letter per column: l, c, r or - (like the whole table).
 */
export class ColumnAlignProperty extends EditableProperty<string> {
	private body: HTMLDivElement
	private columns = 0

	public constructor(initalValue = "", tooltip = "", id: string = "") {
		super(initalValue, tooltip, id)
	}

	/** the number of columns of the table, shown as one row of buttons each */
	public setColumns(columns: number) {
		if (columns == this.columns) return
		this.columns = columns
		this.render()
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const cell = document.createElement("div")
		cell.classList.add("col-12", "mt-0")
		const label = document.createElement("div")
		label.classList.add("small", "text-secondary")
		label.textContent = "Alignment per column"
		this.body = document.createElement("div")
		this.body.classList.add("d-flex", "flex-column", "gap-1")
		cell.append(label, this.body)
		row.appendChild(cell)
		this.render()
		return row
	}

	private letters(): string[] {
		return Array.from({ length: this.columns }, (_, i) => {
			const letter = (this.value ?? "")[i]
			return letter == "l" || letter == "c" || letter == "r" ? letter : "-"
		})
	}

	private render() {
		if (!this.body) return
		this.body.replaceChildren()
		const letters = this.letters()
		const icons: [string, string, string][] = [
			["l", "format_align_left", "Left"],
			["c", "format_align_center", "Center"],
			["r", "format_align_right", "Right"],
		]
		for (let column = 0; column < this.columns; column++) {
			const line = document.createElement("div")
			line.classList.add("d-flex", "align-items-center", "gap-2")
			const name = document.createElement("span")
			name.classList.add("small", "text-secondary")
			name.style.width = "4.5em"
			name.textContent = "Column " + (column + 1)
			const group = document.createElement("div")
			group.classList.add("btn-group", "btn-group-sm")
			for (const [letter, icon, title] of icons) {
				const button = document.createElement("button")
				button.type = "button"
				button.classList.add("btn", letters[column] == letter ? "btn-primary" : "btn-outline-secondary")
				button.title = title
				const symbol = document.createElement("span")
				symbol.classList.add("material-symbols-outlined")
				symbol.style.fontSize = "1.1em"
				symbol.textContent = icon
				button.appendChild(symbol)
				button.addEventListener("click", () => {
					const next = this.letters()
					next[column] = next[column] == letter ? "-" : letter
					// trailing columns like the whole table need no letters
					this.updateValue(next.join("").replace(/-+$/, ""), true)
					Undo.addState()
				})
				group.appendChild(button)
			}
			line.append(name, group)
			this.body.appendChild(line)
		}
	}

	public updateHTML(): void {
		this.render()
	}

	protected disable(disabled = true): void {
		this.body?.querySelectorAll("button").forEach((b) => (b.disabled = disabled))
	}

	public eq(first: string, second: string): boolean {
		return first == second
	}

	public getMultiEditVersion(properties: ColumnAlignProperty[]): ColumnAlignProperty {
		const result = new ColumnAlignProperty(this.equivalent(properties) ? this.value : "", this.tooltip, this.id)
		result.setColumns(Math.max(...properties.map((p) => p.columns)))
		result.addChangeListener((ev) => {
			for (const property of properties) property.updateValue(ev.value, true, true)
		})
		return result
	}
}
