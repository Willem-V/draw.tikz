import * as SVG from "@svgdotjs/svg.js"
import { BooleanProperty, SliderProperty } from "../internal"

export type SizeProperties = {
	width: SliderProperty
	height: SliderProperty
	lockAspectRatio: BooleanProperty
}

/**
 * creates the width and height properties of resizable symbols (in circuitikz units) together with a property to lock their aspect ratio
 * @param onChange called after the size changed (also when the other dimension was adjusted to keep the aspect ratio), with the slider the user changed
 * @param options.max the maximum of both sliders
 * @param options.heightLabel the label of the height slider
 * @param options.linked further sizes which are scaled together with width and height if the aspect ratio is locked
 */
export function createSizeProperties(
	defaultWidth: number,
	defaultHeight: number,
	tooltip: string,
	idPrefix: string,
	onChange: (changed: SliderProperty) => void,
	options: { max?: number; heightLabel?: string; linked?: SliderProperty[] } = {}
): SizeProperties {
	const max = options.max ?? 10
	const width = new SliderProperty(
		"Width",
		0.1,
		max,
		0.05,
		new SVG.Number(defaultWidth),
		false,
		tooltip,
		idPrefix + ":width"
	)
	const height = new SliderProperty(
		options.heightLabel ?? "Height",
		0.1,
		max,
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
			for (const property of [other, ...(options.linked ?? [])]) {
				const value = Math.max(0.01, Math.round(property.value.value * factor * 1000) / 1000)
				// don't notify the listeners, otherwise the change would bounce back
				property.updateValue(new SVG.Number(value), true, false)
			}
		}
		onChange(changed)
	}
	width.addChangeListener((ev) => keepRatio(width, height, ev.previousValue))
	height.addChangeListener((ev) => keepRatio(height, width, ev.previousValue))

	return { width, height, lockAspectRatio }
}
