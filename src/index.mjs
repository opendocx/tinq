import { createMap } from './utils.mjs';
import { Lexer } from './lexer.mjs'
import { Parser } from './parser.mjs';

export { Lexer, Parser }

const parserOptions = {
	csp: false, // csp == true uses interpreter instead of compiler
	expensiveChecks: true,
	includeLocation: true,
	literals: {
		true: true,
		false: false,
		null: null,
		undefined: undefined,
	}
	//isIdentifierStart: undefined, //isFunction(identStart) && identStart,
	//isIdentifierContinue: undefined //isFunction(identContinue) && identContinue
};
const lexerOptions = {}

var lexer = new Lexer(lexerOptions);
var parser = new Parser(lexer, parserOptions)

/**
 * Compiles src and returns a function that executes src on a target object.
 * The compiled function is cached under compile.cache[src] to speed up further calls.
 *
 * @param {string} src
 * @returns {function}
 */
export function compile(src) {
	if (typeof src !== "string") {
		throw new TypeError(
			"src must be a string, instead saw '" + typeof src + "'"
		);
	}

	if (!compile.cache) {
		return parser.parse(src);
	}

	let cached = compile.cache[src];
	if (!cached) {
		cached = compile.cache[src] = parser.parse(src);
	}

	return cached;
}

/**
 * A cache containing all compiled functions. The src is used as key.
 * Set this to false to disable the cache.
 *
 * @type {object}
 */
compile.cache = createMap()
