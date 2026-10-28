import * as SVG from "@svgdotjs/svg.js"
import { BooleanProperty, SliderProperty } from "../internal"

export type SizeProperties = {
	width: SliderProperty
	height: SliderProperty
	lockAspectRatio: BooleanProperty
}

/**
 * creates the width and height properties of resizable symbols (in circuitikz units) together with a property to lock their aspect ratio
 * @param onChange called after the size changed (also when the other dimension was adjusted to keep the aspect ratio)
 */
export function createSizeProperties(
	defaultWidth: number,
	defaultHeight: number,
	tooltip: string,
	idPrefix: string,
	onChange: () => void
): SizeProperties {
	const width = new SliderProperty(
		"Width",
		0.1,
		10,
		0.05,
		new SVG.Number(defaultWidth),
		false,
		tooltip,
		idPrefix + ":width"
	)
	const height = new SliderProperty(
		"Height",
		0.1,
		10,
		0.05,
		new SVG.Number(defaultHeight),
		false,
		tooltip,
		idPrefix + ":height"
	)
	const lockAspectRatio = new BooleanProperty(
		"Lock aspect ratio",
		false,
		undefined,
		"Keep the ratio between width and height when changing one of them",
		idPrefix + ":lockAspectRatio"
	)

	const keepRatio = (changed: SliderProperty, other: SliderProperty, previous: SVG.Number) => {
		if (lockAspectRatio.value && previous.value > 0) {
			const factor = changed.value.value / previous.value
			const value = Math.max(0.01, Math.round(other.value.value * factor * 1000) / 1000)
			// don't notify the listeners, otherwise the change would bounce back
			other.updateValue(new SVG.Number(value), true, false)
		}
		onChange()
	}
	width.addChangeListener((ev) => keepRatio(width, height, ev.previousValue))
	height.addChangeListener((ev) => keepRatio(height, width, ev.previousValue))

	return { width, height, lockAspectRatio }
}
