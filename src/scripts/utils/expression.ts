/**
 * A small safe evaluator for formulas of x like `sin(2*pi*x) / (1 + x^2)`. No eval is used.
 * Supports + - * / ^ (right associative), unary minus, parentheses, the variable x, the constants pi and e and the functions
 * sin cos tan asin acos atan sinh cosh tanh exp ln log (base 10) log2 sqrt abs floor ceil sign min max.
 * A number directly followed by x, a function or a parenthesis (2x, 3(x+1)) is a product.
 */
export type CompiledExpression = (x: number) => number

const functions: Record<string, (...args: number[]) => number> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	exp: Math.exp,
	ln: Math.log,
	log: Math.log10,
	log2: Math.log2,
	sqrt: Math.sqrt,
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	sign: Math.sign,
	min: Math.min,
	max: Math.max,
}

const constants: Record<string, number> = { pi: Math.PI, e: Math.E }

type Token = { type: "num"; value: number } | { type: "id"; name: string } | { type: "op"; op: string }

function tokenize(text: string): Token[] {
	const tokens: Token[] = []
	const pattern =
		/\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^(),]))/y
	let index = 0
	while (index < text.length) {
		pattern.lastIndex = index
		const match = pattern.exec(text)
		if (!match) {
			if (text.slice(index).trim() === "") break
			throw new Error(`Unexpected character "${text[index]}"`)
		}
		index = pattern.lastIndex
		if (match[1] !== undefined) tokens.push({ type: "num", value: Number(match[1]) })
		else if (match[2] !== undefined) tokens.push({ type: "id", name: match[2] })
		else tokens.push({ type: "op", op: match[3] == "**" ? "^" : match[3] })
	}
	return tokens
}

/** @throws Error with a readable message if the formula is not valid */
export function compileExpression(text: string): CompiledExpression {
	const tokens = tokenize(text)
	let pos = 0
	const peek = () => tokens[pos]
	const isOp = (op: string) => peek()?.type == "op" && (peek() as any).op == op

	type Node = (x: number) => number

	function parseSum(): Node {
		let left = parseProduct()
		while (isOp("+") || isOp("-")) {
			const op = (tokens[pos++] as any).op
			const right = parseProduct()
			const l = left
			left = op == "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x)
		}
		return left
	}

	function startsFactor(): boolean {
		const t = peek()
		return t !== undefined && (t.type == "num" || t.type == "id" || (t.type == "op" && t.op == "("))
	}

	function parseProduct(): Node {
		let left = parseUnary()
		for (;;) {
			if (isOp("*") || isOp("/")) {
				const op = (tokens[pos++] as any).op
				const right = parseUnary()
				const l = left
				left = op == "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x)
			} else if (startsFactor() && tokens[pos - 1]?.type == "num") {
				// implicit product after a number: 2x, 3(x+1), 2sin(x)
				const right = parseUnary()
				const l = left
				left = (x) => l(x) * right(x)
			} else {
				return left
			}
		}
	}

	function parseUnary(): Node {
		if (isOp("-")) {
			pos++
			const inner = parseUnary()
			return (x) => -inner(x)
		}
		if (isOp("+")) {
			pos++
			return parseUnary()
		}
		return parsePower()
	}

	function parsePower(): Node {
		const base = parseAtom()
		if (isOp("^")) {
			pos++
			const exponent = parseUnary() // right associative, -x allowed in the exponent
			return (x) => Math.pow(base(x), exponent(x))
		}
		return base
	}

	function parseAtom(): Node {
		const t = tokens[pos++]
		if (!t) throw new Error("The formula ends too early")
		if (t.type == "num") {
			const value = t.value
			return () => value
		}
		if (t.type == "op" && t.op == "(") {
			const inner = parseSum()
			if (!isOp(")")) throw new Error('Missing ")"')
			pos++
			return inner
		}
		if (t.type == "id") {
			const name = t.name.toLowerCase()
			if (isOp("(") && name in functions) {
				pos++
				const args: Node[] = []
				if (!isOp(")")) {
					args.push(parseSum())
					while (isOp(",")) {
						pos++
						args.push(parseSum())
					}
				}
				if (!isOp(")")) throw new Error('Missing ")"')
				pos++
				const fn = functions[name]
				return (x) => fn(...args.map((arg) => arg(x)))
			}
			if (name == "x") return (x) => x
			if (name in constants) {
				const value = constants[name]
				return () => value
			}
			throw new Error(`Unknown name "${t.name}"`)
		}
		throw new Error(`Unexpected "${(t as any).op}"`)
	}

	const root = parseSum()
	if (pos < tokens.length)
		throw new Error(
			`Unexpected "${(tokens[pos] as any).op ?? (tokens[pos] as any).name ?? (tokens[pos] as any).value}"`
		)
	return root
}

/** the points (x, f(x)) of the formula; points where f is not a finite number are left out (they interrupt the curve: null) */
export function sampleFormula(
	text: string,
	from: number,
	to: number,
	samples: number,
	logX = false
): ([number, number] | null)[] {
	const f = compileExpression(text)
	const points: ([number, number] | null)[] = []
	const n = Math.max(2, Math.round(samples))
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1)
		const x = logX && from > 0 && to > 0 ? from * Math.pow(to / from, t) : from + (to - from) * t
		const y = f(x)
		points.push(Number.isFinite(y) ? [x, y] : null)
	}
	return points
}
