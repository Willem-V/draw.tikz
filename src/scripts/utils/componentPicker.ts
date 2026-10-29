import { Offcanvas } from "bootstrap"

/**
 * Keyboard navigation in the symbol picker, similar to a picker in vim: typing in the search field is the insert mode,
 * Esc switches to the normal mode, in which h/j/k/l move between the symbols. Enter places the highlighted symbol in both modes.
 */
export function initComponentPickerNavigation(panel: HTMLDivElement, offcanvas: Offcanvas) {
	const searchInput = document.getElementById("componentFilterInput") as HTMLInputElement
	const modeIndicator = document.getElementById("componentPickerMode")
	let active: HTMLElement = null
	// for "gg"
	let pendingG = false

	// symbols in hidden (filtered) or collapsed groups have no offsetParent
	const visibleItems = () =>
		Array.from(panel.querySelectorAll<HTMLElement>(".libComponent")).filter((item) => item.offsetParent !== null)

	const setActive = (item: HTMLElement) => {
		active?.classList.remove("libComponentActive")
		active = item
		active?.classList.add("libComponentActive")
		active?.scrollIntoView({ block: "nearest" })
	}
	const resetActive = () => setActive(visibleItems()[0] ?? null)

	const centerOf = (item: HTMLElement) => {
		const rect = item.getBoundingClientRect()
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
	}

	/**
	 * moves the highlight horizontally to the previous/next symbol or vertically to the closest symbol in the previous/next row
	 */
	const move = (dx: number, dy: number) => {
		const items = visibleItems()
		if (!active || !items.includes(active)) {
			resetActive()
			return
		}
		if (dx) {
			setActive(items[Math.min(items.length - 1, Math.max(0, items.indexOf(active) + dx))])
			return
		}
		const from = centerOf(active)
		// the symbols of a row are vertically centered
		const candidates = items
			.map((item) => ({ item: item, ...centerOf(item) }))
			.filter((candidate) => (candidate.y - from.y) * dy > 2)
		if (candidates.length == 0) {
			return
		}
		const rowY = candidates.reduce((best, candidate) =>
			Math.abs(candidate.y - from.y) < Math.abs(best.y - from.y) ? candidate : best
		).y
		const closest = candidates
			.filter((candidate) => Math.abs(candidate.y - rowY) <= 2)
			.reduce((best, candidate) => (Math.abs(candidate.x - from.x) < Math.abs(best.x - from.x) ? candidate : best))
		setActive(closest.item)
	}

	const select = () => {
		if (!active || active.offsetParent === null) {
			resetActive()
		}
		// the symbol buttons place their component on mouseup
		active?.dispatchEvent(new MouseEvent("mouseup", { view: window, bubbles: true, cancelable: true }))
	}

	const showMode = () =>
		(modeIndicator.textContent = document.activeElement === searchInput ? "-- INSERT --" : "-- NORMAL --")
	const insertMode = () => {
		searchInput.focus()
		showMode()
	}
	const normalMode = () => {
		panel.focus()
		showMode()
		if (!active || active.offsetParent === null) {
			resetActive()
		}
	}
	// also when the search field is clicked
	searchInput.addEventListener("focus", showMode)
	searchInput.addEventListener("blur", showMode)
	// the filter listeners have to be registered before, so the highlight starts at the first match
	searchInput.addEventListener("input", resetActive)
	document.getElementById("filterRegexButton").addEventListener("click", resetActive)

	panel.addEventListener("shown.bs.offcanvas", () => {
		insertMode()
		searchInput.select()
		resetActive()
	})
	panel.addEventListener("hidden.bs.offcanvas", () => setActive(null))

	panel.addEventListener("keydown", (ev) => {
		const inSearch = document.activeElement === searchInput
		// handled keys must not reach the global shortcuts (e.g. r for a resistor)
		const handled = () => {
			ev.preventDefault()
			ev.stopPropagation()
		}
		if (ev.key == "Enter") {
			handled()
			select()
			return
		}
		if (ev.key == "Escape") {
			handled()
			if (inSearch) {
				normalMode()
			} else {
				offcanvas.hide()
			}
			return
		}
		if (ev.key == "ArrowDown" || ev.key == "ArrowUp") {
			handled()
			move(0, ev.key == "ArrowDown" ? 1 : -1)
			return
		}
		if (inSearch) {
			if (ev.ctrlKey && ["j", "n", "k", "p"].includes(ev.key)) {
				handled()
				move(0, ["j", "n"].includes(ev.key) ? 1 : -1)
			}
			return
		}
		if (ev.ctrlKey || ev.metaKey || ev.altKey) {
			return
		}
		handled()
		const wasPendingG = pendingG
		pendingG = false
		switch (ev.key) {
			case "h":
			case "ArrowLeft":
				move(-1, 0)
				break
			case "l":
			case "ArrowRight":
				move(1, 0)
				break
			case "j":
				move(0, 1)
				break
			case "k":
				move(0, -1)
				break
			case "g":
				if (wasPendingG) {
					resetActive()
				} else {
					pendingG = true
				}
				break
			case "G":
				setActive(visibleItems().at(-1) ?? null)
				break
			case "/":
			case "i":
			case "a":
				insertMode()
				break
			case "q":
				offcanvas.hide()
				break
		}
	})
}
