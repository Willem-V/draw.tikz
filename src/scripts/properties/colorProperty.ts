import * as SVG from "@svgdotjs/svg.js"
import { EditableProperty } from "./editableProperty"
import { Undo } from "../internal"
import { Palette, PaletteChange, PaletteColor, PaletteUser } from "../utils/palette"

export class ColorProperty extends EditableProperty<SVG.Color | null> implements PaletteUser {
	private label: string
	private input: HTMLInputElement
	private nullable: boolean
	private enabler: HTMLInputElement
	private paletteButton: HTMLButtonElement
	private palettePopup: HTMLDivElement | undefined

	/**
	 * @param followPalette change the value when the palette entry it comes from changes (not for the temporary
	 * properties of the multi selection, which only pass the value on)
	 */
	public constructor(
		label: string,
		initialValue?: SVG.Color | null,
		nullable = true,
		tooltip = "",
		id: string = "",
		followPalette = true
	) {
		super(initialValue, tooltip, id)
		this.label = label
		this.nullable = nullable
		if (followPalette) {
			Palette.instance.addUser(this)
		}
	}

	/** the entry of the palette which the value comes from changed: the components using it follow */
	public onPaletteChange(change: PaletteChange): void {
		const value = this.value
		if (!(value instanceof PaletteColor)) {
			return
		}
		if (change.type == "update" && change.name == value.paletteName) {
			const color = Palette.instance.getColor(value.paletteName)
			if (color) {
				this.updateValue(color, true, true)
			}
		} else if (change.type == "rename" && change.name == value.paletteName) {
			// same color, the name is saved by the component
			this.updateValue(new PaletteColor(change.newName, value.toHex()), true, true)
		} else if (change.type == "remove" && change.name == value.paletteName) {
			// the color stays, but is not linked to the palette anymore
			this.updateValue(new SVG.Color(value.toHex()), true, true)
		}
	}

	public eq(first: SVG.Color | null, second: SVG.Color | null): boolean {
		if ((first == null && second == null) || first === second) {
			return true
		}

		if (first == null || second == null) {
			return false
		}

		const firstName = first instanceof PaletteColor ? first.paletteName : undefined
		const secondName = second instanceof PaletteColor ? second.paletteName : undefined
		if (firstName != secondName) {
			return false
		}
		let f = first.rgb()
		let s = second.rgb()
		return f.r == s.r && f.g == s.g && f.b == s.b
	}
	public buildHTML(): HTMLElement {
		let row = this.getRow()
		let col = document.createElement("div") as HTMLDivElement
		col.classList.add("col-12", "input-group", "my-0")
		{
			let labelElement = document.createElement("label") as HTMLLabelElement
			labelElement.classList.add("input-group-text")
			labelElement.innerHTML = this.label || "Choose color"
			col.appendChild(labelElement)

			if (this.nullable) {
				let enablerDiv = document.createElement("div") as HTMLDivElement
				enablerDiv.classList.add("input-group-text")
				this.enabler = document.createElement("input") as HTMLInputElement
				this.enabler.classList.add("form-check-input", "mt-0")
				this.enabler.type = "checkbox"
				this.enabler.checked = this.value !== null

				this.enabler.addEventListener("change", (ev) => {
					this.updateValue(this.enabler.checked ? new SVG.Color(this.input.value, "rgb") : null)
					Undo.addState()
				})
				enablerDiv.appendChild(this.enabler)
				col.appendChild(enablerDiv)
			}

			this.input = document.createElement("input") as HTMLInputElement
			this.input.classList.add("form-control", "form-control-color")
			this.input.value = this.value ? this.value.toString() : ""
			this.input.setAttribute("type", "color")

			this.input.addEventListener("input", (ev) => {
				if (this.nullable) {
					this.updateValue(this.enabler.checked ? new SVG.Color(this.input.value, "rgb") : null)
				} else {
					this.updateValue(new SVG.Color(this.input.value, "rgb"))
				}
			})
			this.input.addEventListener("change", (ev) => {
				Undo.addState()
			})

			col.appendChild(this.input)

			// the colors of the palette of the drawing
			this.paletteButton = document.createElement("button") as HTMLButtonElement
			this.paletteButton.type = "button"
			this.paletteButton.classList.add("btn", "btn-outline-secondary", "material-symbols-outlined", "px-2")
			this.paletteButton.innerText = "palette"
			this.paletteButton.addEventListener("click", (ev) => {
				ev.stopPropagation()
				this.togglePalettePopup()
			})
			col.appendChild(this.paletteButton)
		}
		row.appendChild(col)
		this.updatePaletteButton()
		return row
	}

	/** the button shows the color of the palette which is used */
	private updatePaletteButton() {
		if (!this.paletteButton) {
			return
		}
		const value = this.value
		if (value instanceof PaletteColor) {
			this.paletteButton.title = `Palette color "${value.paletteName}"`
			this.paletteButton.classList.add("active")
		} else {
			this.paletteButton.title = "Choose a color of the palette"
			this.paletteButton.classList.remove("active")
		}
	}

	private togglePalettePopup() {
		if (this.palettePopup) {
			this.closePalettePopup()
			return
		}
		const popup = document.createElement("div")
		popup.classList.add("border", "rounded", "bg-body", "shadow", "p-2")
		Object.assign(popup.style, {
			position: "fixed",
			zIndex: "3000",
			display: "grid",
			gridTemplateColumns: "repeat(4, 28px)",
			gap: "6px",
		})
		for (const entry of Palette.instance.entries) {
			const swatch = document.createElement("button")
			swatch.type = "button"
			swatch.title = entry.name
			Object.assign(swatch.style, {
				width: "28px",
				height: "28px",
				borderRadius: "4px",
				border: "1px solid var(--bs-border-color)",
				background: entry.color,
			})
			swatch.addEventListener("click", () => {
				const color = Palette.instance.getColor(entry.name)
				this.closePalettePopup()
				this.updateValue(color, true)
				Undo.addState()
			})
			popup.appendChild(swatch)
		}
		const rect = this.paletteButton.getBoundingClientRect()
		popup.style.left = `${Math.max(4, rect.right - 4 * 34 - 16)}px`
		popup.style.top = `${rect.bottom + 4}px`
		document.body.appendChild(popup)
		this.palettePopup = popup
		const outside = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node)) {
				this.closePalettePopup()
			}
		}
		// registered after the current click, so it doesn't close the popup right away
		setTimeout(() => document.addEventListener("click", outside, { once: true }), 0)
	}

	private closePalettePopup() {
		this.palettePopup?.remove()
		this.palettePopup = undefined
	}

	protected disable(disabled = true): void {
		this.input.disabled = disabled
		this.enabler.disabled = disabled
	}

	public updateHTML(): void {
		if (this.value) {
			this.input.value = this.value.toHex()
		}
		if (this.enabler) {
			this.enabler.checked = this.value != null
			this.enabler.indeterminate = false
		}
		this.updatePaletteButton()
	}

	public getMultiEditVersion(properties: ColorProperty[]): ColorProperty {
		let allEqual = this.equivalent(properties)

		const result = new ColorProperty(
			this.label,
			allEqual ? properties[0].value : null,
			this.nullable,
			this.tooltip,
			this.id,
			false
		)

		result.addChangeListener((ev) => {
			for (const property of properties) {
				property.updateValue(ev.value, true, true)
			}
		})
		result.getHTMLElement()
		if (!allEqual) {
			// the selected components have different colors
			if (result.enabler) {
				result.enabler.indeterminate = true
			}
			result.input.title = "The selected components have different colors"
		}
		return result
	}
}
