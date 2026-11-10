import * as SVG from "@svgdotjs/svg.js"
import {
	BooleanProperty,
	AbstractConstructor,
	CircuitComponent,
	ColorProperty,
	ComponentSaveObject,
	PropertyCategories,
	SectionHeaderProperty,
	SliderProperty,
} from "../internal"
import type { StrokeInfo } from "./strokable"
import { roundTikz } from "../utils/selectionHelper"
import { paletteNameOf, resolveColor } from "../utils/palette"
import { isUniformStrokes, thickCorrection } from "../utils/strokeThickness"

/**
 * the line width circuitikz uses for symbols by default (thin lines, thick lines are drawn twice as wide)
 */
export const defaultSymbolLineWidth = new SVG.Number(0.4, "pt")

/** the css variable of the stroke color of the symbols of the database (see MainController.preprocessSymbolColors) */
const symbolColorVariable = "--bs-emphasis-color"

/**
 * Adds a line width property to components drawn from the symbol database. All strokes of the symbol are scaled
 * relative to the circuitikz default, which is what circuitikz does with the `line width` option.
 *
 * The symbols in the database use `calc(var(--line-scale, 1) * width)` as stroke width (see MainController.preprocessSymbolStrokes), so only the custom property `--line-scale` has to be set on the `use` elements.
 */
export function SymbolLineWidth<TBase extends AbstractConstructor<CircuitComponent>>(Base: TBase) {
	abstract class SymbolLineWidth extends Base {
		protected lineWidthProperty: SliderProperty
		protected lineLockProperty: BooleanProperty
		/** the color of the whole symbol, null for the color of the theme */
		protected symbolColorProperty: ColorProperty

		constructor(...args: any[]) {
			super(...args)
			this.properties.add(
				PropertyCategories.stroke,
				new SectionHeaderProperty("Stroke", undefined, "stroke:header")
			)
			this.lineWidthProperty = new SliderProperty(
				"Width",
				0,
				10,
				0.1,
				defaultSymbolLineWidth,
				undefined,
				"Line width of the symbol. Thick parts of the symbol are scaled accordingly.",
				// the same id as the stroke width of shapes and wires, so a selection of both is edited together
				"stroke:width"
			)
			this.lineWidthProperty.addChangeListener((ev) => {
				this.updateLineWidth()
				this.update()
			})
			this.properties.add(PropertyCategories.stroke, this.lineWidthProperty)
			this.lineLockProperty = new BooleanProperty(
				"Lock line width",
				false,
				undefined,
				"Keep this width when the line width of everything is changed",
				"stroke:lock"
			)
			this.properties.add(PropertyCategories.stroke, this.lineLockProperty)

			// the symbols draw with the css variable of the default stroke color, so it is replaced on the elements
			this.symbolColorProperty = new ColorProperty(
				"Color",
				null,
				undefined,
				"Color of the symbol",
				"stroke:color"
			)
			this.symbolColorProperty.addChangeListener(() => {
				this.updateSymbolColor()
				this.update()
			})
			this.properties.add(PropertyCategories.stroke, this.symbolColorProperty)
		}

		/**
		 * the elements whose color follows the color of the symbol
		 */
		protected colorElements(): SVG.Element[] {
			return this.lineWidthElements()
		}

		protected updateSymbolColor() {
			const color = this.symbolColorProperty.value
			for (const element of this.colorElements()) {
				if (color) {
					element?.node.style.setProperty(symbolColorVariable, color.toHex())
				} else {
					element?.node.style.removeProperty(symbolColorVariable)
				}
			}
		}

		/**
		 * the tikz option for the color (if there is one)
		 */
		protected symbolColorTikzOptions(): string[] {
			const color = this.symbolColorProperty.value
			return color ? ["color=" + color.toTikzString()] : []
		}

		/**
		 * the factor by which the strokes are wider than the circuitikz default
		 */
		protected get lineScale(): number {
			return Math.max(0.01, this.lineWidthProperty.value.convertToUnit("pt").value) / defaultSymbolLineWidth.value
		}

		/**
		 * the elements (referencing symbols) whose strokes should follow the line width
		 */
		protected lineWidthElements(): SVG.Element[] {
			return [this.componentVisualization]
		}

		/**
		 * SVG scales the strokes of a symbol with the symbol, LaTeX does not (a scaled symbol keeps its line width). The
		 * factor which makes the stroke of the scaled symbol as wide as the line width, 1 for symbols which are not scaled
		 */
		protected strokeCompensation(): number {
			return 1
		}

		protected updateLineWidth() {
			if (!this.lineWidthProperty) {
				return
			}
			const scale = this.lineScale * this.strokeCompensation()
			for (const element of this.lineWidthElements()) {
				element?.node.style.setProperty("--line-scale", scale.toString())
			}
		}

		/**
		 * the tikz option for the line width (if it is not the default)
		 */
		protected lineWidthTikzOptions(): string[] {
			const width = this.lineWidthProperty.value.convertToUnit("pt").value
			if (Math.abs(width - defaultSymbolLineWidth.value) < 1e-6) {
				return []
			}
			return ["line width=" + roundTikz(width) + "pt"]
		}

		/**
		 * the exported svg should not depend on css custom properties (not supported by e.g. inkscape). Therefore every
		 * referenced symbol is exported with the resolved stroke widths, a separate copy per line scale.
		 */
		public toSVG(defs: Map<string, SVG.Element>): SVG.Element {
			const copiedSVG = super.toSVG(defs)
			for (const use of copiedSVG.find("use")) {
				const hrefAttribute = use.node.hasAttribute("xlink:href") ? "xlink:href" : "href"
				const id = use.node.getAttribute(hrefAttribute)?.replace(/^#/, "")
				if (!id) {
					continue
				}
				const scale = Number.parseFloat(use.node.style.getPropertyValue("--line-scale")) || 1
				use.node.style.removeProperty("--line-scale")
				const color = use.node.style.getPropertyValue(symbolColorVariable).trim()
				use.node.style.removeProperty(symbolColorVariable)
				const uniform = isUniformStrokes()
				const exportId =
					scale == 1 && !color && !uniform ?
						id
					:	id +
						(scale == 1 ? "" : "_lw" + scale.toFixed(3).replace(".", "-")) +
						(uniform ? "_u" : "") +
						(color ? "_c" + color.replace("#", "") : "")
				if ((scale == 1 && !color && !uniform) || !defs.has(exportId)) {
					const element = new SVG.Element(document.getElementById(id).cloneNode(true))
					element.id(exportId)
					for (const child of [element.node, ...element.node.querySelectorAll("[stroke-width]")]) {
						const strokeWidth = Number.parseFloat(child.getAttribute("stroke-width"))
						if (!Number.isNaN(strokeWidth)) {
							;(child as SVGElement).style.removeProperty("stroke-width")
							child.setAttribute("stroke-width", (strokeWidth * thickCorrection(strokeWidth) * scale).toString())
						}
					}
					if (color) {
						// css variables are not supported everywhere (e.g. inkscape): write the color
						for (const child of [element.node, ...element.node.querySelectorAll("*")]) {
							for (const attribute of ["fill", "stroke"]) {
								if (child.getAttribute(attribute) == `var(${symbolColorVariable})`) {
									child.setAttribute(attribute, color)
								}
							}
						}
					}
					defs.set(exportId, element)
				}
				use.node.setAttribute(hrefAttribute, "#" + exportId)
			}
			return copiedSVG
		}

		public toJson(): ComponentSaveObject {
			const data = super.toJson() as ComponentSaveObject & { lineWidth?: string; stroke?: StrokeInfo }
			if (this.lineWidthTikzOptions().length > 0) {
				data.lineWidth = this.lineWidthProperty.value.toString()
			}
			const color = this.symbolColorProperty.value
			if (color || this.lineLockProperty.value) {
				data.stroke = {}
				if (color) {
					data.stroke.color = color.toHex()
					data.stroke.palette = paletteNameOf(color)
				}
				if (this.lineLockProperty.value) data.stroke.locked = true
			}
			return data
		}

		protected applyJson(saveObject: ComponentSaveObject & { lineWidth?: string; stroke?: StrokeInfo }): void {
			super.applyJson(saveObject)
			this.lineLockProperty.value = saveObject.stroke?.locked ?? false
			this.symbolColorProperty.value = resolveColor(saveObject.stroke?.color, saveObject.stroke?.palette)
			this.updateSymbolColor()
			this.lineWidthProperty.value =
				saveObject.lineWidth ? new SVG.Number(saveObject.lineWidth) : defaultSymbolLineWidth
			this.updateLineWidth()
		}
	}
	return SymbolLineWidth
}
