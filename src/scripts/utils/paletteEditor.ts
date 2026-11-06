import {
	ColorProperty,
	MainController,
	SectionHeaderProperty,
	SelectionController,
	SelectionMode,
	Undo,
} from "../internal"
import { Palette, PaletteColor } from "./palette"

/**
 * The editor of the color palette of the drawing for the general settings: change, rename, add and remove colors.
 * Components which use a palette color follow the changes.
 */
export class PaletteEditor {
	public static createHTML(): HTMLDivElement {
		const container = document.createElement("div")
		container.id = "paletteEditor"
		container.classList.add("container-fluid", "w-100", "m-0", "px-0")
		container.appendChild(new SectionHeaderProperty("Color palette").getHTMLElement())

		const list = document.createElement("div")
		list.classList.add("d-flex", "flex-column", "gap-1", "px-2", "pb-2")
		container.appendChild(list)

		const render = () => {
			list.innerHTML = ""
			for (const entry of Palette.instance.entries) {
				const row = document.createElement("div")
				row.classList.add("d-flex", "align-items-center", "gap-2")

				// a big round swatch; the system color picker is an invisible input on top of it
				const swatch = document.createElement("label")
				Object.assign(swatch.style, {
					position: "relative",
					width: "34px",
					height: "34px",
					flex: "none",
					borderRadius: "50%",
					border: "1px solid var(--bs-border-color)",
					boxShadow: "0 0 0 2px var(--bs-body-bg) inset",
					background: entry.color,
					cursor: "pointer",
					overflow: "hidden",
				})
				swatch.title = "Change the color"
				const color = document.createElement("input")
				color.type = "color"
				Object.assign(color.style, {
					position: "absolute",
					inset: "0",
					width: "100%",
					height: "100%",
					opacity: "0",
					cursor: "pointer",
				})
				swatch.appendChild(color)
				color.value = entry.color
				color.addEventListener("input", () => (swatch.style.background = color.value))
				color.addEventListener("change", () => {
					Palette.instance.setColor(entry.name, color.value)
					Undo.addState()
				})

				const name = document.createElement("input")
				name.type = "text"
				name.classList.add("form-control", "form-control-sm")
				name.value = entry.name
				name.title =
					"Name of the color (exported as the TikZ color dt" + entry.name.replace(/[^A-Za-z]/g, "") + ")"
				name.addEventListener("change", () => {
					if (name.value.trim() && name.value != entry.name) {
						Palette.instance.rename(entry.name, Palette.instance.uniqueName(name.value))
						Undo.addState()
					} else {
						name.value = entry.name
					}
				})

				const remove = document.createElement("button")
				remove.type = "button"
				remove.classList.add("btn", "btn-sm", "btn-outline-secondary", "border-0")
				remove.title = "Remove from the palette (components keep the color)"
				remove.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem">close</span>'
				remove.addEventListener("click", () => {
					Palette.instance.remove(entry.name)
					Undo.addState()
				})

				const select = document.createElement("button")
				select.type = "button"
				select.classList.add("btn", "btn-sm", "btn-outline-secondary", "border-0")
				select.title = "Select all components which use this color"
				select.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem">select_all</span>'
				select.addEventListener("click", () => {
					const used = MainController.instance.circuitComponents.filter((component) =>
						[...component.properties.values()]
							.flat()
							.some(
								(property) =>
									property instanceof ColorProperty &&
									property.value instanceof PaletteColor &&
									property.value.paletteName == entry.name
							)
					)
					SelectionController.instance.selectComponents(used, SelectionMode.RESET)
				})

				row.append(swatch, name, select, remove)
				list.appendChild(row)
			}

			const buttons = document.createElement("div")
			buttons.classList.add("d-flex", "gap-2", "mt-1")
			const add = document.createElement("button")
			add.type = "button"
			add.classList.add("btn", "btn-sm", "btn-outline-secondary")
			add.textContent = "Add color"
			add.addEventListener("click", () => {
				Palette.instance.add("Color", "#808080")
				Undo.addState()
			})
			const reset = document.createElement("button")
			reset.type = "button"
			reset.classList.add("btn", "btn-sm", "btn-outline-secondary")
			reset.textContent = "Reset palette"
			reset.addEventListener("click", () => {
				Palette.instance.reset()
				Undo.addState()
			})
			buttons.append(add, reset)
			list.appendChild(buttons)
		}
		render()
		Palette.instance.onChange = render
		return container
	}
}
