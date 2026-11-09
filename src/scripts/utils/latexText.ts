import { MathjaxParser } from "../internal"

const latexEscapes: Record<string, string> = {
	"#": "\\#",
	"%": "\\%",
	"&": "\\&",
	"_": "\\_",
	"{": "\\{",
	"}": "\\}",
	"~": "\\textasciitilde{}",
	"^": "\\textasciicircum{}",
	"\\": "\\textbackslash{}",
	"$": "\\$",
}

/** the text of a cell as LaTeX: $...$ stays math, the rest is escaped */
export function cellToLatex(text: string): string {
	const parser = new MathjaxParser()
	return parser
		.parse(text)
		.map((element) =>
			element.type == "text" ?
				element.text.replaceAll(/[#%&_{}~^\\$]/g, (m) => latexEscapes[m])
			:	"$" + element.text + "$"
		)
		.join(" ")
}
