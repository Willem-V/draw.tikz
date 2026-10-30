import * as SVG from "@svgdotjs/svg.js"
import { EditableProperty, Undo } from "../internal"

/**
 * Size of a symbol in steps where all its pins are on the grid (see utils/gridFit.ts): − and + go to the next smaller or
 * larger grid size. The value is the current (absolute) x/y scale.
 */
export class GridSizeProperty extends EditableProperty<SVG.Point> {
	private getScales: () => SVG.Point[]
	private sizeText: HTMLSpanElement
	private smallerButton: HTMLButtonElement
	private largerButton: HTMLButtonElement

	/**
	 * @param getScales the grid sizes of the symbol (they depend on its options)
	 */
	public constructor(getScales: () => SVG.Point[], initialValue: SVG.Point, id = "") {
		super(
			initialValue,
			"Sizes at which all pins of the symbol are on the grid. Use the free scale below for other sizes.",
			id
		)
		this.getScales = getScales
	}

	public eq(first: SVG.Point, second: SVG.Point): boolean {
		return first && second && Math.abs(first.x - second.x) < 1e-3 && Math.abs(first.y - second.y) < 1e-3
	}

	public buildHTML(): HTMLElement {
		const row = this.getRow()
		const col = document.createElement("div")
		col.classList.add("col-12", "my-0", "input-group", "flex-nowrap")

		const label = document.createElement("span")
		label.classList.add("input-group-text", "fs-6", "flex-grow-1")
		label.innerText = "Size on grid"
		col.appendChild(label)

		const button = (icon: string, title: string, direction: -1 | 1) => {
			const element = document.createElement("button")
			element.type = "button"
			element.classList.add("btn", "btn-outline-secondary", "material-symbols-outlined", "px-2")
			element.innerText = icon
			element.title = title
			element.addEventListener("click", () => this.step(direction))
			return element
		}
		this.smallerButton = button("remove", "Next smaller size on the grid", -1)
		col.appendChild(this.smallerButton)

		this.sizeText = document.createElement("span")
		this.sizeText.classList.add("input-group-text", "fs-6", "justify-content-center")
		this.sizeText.style.minWidth = "6.5em"
		col.appendChild(this.sizeText)

		this.largerButton = button("add", "Next larger size on the grid", 1)
		col.appendChild(this.largerButton)

		row.appendChild(col)
		this.updateHTML()
		return row
	}

	/**
	 * goes to the next smaller (-1) or larger (1) grid size. If the symbol is off the grid, the next one in that direction.
	 */
	private step(direction: -1 | 1) {
		const scales = this.getScales()
		const size = (scale: SVG.Point) => scale.x * scale.y
		const current = size(this.value)
		const next =
			direction > 0 ?
				scales.find((scale) => size(scale) > current * 1.001)
			:	scales.findLast((scale) => size(scale) < current * 0.999)
		if (next) {
			this.updateValue(new SVG.Point(next.x, next.y))
			this.updateHTML()
			Undo.addState()
		}
	}

	protected disable(disabled = true): void {
		this.smallerButton.disabled = disabled
		this.largerButton.disabled = disabled
	}

	public updateHTML(): void {
		if (!this.sizeText) {
			return
		}
		const scales = this.getScales()
		// symbols without grid sizes (e.g. only one pin) don't show the row
		this.element?.classList.toggle("d-none", scales.length == 0)
		const onGrid = scales.some((scale) => this.eq(scale, this.value))
		const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
		this.sizeText.innerText =
			!onGrid ? "off grid"
			: this.eq(this.value, new SVG.Point(this.value.x, this.value.x)) ? format(this.value.x)
			: `${format(this.value.x)} × ${format(this.value.y)}`
		this.sizeText.classList.toggle("text-body-secondary", !onGrid)
		const size = this.value.x * this.value.y
		this.smallerButton.disabled = !scales.some((scale) => scale.x * scale.y < size * 0.999)
		this.largerButton.disabled = !scales.some((scale) => scale.x * scale.y > size * 1.001)
	}

	public getMultiEditVersion(properties: GridSizeProperty[]): GridSizeProperty {
		// not used: the grid sizes depend on the symbol, so the property has no id and is not offered for multiple components
		return properties[0]
	}
}
