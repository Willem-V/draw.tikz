import * as SVG from "@svgdotjs/svg.js"
import {
	CircuitComponent,
	GroupComponent,
	MainController,
	SectionHeaderProperty,
	SliderProperty,
	Undo,
} from "../internal"

/**
 * Sets the line width of everything at once. Components with "Lock line width" keep their width, e.g. a thin grid next to thick
 * signal lines. Applies to the stroke width of shapes, wires, curves, ... and the line width of circuit symbols (in pt).
 */
export class LineWidthEditor {
	/** @returns how many components changed and how many were locked */
	public static apply(widthPt: number, components: CircuitComponent[] = MainController.instance.circuitComponents) {
		let changed = 0
		let locked = 0
		for (const component of components) {
			if (component instanceof GroupComponent) {
				const inner = LineWidthEditor.apply(widthPt, component.groupedComponents)
				changed += inner.changed
				locked += inner.locked
				continue
			}
			const properties = [...component.properties.values()].flat()
			const width = properties.find((p) => p.id == "stroke:width")
			if (!(width instanceof SliderProperty)) continue
			if (properties.some((p) => p.id == "stroke:lock" && p.value === true)) {
				locked++
				continue
			}
			width.updateValue(new SVG.Number(widthPt, "pt"), true, true)
			changed++
		}
		return { changed, locked }
	}

	public static createHTML(): HTMLDivElement {
		const container = document.createElement("div")
		container.id = "lineWidthEditor"
		container.classList.add("container-fluid", "w-100", "m-0", "px-0")
		container.appendChild(new SectionHeaderProperty("Line width of everything").getHTMLElement())
		const body = document.createElement("div")
		body.classList.add("d-flex", "flex-column", "gap-2", "px-2", "pb-2")
		container.appendChild(body)

		const group = document.createElement("div")
		group.classList.add("input-group", "input-group-sm")
		const label = document.createElement("span")
		label.classList.add("input-group-text")
		label.textContent = "Width (pt)"
		const input = document.createElement("input")
		input.type = "number"
		input.min = "0"
		input.step = "0.1"
		input.value = "1"
		input.classList.add("form-control")
		const button = document.createElement("button")
		button.type = "button"
		button.classList.add("btn", "btn-outline-secondary")
		button.textContent = "Apply to all"
		const info = document.createElement("div")
		info.classList.add("small", "text-body-secondary")
		info.textContent = 'Components with "Lock line width" (stroke section) keep their width.'
		button.addEventListener("click", () => {
			const width = Number(input.value)
			if (!Number.isFinite(width) || width < 0) return
			const { changed, locked } = LineWidthEditor.apply(width)
			info.textContent = `${changed} changed, ${locked} locked and kept.`
			Undo.addState()
		})
		input.addEventListener("keydown", (ev) => {
			ev.stopPropagation()
			if (ev.key == "Enter") button.click()
		})
		group.append(label, input, button)
		body.append(group, info)
		return container
	}
}
