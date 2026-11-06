import * as SVG from "@svgdotjs/svg.js"
import { EditableProperty } from "./editableProperty"
import { Undo } from "../internal"
import { Palette, PaletteChange, PaletteColor, PaletteUser } from "../utils/palette"

/** the last custom colors, shared by all color fields */
const recentColors: string[] = []
function rememberRecentColor(hex: string) {
	const color = hex.toLowerCase()
	const index = recentColors.indexOf(color)
	if (index >= 0) recentColors.splice(index, 1)
	recentColors.unshift(color)
	recentColors.splice(12)
}

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

			// the native picker is only used for "Custom...", the visible control is the swatch button below
			this.input = document.createElement("input") as HTMLInputElement
			this.input.classList.add("d-none")
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
				rememberRecentColor(this.input.value)
				Undo.addState()
			})
			col.appendChild(this.input)

			// a big swatch with the name of the color, which opens the palette
			this.paletteButton = document.createElement("button") as HTMLButtonElement
			this.paletteButton.type = "button"
			this.paletteButton.classList.add(
				"btn",
				"btn-outline-secondary",
				"d-flex",
				"align-items-center",
				"gap-2",
				"text-start"
			)
			this.paletteButton.style.flex = "1 1 auto"
			this.swatchElement = document.createElement("span")
			Object.assign(this.swatchElement.style, {
				display: "inline-block",
				width: "2.4rem",
				height: "1.5rem",
				borderRadius: "4px",
				border: "2px solid var(--bs-body-color)",
				flex: "none",
			})
			this.swatchName = document.createElement("span")
			this.swatchName.classList.add("flex-grow-1", "text-truncate")
			const chevron = document.createElement("span")
			chevron.classList.add("material-symbols-outlined")
			chevron.style.fontSize = "1.2rem"
			chevron.textContent = "expand_more"
			this.paletteButton.append(this.swatchElement, this.swatchName, chevron)
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

	/** what "no color" looks like: a css color, or "none" for transparent */
	public defaultColor = "var(--bs-emphasis-color)"

	private swatchElement: HTMLSpanElement
	private swatchName: HTMLSpanElement

	/** the swatch shows the color (struck through for no color) and its name */
	private updatePaletteButton() {
		if (!this.paletteButton) {
			return
		}
		const value = this.value
		if (value) {
			this.swatchElement.style.background = value.toHex()
			this.swatchName.textContent = value instanceof PaletteColor ? value.paletteName : value.toHex()
			this.paletteButton.title =
				value instanceof PaletteColor ? `Palette color "${value.paletteName}"` : "Custom color"
		} else if (this.defaultColor == "none") {
			// transparent: a checkerboard
			this.swatchElement.style.background =
				"repeating-conic-gradient(var(--bs-secondary-bg) 0% 25%, var(--bs-body-bg) 0% 50%) 50% / 10px 10px"
			this.swatchName.textContent = "none"
			this.paletteButton.title = "No color"
		} else {
			this.swatchElement.style.background = this.defaultColor
			this.swatchName.textContent = "default"
			this.paletteButton.title = "Default color of the theme"
		}
	}

	private togglePalettePopup() {
		if (this.palettePopup) {
			this.closePalettePopup()
			return
		}
		const popup = document.createElement("div")
		popup.classList.add("rounded-3", "bg-body", "shadow", "p-3", "d-flex", "flex-column", "gap-2")
		Object.assign(popup.style, {
			position: "fixed",
			zIndex: "3000",
			width: "260px",
			border: "1px solid var(--bs-border-color)",
		})

		const grid = (colors: { name: string; color: string; palette: boolean }[], title: string) => {
			if (colors.length == 0) return
			const caption = document.createElement("div")
			caption.classList.add("text-body-secondary", "text-uppercase", "fw-semibold")
			caption.style.fontSize = "0.7rem"
			caption.style.letterSpacing = "0.05em"
			caption.textContent = title
			popup.appendChild(caption)
			const wrapper = document.createElement("div")
			Object.assign(wrapper.style, { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" })
			for (const entry of colors) {
				const swatch = document.createElement("button")
				swatch.type = "button"
				swatch.title = entry.name
				const selected =
					this.value &&
					(entry.palette ?
						this.value instanceof PaletteColor && this.value.paletteName == entry.name
					:	!(this.value instanceof PaletteColor) && this.value.toHex() == entry.color)
				Object.assign(swatch.style, {
					aspectRatio: "1",
					borderRadius: "50%",
					padding: "0",
					border: "1px solid var(--bs-border-color)",
					boxShadow: selected ? "0 0 0 2px var(--bs-body-bg), 0 0 0 4px var(--bs-primary)" : "",
					cursor: "pointer",
					background: entry.color,
				})
				swatch.addEventListener("click", () => {
					this.closePalettePopup()
					if (this.nullable && this.enabler) this.enabler.checked = true
					const color =
						entry.palette ? Palette.instance.getColor(entry.name) : new SVG.Color(entry.color, "rgb")
					this.updateValue(color, true)
					if (!entry.palette) rememberRecentColor(entry.color)
					Undo.addState()
				})
				wrapper.appendChild(swatch)
			}
			popup.appendChild(wrapper)
		}
		grid(
			Palette.instance.entries.map((entry) => ({ name: entry.name, color: entry.color, palette: true })),
			"Palette"
		)
		grid(
			recentColors.map((color) => ({ name: color, color, palette: false })),
			"Recent"
		)

		const custom = document.createElement("div")
		custom.classList.add("input-group", "input-group-sm")
		const hex = document.createElement("input")
		hex.type = "text"
		hex.classList.add("form-control")
		hex.placeholder = "#rrggbb"
		hex.value = this.value ? this.value.toHex() : ""
		const apply = () => {
			const text = hex.value.trim()
			if (/^#?[0-9a-fA-F]{6}$/.test(text)) {
				const color = new SVG.Color(text.startsWith("#") ? text : "#" + text)
				this.closePalettePopup()
				if (this.nullable && this.enabler) this.enabler.checked = true
				this.updateValue(color, true)
				rememberRecentColor(color.toHex())
				Undo.addState()
			} else {
				hex.classList.add("is-invalid")
			}
		}
		hex.addEventListener("keydown", (ev) => {
			ev.stopPropagation()
			if (ev.key == "Enter") apply()
		})
		const pick = document.createElement("button")
		pick.type = "button"
		pick.classList.add("btn", "btn-outline-secondary")
		pick.textContent = "Pick..."
		pick.title = "Choose any color with the color picker"
		pick.addEventListener("click", () => {
			this.closePalettePopup()
			if (this.nullable && this.enabler) this.enabler.checked = true
			this.input.click()
		})
		custom.append(hex, pick)
		popup.appendChild(custom)

		const rect = this.paletteButton.getBoundingClientRect()
		popup.style.left = `${Math.max(4, Math.min(window.innerWidth - 270, rect.right - 260))}px`
		popup.style.top = `${rect.bottom + 4}px`
		document.body.appendChild(popup)
		this.palettePopup = popup
		const outside = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node)) {
				this.closePalettePopup()
			} else {
				document.addEventListener("click", outside, { once: true })
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
		if (this.paletteButton) this.paletteButton.disabled = disabled
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
