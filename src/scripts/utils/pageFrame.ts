import * as SVG from "@svgdotjs/svg.js"
import {
	CanvasController,
	ChoiceProperty,
	MainController,
	SectionHeaderProperty,
	SelectionController,
	Undo,
} from "../internal"

/** the size of the figure (the "page") and the guides, both are saved in the drawing */
export type PageSettings = { enabled: boolean; width: number; height: number; x: number; y: number }
export type Guide = { orientation: "v" | "h"; position: number }
export type PageSaveData = { page?: PageSettings; guides?: Guide[]; guidesHidden?: boolean }

/** widths of typical figures in cm */
const presets: { key: string; name: string; width?: number; height?: number }[] = [
	{ key: "custom", name: "custom" },
	{ key: "column", name: "one column (8.5 × 6 cm)", width: 8.5, height: 6 },
	{ key: "wide", name: "two columns (17.5 × 6 cm)", width: 17.5, height: 6 },
	{ key: "textwidth", name: "text width (15 × 8 cm)", width: 15, height: 8 },
	{ key: "a4", name: "A4 landscape (29.7 × 21 cm)", width: 29.7, height: 21 },
	{ key: "slide", name: "slide 16:9 (25.4 × 14.3 cm)", width: 25.4, height: 14.3 },
]

const cm = (value: number) => new SVG.Number(value, "cm").convertToUnit("px").value

/**
 * The page frame (size of the figure, shown as a dashed frame, used as the bounding box of the TikZ and SVG export) and the guides
 * (lines which components snap to). Positions are in cm in the coordinates of the exported TikZ code (y up).
 */
export class PageFrame {
	private static _instance: PageFrame
	public static get instance(): PageFrame {
		return PageFrame._instance ?? (PageFrame._instance = new PageFrame())
	}

	public page: PageSettings = { enabled: false, width: 8.5, height: 6, x: 0, y: 0 }
	public guides: Guide[] = []
	/** guides are only shown, components do not snap to them */
	public guidesVisible = true

	private frameElement: SVG.Rect | undefined
	private guideElements: SVG.Line[] = []

	/** the rectangle of the page in canvas coordinates (px, y down) */
	public rect(): SVG.Box | undefined {
		if (!this.page.enabled) return undefined
		return new SVG.Box(
			cm(this.page.x),
			-cm(this.page.y + this.page.height),
			cm(this.page.width),
			cm(this.page.height)
		)
	}

	/** the positions of the guides in px: vertical ones as x, horizontal ones as y (canvas coordinates) */
	public guidePositions(): { x: number[]; y: number[] } {
		return {
			x: this.guides.filter((g) => g.orientation == "v").map((g) => cm(g.position)),
			y: this.guides.filter((g) => g.orientation == "h").map((g) => -cm(g.position)),
		}
	}

	public toJson(): PageSaveData {
		const data: PageSaveData = {}
		if (this.page.enabled) data.page = { ...this.page }
		if (!this.guidesVisible) data.guidesHidden = true
		if (this.guides.length > 0) data.guides = this.guides.map((g) => ({ ...g }))
		return data
	}

	public fromJson(data: PageSaveData) {
		this.page = { enabled: false, width: 8.5, height: 6, x: 0, y: 0, ...(data.page ?? {}) }
		this.guides = (data.guides ?? []).map((g) => ({ ...g }))
		this.guidesVisible = !data.guidesHidden
		this.redraw()
		this.onChange()
	}

	/** called after every change, e.g. to redraw the editor */
	public onChange: () => void = () => {}

	private switchBound = false
	public redraw() {
		const toggle = document.getElementById("guidesVisible") as HTMLInputElement | null
		if (toggle) {
			toggle.checked = this.guidesVisible
			if (!this.switchBound) {
				this.switchBound = true
				toggle.addEventListener("change", () => {
					this.guidesVisible = toggle.checked
					this.redraw()
				})
			}
		}
		const canvas = CanvasController.instance?.canvas
		if (!canvas) return
		this.frameElement?.remove()
		this.frameElement = undefined
		const rect = this.rect()
		if (rect) {
			this.frameElement = canvas
				.rect(rect.w, rect.h)
				.move(rect.x, rect.y)
				.fill("none")
				.stroke({ color: "var(--bs-orange)", width: 1.5, dasharray: "8 4" })
			this.frameElement.node.style.pointerEvents = "none"
			this.frameElement.back()
		}
		this.guideElements.forEach((e) => e.remove())
		this.guideElements = []
		const extent = 1e5
		for (const guide of this.guidesVisible ? this.guides : []) {
			const line =
				guide.orientation == "v" ?
					canvas.line(cm(guide.position), -extent, cm(guide.position), extent)
				:	canvas.line(-extent, -cm(guide.position), extent, -cm(guide.position))
			line.stroke({ color: "var(--bs-cyan)", width: 1, dasharray: "4 3", opacity: 0.8 })
			line.node.style.pointerEvents = "none"
			line.back()
			this.guideElements.push(line)
		}
	}

	/** the TikZ line which makes the page the bounding box of the picture */
	public tikzBoundingBox(): string | undefined {
		if (!this.page.enabled) return undefined
		const p = this.page
		const f = (v: number) => String(Number(v.toFixed(3)))
		return `\\useasboundingbox (${f(p.x)},${f(p.y)}) rectangle (${f(p.x + p.width)},${f(p.y + p.height)});`
	}

	/** sets the page to the bounding box of the drawing */
	public fitToDrawing(margin = 0.3) {
		let box: SVG.Box | null = null
		for (const component of MainController.instance.circuitComponents) {
			if (component.hidden) continue
			const b = component.bbox
			if (b) box = box ? box.merge(b) : b
		}
		if (!box) return
		const toCm = (px: number) => new SVG.Number(px, "px").convertToUnit("cm").value
		const round = (v: number) => Number(v.toFixed(2))
		this.page = {
			enabled: true,
			x: round(toCm(box.x) - margin),
			y: round(-toCm(box.y2) - margin),
			width: round(toCm(box.w) + 2 * margin),
			height: round(toCm(box.h) + 2 * margin),
		}
	}
}

/** the editor of the page frame and the guides for the general settings */
export class PageEditor {
	public static createHTML(): HTMLDivElement {
		const container = document.createElement("div")
		container.id = "pageEditor"
		container.classList.add("container-fluid", "w-100", "m-0", "px-0")
		container.appendChild(new SectionHeaderProperty("Page frame and guides").getHTMLElement())
		const body = document.createElement("div")
		body.classList.add("d-flex", "flex-column", "gap-2", "px-2", "pb-2")
		container.appendChild(body)

		const changed = () => {
			PageFrame.instance.redraw()
			Undo.addState()
		}
		const row = (label: string, input: HTMLElement) => {
			const group = document.createElement("div")
			group.classList.add("input-group", "input-group-sm")
			const text = document.createElement("span")
			text.classList.add("input-group-text")
			text.textContent = label
			group.append(text, input)
			return group
		}
		const numberInput = (value: number, set: (v: number) => void, step = 0.5) => {
			const input = document.createElement("input")
			input.type = "number"
			input.step = String(step)
			input.classList.add("form-control")
			input.value = String(value)
			input.addEventListener("change", () => {
				const v = Number(input.value)
				if (Number.isFinite(v)) {
					set(v)
					changed()
				}
			})
			return input
		}
		const button = (text: string, onClick: () => void) => {
			const b = document.createElement("button")
			b.type = "button"
			b.classList.add("btn", "btn-sm", "btn-outline-secondary")
			b.textContent = text
			b.addEventListener("click", onClick)
			return b
		}

		const render = () => {
			const page = PageFrame.instance.page
			body.innerHTML = ""

			const enable = document.createElement("div")
			enable.classList.add("form-check", "form-switch")
			const checkbox = document.createElement("input")
			checkbox.type = "checkbox"
			checkbox.classList.add("form-check-input")
			checkbox.id = "pageEnabled"
			checkbox.checked = page.enabled
			checkbox.addEventListener("change", () => {
				page.enabled = checkbox.checked
				changed()
				PageFrame.instance.onChange()
			})
			const label = document.createElement("label")
			label.classList.add("form-check-label")
			label.htmlFor = "pageEnabled"
			label.textContent = "Page frame (export bounding box)"
			enable.append(checkbox, label)
			body.appendChild(enable)

			if (page.enabled) {
				const select = document.createElement("select")
				select.classList.add("form-select", "form-select-sm")
				for (const preset of presets) {
					const option = document.createElement("option")
					option.value = preset.key
					option.textContent = preset.name
					option.selected =
						preset.width !== undefined ? preset.width == page.width && preset.height == page.height : false
					select.appendChild(option)
				}
				select.addEventListener("change", () => {
					const preset = presets.find((p) => p.key == select.value)
					if (preset?.width) {
						page.width = preset.width
						page.height = preset.height
						changed()
						PageFrame.instance.onChange()
					}
				})
				body.appendChild(row("Size", select))
				const rerender = () => PageFrame.instance.onChange()
				body.appendChild(
					row(
						"Width (cm)",
						numberInput(page.width, (v) => ((page.width = Math.max(0.1, v)), rerender()))
					)
				)
				body.appendChild(
					row(
						"Height (cm)",
						numberInput(page.height, (v) => ((page.height = Math.max(0.1, v)), rerender()))
					)
				)
				body.appendChild(
					row(
						"Left (cm)",
						numberInput(page.x, (v) => ((page.x = v), rerender()))
					)
				)
				body.appendChild(
					row(
						"Bottom (cm)",
						numberInput(page.y, (v) => ((page.y = v), rerender()))
					)
				)
				body.appendChild(
					button("Fit to drawing", () => {
						PageFrame.instance.fitToDrawing()
						changed()
						PageFrame.instance.onChange()
					})
				)
			}

			const guideHeader = document.createElement("div")
			guideHeader.classList.add("fw-semibold", "mt-2")
			guideHeader.textContent = "Guides (shown on the canvas, switch in the view settings)"
			body.appendChild(guideHeader)
			PageFrame.instance.guides.forEach((guide, index) => {
				const input = numberInput(guide.position, (v) => (guide.position = v), 0.25)
				const group = row(guide.orientation == "v" ? "x (cm)" : "y (cm)", input)
				const remove = button("✕", () => {
					PageFrame.instance.guides.splice(index, 1)
					changed()
					PageFrame.instance.onChange()
				})
				group.appendChild(remove)
				body.appendChild(group)
			})
			const add = document.createElement("div")
			add.classList.add("d-flex", "gap-2")
			// a new guide starts in the middle of the page or at the origin
			const start = (orientation: "v" | "h") => {
				const p = PageFrame.instance.page
				const position =
					p.enabled ?
						orientation == "v" ?
							p.x + p.width / 2
						:	p.y + p.height / 2
					:	0
				PageFrame.instance.guides.push({ orientation, position })
				PageFrame.instance.guidesVisible = true
				changed()
				PageFrame.instance.onChange()
			}
			add.append(
				button("Add vertical guide", () => start("v")),
				button("Add horizontal guide", () => start("h"))
			)
			body.appendChild(add)
		}
		render()
		PageFrame.instance.onChange = render
		return container
	}
}
