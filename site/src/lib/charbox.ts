import type { HighlightHastOptions } from "fumadocs-core/highlight";

// Shiki's theme type, as Fumadocs' highlighter takes it.
type Theme = Exclude<
	Extract<HighlightHastOptions, { theme: unknown }>["theme"],
	string
>;

// Charbox, the maintainer's Zed theme (https://github.com/monarcode/charbox-zed,
// MIT), as a Shiki theme for the site's code. Zed colours code by tree-sitter
// capture and Shiki by TextMate scope, so each rule below maps a Charbox
// capture onto the scopes that TypeScript, TSX, JSON and shell grammars use
// for it. Only the syntax colours come over: code sits on the site's ink.

const fg = "#ebdbb2";
const muted = "#a89984";
const red = "#fb4934";
const green = "#b8bb26";
const yellow = "#fabd2f";
const blue = "#83a598";
const purple = "#d3869b";
const aqua = "#8ec07c";
const orange = "#fe8019";
const delimiter = "#d5c4a1";
const doc = "#bdae93";

export const charbox: Theme = {
	name: "charbox",
	type: "dark",
	colors: {
		// Transparent: Shiki writes it inline, over the site's own ground.
		"editor.background": "#00000000",
		"editor.foreground": fg,
	},
	tokenColors: [
		{ settings: { foreground: fg } },
		// comment, comment.doc
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: muted },
		},
		{
			scope: [
				"comment.block.documentation",
				"comment.block.documentation punctuation.definition.comment",
			],
			settings: { foreground: doc },
		},
		// variable: identifiers, and the names a declaration binds
		{
			scope: [
				"variable",
				"variable.other.readwrite",
				"variable.other.constant",
				"variable.other.object",
				"entity.name.type.module",
				"support.variable",
			],
			settings: { foreground: blue },
		},
		// variable.parameter
		{
			scope: ["variable.parameter", "meta.parameters variable"],
			settings: { foreground: orange, fontStyle: "italic" },
		},
		// variable.special: this, super
		{
			scope: ["variable.language"],
			settings: { foreground: purple, fontStyle: "italic" },
		},
		// property, variable.member, and the fields of a type
		{
			scope: [
				"variable.other.property",
				"variable.other.object.property",
				"variable.object.property",
				"meta.object-literal.key",
				"support.variable.property",
				"support.type.property-name",
				"meta.object.member",
			],
			settings: { foreground: fg },
		},
		// keyword
		{
			scope: [
				"keyword",
				"keyword.control",
				"keyword.operator.new",
				"keyword.operator.expression",
				"keyword.operator.word",
				"storage",
				"storage.type",
				"storage.modifier",
			],
			settings: { foreground: red },
		},
		// operator, including the arrow
		{
			scope: [
				"keyword.operator",
				"storage.type.function.arrow",
				"keyword.operator.type.annotation",
			],
			settings: { foreground: aqua },
		},
		// function, and method calls
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call entity.name.function",
				"entity.name.command",
			],
			settings: { foreground: green },
		},
		// function.builtin
		{ scope: ["support.function.builtin"], settings: { foreground: red } },
		// type, type.builtin, type.interface
		{
			scope: [
				"entity.name.type",
				"support.type",
				"support.type.primitive",
				"support.class",
				"entity.other.inherited-class",
			],
			settings: { foreground: yellow },
		},
		// constant
		{
			scope: ["constant", "variable.other.enummember"],
			settings: { foreground: yellow },
		},
		// boolean, constant.builtin
		{ scope: ["constant.language"], settings: { foreground: purple } },
		// number
		{ scope: ["constant.numeric"], settings: { foreground: purple } },
		// string
		{
			scope: [
				"string",
				"punctuation.definition.string",
				"string.unquoted.argument",
			],
			settings: { foreground: green },
		},
		// string.escape
		{ scope: ["constant.character.escape"], settings: { foreground: doc } },
		// string.regex
		{ scope: ["string.regexp"], settings: { foreground: orange } },
		// punctuation.bracket
		{
			scope: [
				"meta.brace",
				"punctuation.definition.block",
				"punctuation.definition.parameters",
				"punctuation.definition.typeparameters",
				"punctuation.definition.binding-pattern",
				"punctuation.definition.dictionary",
				"punctuation.definition.array",
				"punctuation.section",
			],
			settings: { foreground: muted },
		},
		// punctuation.delimiter
		{
			scope: [
				"punctuation.separator",
				"punctuation.terminator",
				"punctuation.accessor",
			],
			settings: { foreground: delimiter },
		},
		// punctuation.special: template expressions and JSX braces
		{
			scope: [
				"punctuation.definition.template-expression",
				"punctuation.section.embedded",
			],
			settings: { foreground: delimiter },
		},
		// tag: JSX elements, and their brackets
		{
			scope: [
				"entity.name.tag",
				"support.class.component",
				"punctuation.definition.tag",
			],
			settings: { foreground: aqua },
		},
		// attribute
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: blue },
		},
		// shell flags read as constants in Zed
		{ scope: ["constant.other.option"], settings: { foreground: yellow } },
	],
};
