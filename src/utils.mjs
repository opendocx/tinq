import { AST } from "./ast.mjs";

/**
 * Creates a new object without a prototype. This object is useful for lookup without having to
 * guard against prototypically inherited properties via hasOwnProperty.
 *
 * Related micro-benchmarks:
 * - http://jsperf.com/object-create2
 * - http://jsperf.com/proto-map-lookup/2
 * - http://jsperf.com/for-in-vs-object-keys2
 *
 * @returns {Object}
 */
export function createMap () {
	return Object.create(null)
}

/**
 * Determines if a reference is defined.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is defined.
 */
export function isDefined (value) {
	return typeof value !== "undefined"
}

/**
 * Determines if a reference is an `Object`. Unlike `typeof` in JavaScript, `null`s are not
 * considered to be objects. Note that JavaScript arrays are objects.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is an `Object` but not `null`.
 */
export function isObject(value) {
	// http://jsperf.com/isobject4
	return value !== null && typeof value === "object"
}

/**
 * Determine if a value is an object with a null prototype
 *
 * @returns {boolean} True if `value` is an `Object` with a null prototype
 */
export function isBlankObject(value) {
	return value !== null && typeof value === "object" && !getPrototypeOf(value)
}

/**
 * Determines if a reference is a `String`.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `String`.
 */
export function isString(value) {
	return typeof value === "string"
}

/**
 * Determines if a reference is a `Number`.
 *
 * This includes the "special" numbers `NaN`, `+Infinity` and `-Infinity`.
 *
 * If you wish to exclude these then you can use the native
 * [`isFinite'](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/isFinite)
 * method.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `Number`.
 */
export function isNumber(value) {
	return typeof value === "number"
}

/**
 * Determines if a value is a date.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `Date`.
 */
export function isDate(value) {
	return toString.call(value) === "[object Date]"
}

/**
 * Determines if a reference is a `Function`.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `Function`.
 */
export function isFunction(value) {
	return typeof value === "function"
}

/**
 * Determines if a value is a regular expression object.
 *
 * @private
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `RegExp`.
 */
function isRegExp(value) {
	return toString.call(value) === "[object RegExp]";
}

export function lowercase (string) {
	return isString(string) ? string.toLowerCase() : string
}

export function uppercase (string) {
	return isString(string) ? string.toUpperCase() : string
}

export function getStringValue(name) {
	// Property names must be strings. This means that non-string objects cannot be used
	// as keys in an object. Any non-string object, including a number, is typecasted
	// into a string via the toString method.
	// -- MDN, https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Operators/Property_accessors#Property_names
	//
	// So, to ensure that we are checking the same `name` that JavaScript would use, we cast it
	// to a string. It's not always possible. If `name` is an object and its `toString` method is
	// 'broken' (doesn't return a string, isn't a function, etc.), an error will be thrown:
	//
	// TypeError: Cannot convert object to primitive value
	//
	// For performance reasons, we don't catch this error here and allow it to propagate up the call
	// stack. Note that you'll get the same error in JavaScript if you try to access a property using
	// such a 'broken' object as a key.
	return name + "";
}

export function ifDefined (v, d) {
	return typeof v !== "undefined" ? v : d
}

export function plusFn (l, r) {
	if (typeof l === "undefined") return r
	if (typeof r === "undefined") return l
	return l + r
}

export function isStateless ($filter, filterName) {
	const fn = $filter(filterName)
	return !fn.$stateful
}

export function findConstantExpressions (ast, $filter) {
	let allConstants
	// let argsToWatch
	switch (ast.type) {
		case AST.Program:
		case AST.TemplateBlock:
			allConstants = true
      ast.body.forEach(elem => {
				findConstantExpressions(elem, $filter)
				allConstants = allConstants && elem.constant
			})
			ast.constant = allConstants
			break
		case AST.ListField:
			findConstantExpressions(ast.expression, $filter)
			findConstantExpressions(ast.content, $filter)
			ast.constant = ast.expression.constant && ast.content.constant
			break
		case AST.ContentField:
			findConstantExpressions(ast.expression, $filter)
			ast.constant = ast.expression.constant
			break
		case AST.TemplateElement:
		case AST.Literal:
			ast.constant = true
			//ast.toWatch = []
			break
		case AST.UnaryExpression:
			findConstantExpressions(ast.argument, $filter)
			ast.constant = ast.argument.constant
			//ast.toWatch = ast.argument.toWatch
			break
		case AST.BinaryExpression:
			findConstantExpressions(ast.left, $filter)
			findConstantExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			//ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch)
			break
		case AST.LogicalExpression:
			findConstantExpressions(ast.left, $filter)
			findConstantExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.ConditionalField:
			findConstantExpressions(ast.test, $filter)
			findConstantExpressions(ast.consequent, $filter)
			ast.constant = ast.test.constant && ast.consequent.constant
			if (ast.alternate) { // can be null for AST.ConditionalField!
				findConstantExpressions(ast.alternate, $filter)
				ast.constant &&= ast.alternate.constant
			}
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.ConditionalExpression:
			findConstantExpressions(ast.test, $filter)
			findConstantExpressions(ast.consequent, $filter)
			findConstantExpressions(ast.alternate, $filter)
			ast.constant = ast.test.constant && ast.consequent.constant && ast.alternate.constant
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.Identifier:
			ast.constant = false
			//ast.toWatch = [ast]
			break
		case AST.MemberExpression:
			findConstantExpressions(ast.object, $filter)
			if (ast.computed) {
				findConstantExpressions(ast.property, $filter)
			}
			ast.constant = ast.object.constant && (!ast.computed || ast.property.constant)
			//ast.toWatch = [ast]
			break
		case AST.CallExpression:
			ast.arguments.forEach(expr => {
				findConstantExpressions(expr, $filter)
			})
			ast.constant = false
			//ast.toWatch = [ast]
			break
		case AST.FilterExpression:
			//argsToWatch = []
			findConstantExpressions(ast.input, $filter)
			//if (!ast.input.constant) {
			//	argsToWatch.push.apply(argsToWatch, ast.input.toWatch)
			//}
			allConstants = true
			ast.arguments.forEach(expr => {
				findConstantExpressions(expr, $filter)
				allConstants = allConstants && expr.constant
				//if (!expr.constant) {
				//	argsToWatch.push.apply(argsToWatch, expr.toWatch)
				//}
			})
			ast.constant = allConstants
			//ast.toWatch = argsToWatch
			break
		case AST.LambdaExpression:
			findConstantExpressions(ast.expression, $filter)
			ast.constant = ast.expression.constant
			//ast.toWatch = ast.expression.toWatch
			break
		case AST.SortKeyExpression:
			findConstantExpressions(ast.key, $filter)
			ast.constant = ast.key.constant
			//ast.toWatch = ast.key.toWatch
			break
		case AST.AssignmentExpression:
			findConstantExpressions(ast.left, $filter)
			findConstantExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			//ast.toWatch = [ast]
			break
		case AST.ArrayExpression:
			allConstants = true
			//argsToWatch = []
      ast.elements.forEach(expr => {
				findConstantExpressions(expr, $filter)
				allConstants = allConstants && expr.constant
				//if (!expr.constant) {
				//	argsToWatch.push.apply(argsToWatch, expr.toWatch)
				//}
			})
			ast.constant = allConstants
			//ast.toWatch = argsToWatch
			break
		case AST.ObjectExpression:
			allConstants = true
			//argsToWatch = []
      ast.properties.forEach(property => {
				findConstantExpressions(property.value, $filter)
				allConstants = allConstants && property.value.constant && !property.computed
				//if (!property.value.constant) {
				//	argsToWatch.push.apply(argsToWatch, property.value.toWatch)
				//}
			})
			ast.constant = allConstants
			//ast.toWatch = argsToWatch
			break
		case AST.ThisExpression:
			ast.constant = false
			//ast.toWatch = []
			break
		case AST.LocalsExpression:
			ast.constant = false
			//ast.toWatch = []
			break
	}
}

/**
 * A function that performs no operations. This function can be useful when writing code in the
 * functional style.
   ```js
     function foo(callback) {
       var result = calculateResult();
       (callback || noop)(result);
     }
   ```
 */
export function noop() {}

export function getInputs (body) {
	if (body.length !== 1) return
	const lastExpression = body[0].expression
	const candidate = lastExpression.toWatch
	if (candidate.length !== 1) return candidate
	return candidate[0] !== lastExpression ? candidate : undefined
}

export function isConstant (ast) {
	return ast.constant
}

export function isLiteral (ast) {
	return ast.type === AST.Program
		? (
			ast.body.length === 0 ||
			(ast.body.length === 1 && ast.body[0].type === AST.TemplateElement)
		)
		: (
			ast.type === AST.Literal ||
			ast.type === AST.ArrayExpression ||
			ast.type === AST.ObjectExpression
		)
}

export function isAssignable (ast) {
	return ast.type === AST.Identifier || ast.type === AST.MemberExpression
}

export function assignableAST (ast) {
	const exprAst = ast && ast.type === AST.Program && ast.body.length === 1
		? ast.body[0].expression
		: ast
	if (exprAst && isAssignable(exprAst)) {
		return {
			type: AST.AssignmentExpression,
			left: exprAst,
			right: { type: AST.NGValueParameter },
			operator: "="
		}
	}
}

export function escapeQuotes (str) {
  // include ampersands so escaping is nestable AND reversable when nested
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function unEscapeQuotes (str) {
  return str.replace(/&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
