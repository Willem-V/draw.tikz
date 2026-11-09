import { CanvasController, textToSVG } from "../internal"
import * as SVG from "@svgdotjs/svg.js"

/**
 * removes a text group made by convertTextToNativeSVGText and the rendered math symbols it refers to (they live in the defs
 * of the canvas and would pile up otherwise)
 */
export function removeTextSVG(group?: SVG.G) {
	if (!group) return
	for (const use of group.find("use")) {
		const id = use.node.getAttribute("xlink:href") ?? use.node.getAttribute("href")
		if (id) CanvasController.instance.canvas.find(id)[0]?.remove()
	}
	group.remove()
}

/** converts the text elements of an exported SVG into paths, so they show up in programs without the fonts */
export function textsToPaths(svg: SVG.Element) {
	for (const textElement of [...(svg.find("text") as SVG.List<SVG.Text>)]) {
		const transform = textElement.transform()
		const fontSize = new SVG.Number(textElement.attr("font-size")).convertToUnit("px").value
		const g = new SVG.G()
		g.fill(textElement.fill())
		g.transform(transform)
		for (const tspan of textElement.find("tspan") as SVG.List<SVG.Tspan>) {
			const d = textToSVG.getD(tspan.node.textContent, {
				x: Number.parseFloat(tspan.node.getAttribute("x")),
				y: Number.parseFloat(tspan.node.getAttribute("y")),
				fontSize: fontSize,
			})
			g.add(new SVG.Path({ d: d }))
		}
		textElement.parent().add(g)
		textElement.remove()
	}
}
