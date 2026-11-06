import { CanvasController } from "../internal"
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
