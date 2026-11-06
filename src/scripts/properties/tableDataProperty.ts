import { CanvasController, EditableProperty, Undo } from "../internal"

/**
 * a small spreadsheet for a table of numbers: one row per point, one input per column.
 * Whole tables can be pasted from a spreadsheet into any cell. The value is the table as text
 * (one line per row, cells separated by a space, "nan" for an empty cell), like the plot data is stored.
 */
export class TableDataProperty extends EditableProperty<string> {
	private body: HTMLDivElement
	private rows: string[][] = []
	private columns = 2
	private previousState = ""

	public constructor(initalValue = "", tooltip = "", id: string = "") {
		super(initalValue, tooltip, id)
	}

	private static parse(text: string): string[][] {
		return text
			.replace(/\r/g, "")
			.split("\n")
			.map((line) =>
				line
					.trim()
					.split(/[,;\t ]+/)
					.filter((cell) => cell !== "")
					.map((cell) => (cell.toLowerCase() == "nan" ? "" : cell))
			)
			.filter((cells) => cells.length > 0)
	}

	private serialize(): string {
		return this.rows
			.filter((cells) => cells.some((cell) => cell.trim() !== ""))
			.map((cells) => Array.from({ length: this.columns }, (_, i) => (cells[i] ?? "").trim() || "nan").join(" "))
			.join("\n")
	}

	private commit() {
		this.updateValue(this.serialize())
	}

	private loadFromValue() {
		this.rows = TableDataProperty.parse(this.value ?? "")
		this.columns = Math.max(2, ...this.rows.map((r) => r.length))
		if (this.rows.length == 0) this.rows = [[]]
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const cell = document.createElement("div")
		cell.classList.add("col-12", "mt-0")
		this.body = document.createElement("div")
		this.body.style.maxHeight = "16em"
		this.body.style.overflowY = "auto"
		cell.appendChild(this.body)
		row.appendChild(cell)

		const buttons = document.createElement("div")
		buttons.classList.add("d-flex", "gap-2", "mt-1")
		const button = (text: string, title: string, action: () => void) => {
			const b = document.createElement("button")
			b.type = "button"
			b.classList.add("btn", "btn-sm", "btn-outline-secondary")
			b.textContent = text
			b.title = title
			b.addEventListener("click", action)
			buttons.appendChild(b)
		}
		button("Add row", "Add a point at the end", () => {
			this.rows.push([])
			this.render(this.rows.length - 1, 0)
		})
		button("Clear", "Remove all points", () => {
			this.rows = [[]]
			this.render(0, 0)
			this.commit()
			Undo.addState()
		})
		cell.appendChild(buttons)
		this.loadFromValue()
		this.render()
		return row
	}

	private render(focusRow = -1, focusColumn = 0) {
		this.body.replaceChildren()
		const grid = document.createElement("div")
		grid.style.display = "grid"
		grid.style.gridTemplateColumns = `2em repeat(${this.columns}, minmax(0, 1fr)) 2em`
		grid.style.gap = "2px"
		grid.style.alignItems = "center"
		const add = (el: HTMLElement) => grid.appendChild(el)
		const header = (text: string) => {
			const h = document.createElement("div")
			h.classList.add("small", "text-secondary", "text-center")
			h.textContent = text
			add(h)
		}
		header("")
		for (let c = 0; c < this.columns; c++)
			header(
				c == 0 ? "x"
				: c == 1 ? "y"
				: String(c + 1)
			)
		header("")
		const inputs: HTMLInputElement[][] = []
		this.rows.forEach((cells, r) => {
			const n = document.createElement("div")
			n.classList.add("small", "text-secondary", "text-end", "pe-1")
			n.textContent = String(r + 1)
			add(n)
			inputs[r] = []
			for (let c = 0; c < this.columns; c++) {
				const input = document.createElement("input")
				input.type = "text"
				input.inputMode = "decimal"
				input.classList.add("form-control", "form-control-sm", "px-1")
				input.value = cells[c] ?? ""
				input.addEventListener("focusin", () => (this.previousState = this.value))
				input.addEventListener("input", () => {
					this.rows[r][c] = input.value
					this.commit()
				})
				input.addEventListener("focusout", () => {
					if (this.previousState !== this.value) Undo.addState()
				})
				input.addEventListener("mousedown", () => {
					CanvasController.instance.draggingFromInput = input
				})
				input.addEventListener("keydown", (ev) => {
					if (ev.key == "Escape") input.blur()
					else if (ev.key == "Enter") {
						ev.preventDefault()
						if (r == this.rows.length - 1) this.rows.push([])
						this.render(r + 1, c)
					} else if (ev.key == "ArrowDown" && inputs[r + 1]) inputs[r + 1][c].focus()
					else if (ev.key == "ArrowUp" && inputs[r - 1]) inputs[r - 1][c].focus()
				})
				input.addEventListener("paste", (ev) => {
					const text = ev.clipboardData?.getData("text") ?? ""
					const pasted = TableDataProperty.parse(text)
					// a single value is pasted normally
					if (pasted.length == 0 || (pasted.length == 1 && pasted[0].length <= 1)) return
					ev.preventDefault()
					pasted.forEach((line, i) => {
						while (this.rows.length <= r + i) this.rows.push([])
						line.forEach((value, j) => {
							if (c + j < 20) {
								this.rows[r + i][c + j] = value
								this.columns = Math.max(this.columns, c + j + 1)
							}
						})
					})
					this.render()
					this.commit()
					Undo.addState()
				})
				inputs[r].push(input)
				add(input)
			}
			const remove = document.createElement("button")
			remove.type = "button"
			remove.classList.add("btn", "btn-sm", "btn-link", "text-secondary", "p-0")
			remove.title = "Remove this row"
			remove.textContent = "✕"
			remove.addEventListener("click", () => {
				this.rows.splice(r, 1)
				if (this.rows.length == 0) this.rows = [[]]
				this.render()
				this.commit()
				Undo.addState()
			})
			add(remove)
		})
		this.body.appendChild(grid)
		if (focusRow >= 0) inputs[focusRow]?.[focusColumn]?.focus()
	}

	public updateHTML(): void {
		if (!this.body) return
		// not while typing: the value then comes from the grid itself
		if (this.body.contains(document.activeElement) && this.serialize() == this.value) return
		this.loadFromValue()
		this.render()
	}

	protected disable(disabled = true): void {
		this.body?.querySelectorAll("input,button").forEach((e) => ((e as HTMLInputElement).disabled = disabled))
	}

	public eq(first: string, second: string): boolean {
		return first == second
	}

	public getMultiEditVersion(properties: TableDataProperty[]): TableDataProperty {
		const allEqual = this.equivalent(properties)
		const result = new TableDataProperty(allEqual ? this.value : "", this.tooltip, this.id)
		result.addChangeListener((ev) => {
			for (const property of properties) property.updateValue(ev.value, true, true)
		})
		return result
	}
}
