'use strict';

require('node:assert');
var dateFns = require('date-fns');
var numeral = require('numeral');
var numWords = require('number-to-words-en');
var deepEqual = require('fast-deep-equal');
var uuid = require('uuid');

class AST {

}

AST.Identifier = 'Identifier';
AST.Literal = 'Literal';
AST.Program = 'Program'; // a template
AST.TemplateBlock = 'TemplateBlock'; // a sequence of quasis and fields in a template
AST.TemplateElement = 'TemplateElement'; // a chunk of boilerplate content (no fields) in a template
AST.ContentField = 'ContentField'; // a content field in a template
AST.NoOp = 'NoOp'; // no-op statement in a template
AST.ConditionalField = 'ConditionalField'; // an if/elseif/else/endif block in a template
AST.ListField = 'ListField'; // a list/endlist block in a template (properties: expression and content (block))
AST.ThisExpression = 'ThisExpression'; // "this" keyword -- in angular-expression, this represents the "scope"
AST.ArrayExpression = 'ArrayExpression';
AST.ObjectExpression = 'ObjectExpression';
AST.Property = 'Property';
AST.UnaryExpression = 'UnaryExpression';
AST.BinaryExpression = 'BinaryExpression';
AST.LogicalExpression = 'LogicalExpression';
AST.MemberExpression = 'MemberExpression';
AST.ConditionalExpression = 'ConditionalExpression';
AST.CallExpression = 'CallExpression';
AST.AssignmentExpression = 'AssignmentExpression';
// also includes some custom/proprietary node types:
AST.FilterExpression = 'FilterExpression'; // properties: input (node), filter (ident), arguments (node array)
AST.LambdaExpression = 'LambdaExpression'; // list filter argument -- properties: expression (node)
AST.SortKeyExpression = 'SortKeyExpression'; // sort filter argument -- properties: key (node), descending (bool)
// static methods
AST.serialize = serializeAstNode;
// AST.mutateInPlace = astMutateInPlace
// Internal use only
AST.NGValueParameter = 'NGValueParameter';

// Some serialization logic adapted from AString
// https://github.com/davidbonnet/astring/blob/master/src/astring.js

const OPERATOR_PRECEDENCE = {
  '||': 3,
  '&&': 4,
  '==': 8,
  '!=': 8,
  '===': 8,
  '!==': 8,
  '<': 9,
  '>': 9,
  '<=': 9,
  '>=': 9,
  '+': 11,
  '-': 11,
  '*': 12,
  '%': 12,
  '/': 12
};

// Enables parenthesis regardless of precedence
const NEEDS_PARENTHESES = 18;

const EXPRESSIONS_PRECEDENCE = {
  // Definitions
  [AST.ArrayExpression]: 21,
  [AST.ThisExpression]: 21,
  [AST.Identifier]: 21,
  // Operations
  [AST.MemberExpression]: 20,
  [AST.CallExpression]: 20,
  // Other definitions
  [AST.Literal]: 19,
  [AST.ObjectExpression]: NEEDS_PARENTHESES,
  // Other operations
  [AST.UnaryExpression]: 17,
	[AST.SortKeyExpression]: 17,
  [AST.BinaryExpression]: 14,
  [AST.LogicalExpression]: 12,
  [AST.ConditionalExpression]: 4,
  CommaOrSequence: 1,
  [AST.Property]: 1,
	[AST.LambdaExpression]: 1,
  [AST.FilterExpression]: 0,
};

// function astMutateInPlace (node, mutator) {
//   var nodeModified = mutator(node)
//   switch (node.type) {
//     case AST.Program:
//       return nodeModified | node.body.reduce(
//         (accumulator, statementObj) => (accumulator |= astMutateInPlace(statementObj, mutator)),
//         false
//       )
//     case AST.ContentField:
//       return nodeModified | astMutateInPlace(node.expression, mutator)
//     case AST.Literal:
//     case AST.Identifier:
//     case AST.ThisExpression:
//       return nodeModified
//     case AST.MemberExpression:
//       return nodeModified | astMutateInPlace(node.object, mutator) | astMutateInPlace(node.property, mutator)
//     case AST.CallExpression:
//       return nodeModified | astMutateInPlace(node.callee, mutator) | node.arguments.reduce(
//         (accumulator, argObj) => (accumulator |= astMutateInPlace(argObj, mutator)),
//         false
//       )
//     case AST.FilterExpression:
//       return nodeModified | astMutateInPlace(node.filter, mutator)
//         | astMutateInPlace(node.input, mutator) | node.arguments.reduce(
//         (accumulator, argObj) => (accumulator |= astMutateInPlace(argObj, mutator)),
//         false
//       )
// 		case AST.LambdaExpression:
// 			return nodeModified | astMutateInPlace(node.expression, mutator)
// 		case AST.SortKeyExpression:
// 			return nodeModified | astMutateInPlace(node.key, mutator)
// 		case AST.ArrayExpression:
//       return nodeModified | node.elements.reduce(
//         (accumulator, elem) => (accumulator |= astMutateInPlace(elem, mutator)),
//         false
//       )
//     case AST.ObjectExpression:
//       return nodeModified | node.properties.reduce(
//         (accumulator, prop) => (accumulator |= astMutateInPlace(prop, mutator)),
//         false
//       )
//     case AST.Property:
//       return nodeModified | astMutateInPlace(node.key, mutator) | astMutateInPlace(node.value, mutator)
//     case AST.BinaryExpression:
//     case AST.LogicalExpression:
//       return nodeModified | astMutateInPlace(node.left, mutator) | astMutateInPlace(node.right, mutator)
//     case AST.UnaryExpression:
//       return nodeModified | astMutateInPlace(node.argument, mutator)
//     case AST.ConditionalExpression:
//       return nodeModified | astMutateInPlace(node.test, mutator) | astMutateInPlace(node.consequent, mutator)
//         | astMutateInPlace(node.alternate, mutator)
//     default:
//       return false
//   }
// }

function getExpressionPrecedence (node) {
	if (node.type === AST.LambdaExpression)
			return EXPRESSIONS_PRECEDENCE[node.expression.type]
	// else
  return EXPRESSIONS_PRECEDENCE[node.type]
}

function expressionNeedsParentheses (node, parentNode, isRightHand) {
  const nodePrecedence = getExpressionPrecedence(node);
  if (nodePrecedence === NEEDS_PARENTHESES) {
    return true
  }
  const parentNodePrecedence = getExpressionPrecedence(parentNode);
  if (nodePrecedence !== parentNodePrecedence) {
    // Different node types
    return nodePrecedence < parentNodePrecedence
  }
  if (nodePrecedence !== EXPRESSIONS_PRECEDENCE.LogicalExpression
    && nodePrecedence !== EXPRESSIONS_PRECEDENCE.BinaryExpression) {
    return false
  }
  if (isRightHand) {
    // Parenthesis are used if both operators have the same precedence
    return (OPERATOR_PRECEDENCE[node.operator] <= OPERATOR_PRECEDENCE[parentNode.operator])
  }
  return (OPERATOR_PRECEDENCE[node.operator] < OPERATOR_PRECEDENCE[parentNode.operator])
}

function serializeOptionallyWrapped (node, subs, maxPrecedence, orEqual = false) {
  const wrap = orEqual
    ? (getExpressionPrecedence(node) <= maxPrecedence)
    : (getExpressionPrecedence(node) < maxPrecedence);
  return (wrap || node.endGroup) ? ('(' + serializeAstNode(node, subs) + ')') : serializeAstNode(node, subs)
}

function serializeFilterArg (argNode, rtl) {
	getExpressionPrecedence(argNode);
	const filterPrecedence = EXPRESSIONS_PRECEDENCE[AST.FilterExpression]; // getExpressionPrecedence(filterNode)
	if (rtl) { // right-to-left precedence by default for this filter
		// so if arg is also a filter, DON'T wrap it in parens
		return serializeAstNode(argNode)
	} else { // normal/default left-to-right precedence
		// otherwise, if arg is a filter, it WILL need to be wrapped in parens
		return serializeOptionallyWrapped(argNode, false, filterPrecedence, true)
	}
}

function serializeBinaryExpressionPart (node, parentNode, isRightHand, subs) {
  /*
    serializes a left-hand or right-hand expression `node`
    from a binary expression applying the provided `operator`.
    The `isRightHand` parameter should be `true` if the `node` is a right-hand argument.
  */
  const result = serializeAstNode(node, subs);
  return expressionNeedsParentheses(node, parentNode, isRightHand) ? `(${result})` : result
}

function serializeAstNode (ast, subs = false, isElseIf = false) {
  if (ast === null) return ''
  switch (ast.type) {
    case AST.Program:
		case AST.TemplateBlock:
			return ast.body.map(statement => serializeAstNode(statement, subs)).join(ast.joiner || '')
		case AST.TemplateElement:
			return (ast.value && ast.value.raw) || ast.value
    case AST.ContentField:
      return '{[' + serializeAstNode(ast.expression, subs) + ']}'
		case AST.ConditionalField: {
			return (isElseIf ? '{[elseif ' : '{[if ')
				+ serializeAstNode(ast.test, subs) + ']}'
			  + serializeAstNode(ast.consequent, subs)
				+ ast.alternate
				  ? ast.alternate.type === AST.ConditionalField
					  ? '{[elseif ' + serializeAstNode(ast.alternate.test, subs) + ']}' + serializeAstNode(ast.alternate.consequent)
						: '{[else]}' + serializeAstNode(ast.alternate, subs) + '{[endif]}'
					: '{[endif]}'
		}
    case AST.Literal:
      if (typeof ast.value === 'string') { return '"' + ast.value + '"' }
      if (ast.value === null) { return 'null' }
      return ast.value.toString()
    case AST.Identifier:
      return ast.name
    case AST.MemberExpression:
      return serializeOptionallyWrapped(ast.object, subs, EXPRESSIONS_PRECEDENCE.MemberExpression) + (
        ast.computed
          ? ('[' + serializeAstNode(ast.property, subs) + ']')
          : ('.' + serializeAstNode(ast.property, subs))
      )
    case AST.CallExpression:
			return serializeAstNode(ast.callee, subs) + '('
				+ ast.arguments.map(
					argObj => serializeOptionallyWrapped(argObj, subs, EXPRESSIONS_PRECEDENCE.CommaOrSequence)
				).join(',') + ')'
    case AST.FilterExpression:
      return (
        serializeOptionallyWrapped(ast.input, subs, EXPRESSIONS_PRECEDENCE.FilterExpression)
        + '|' + serializeAstNode(ast.filter, subs)
        + ast.arguments.map(arg =>
          ':' + serializeFilterArg(arg, ast.rtl) // serializeOptionallyWrapped(arg, subs, EXPRESSIONS_PRECEDENCE.FilterExpression)
        ).join('')
      )
		case AST.LambdaExpression:
			return serializeAstNode(ast.expression) // serializeOptionallyWrapped(ast.expression, subs, EXPRESSIONS_PRECEDENCE.LambdaExpression)
		case AST.SortKeyExpression:
			return (ast.descending ? '-' : '') +  serializeOptionallyWrapped(ast.key, subs, EXPRESSIONS_PRECEDENCE.SortKeyExpression)
		case AST.ArrayExpression:
      return '[' + ast.elements.map(
        elem => serializeOptionallyWrapped(elem, subs, EXPRESSIONS_PRECEDENCE.CommaOrSequence)
      ).join(',') + ']'
    case AST.ObjectExpression:
      return '{' + ast.properties.map(prop => serializeAstNode(prop, subs)).join(',') + '}'
    case AST.Property:
      return (ast.computed ? '[' : '') + serializeAstNode(ast.key, subs)
        + (ast.computed ? ']' : '') + ':'
        + serializeOptionallyWrapped(ast.value, subs, EXPRESSIONS_PRECEDENCE.Property)
    case AST.BinaryExpression:
    case AST.LogicalExpression:
      return serializeBinaryExpressionPart(ast.left, ast, false, subs)
        + ast.operator + serializeBinaryExpressionPart(ast.right, ast, true, subs)
    case AST.UnaryExpression:
      return ast.prefix
        ? ast.operator + serializeOptionallyWrapped(ast.argument, subs, EXPRESSIONS_PRECEDENCE.UnaryExpression)
        : serializeAstNode(ast.argument, subs) + ast.operator
    case AST.ConditionalExpression:
      return (
        serializeOptionallyWrapped(ast.test, subs, EXPRESSIONS_PRECEDENCE.ConditionalExpression, true)
        + '?' + serializeOptionallyWrapped(
          ast.consequent,
          subs,
          EXPRESSIONS_PRECEDENCE.ConditionalExpression
        ) + ':' + serializeOptionallyWrapped(
          ast.alternate,
          subs,
          EXPRESSIONS_PRECEDENCE.ConditionalExpression
        )
      )
    case AST.ThisExpression:
      return 'this'
		case AST.AssignmentExpression:
			return serializeAstNode(ast.left) + '=' + serializeAstNode(ast.right)
    default:
      throw new Error(`Unsupported expression type '${ast.type}'`)
  }
}

const primitiveConstructors$1 = [String, Number, Boolean, Date];

function isPrimitive$1 (value, includeWrapped = true) {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (includeWrapped) {
        if (value && value.constructor && primitiveConstructors$1.includes(value.constructor)) {
          return true
        }
      } else if (value && (value instanceof Date)) {
        return true
      }
  }
  return false
}

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
function createMap () {
	return Object.create(null)
}

/**
 * Determines if a reference is defined.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is defined.
 */
function isDefined (value) {
	return typeof value !== "undefined"
}

/**
 * Determines if a reference is a `String`.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `String`.
 */
function isString(value) {
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
function isNumber (value) {
	return typeof value === "number"
}

/**
 * Determines if a value is a date.
 *
 * @param {*} value Reference to check.
 * @returns {boolean} True if `value` is a `Date`.
 */
function isDate (value) {
	return toString.call(value) === "[object Date]"
}

function isTruthy (value) {
	let bValue;
	if (value && isIterable$1(value)) {
		// checking if a list is empty or not
		if (!YObject.isArray(value)) {
			value = Array.from(value);
		}
		bValue = (value.length > 0); // for purposes of evaluation in yatte, we consider empty lists falsy!
		// (unlike typical JavaScript, where any non-null array, even empty ones, are considered truthy)
	} else {
		bValue = Boolean(value);
	}
	return bValue
}

function isIterable$1 (obj) {
	// checks for null and undefined; also strings (though iterable) should not be iterable *contexts*
	if (obj == null || isPrimitive$1(obj)) {
		return false
	}
	return typeof obj[Symbol.iterator] === 'function'
}

function dateFormat(value) {
	const offset = value.getTimezoneOffset();
	value = new Date(value.getTime() - (offset*60*1000));
	return value.toISOString().slice(0,10)
}

function lowercase (string) {
	return isString(string) ? string.toLowerCase() : string
}

function getStringValue(name) {
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

function ifDefined (v, d) {
	return typeof v !== "undefined" ? v : d
}

function plusFn (l, r) {
	if (typeof l === "undefined") return r
	if (typeof r === "undefined") return l
	return l + r
}

function findConstantExpressions (ast, $filter) {
	let allConstants;
	// let argsToWatch
	switch (ast.type) {
		case AST.Program:
		case AST.TemplateBlock:
			allConstants = true;
      ast.body.forEach(elem => {
				findConstantExpressions(elem);
				allConstants = allConstants && elem.constant;
			});
			ast.constant = allConstants;
			break
		case AST.ListField:
			findConstantExpressions(ast.expression);
			findConstantExpressions(ast.content);
			ast.constant = ast.expression.constant && ast.content.constant;
			break
		case AST.ContentField:
			findConstantExpressions(ast.expression);
			ast.constant = ast.expression.constant;
			break
		case AST.TemplateElement:
		case AST.Literal:
			ast.constant = true;
			//ast.toWatch = []
			break
		case AST.UnaryExpression:
			findConstantExpressions(ast.argument);
			ast.constant = ast.argument.constant;
			//ast.toWatch = ast.argument.toWatch
			break
		case AST.BinaryExpression:
			findConstantExpressions(ast.left);
			findConstantExpressions(ast.right);
			ast.constant = ast.left.constant && ast.right.constant;
			//ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch)
			break
		case AST.LogicalExpression:
			findConstantExpressions(ast.left);
			findConstantExpressions(ast.right);
			ast.constant = ast.left.constant && ast.right.constant;
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.ConditionalField:
			findConstantExpressions(ast.test);
			findConstantExpressions(ast.consequent);
			ast.constant = ast.test.constant && ast.consequent.constant;
			if (ast.alternate) { // can be null for AST.ConditionalField!
				findConstantExpressions(ast.alternate);
				ast.constant &&= ast.alternate.constant;
			}
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.ConditionalExpression:
			findConstantExpressions(ast.test);
			findConstantExpressions(ast.consequent);
			findConstantExpressions(ast.alternate);
			ast.constant = ast.test.constant && ast.consequent.constant && ast.alternate.constant;
			//ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.Identifier:
			ast.constant = false;
			//ast.toWatch = [ast]
			break
		case AST.MemberExpression:
			findConstantExpressions(ast.object);
			if (ast.computed) {
				findConstantExpressions(ast.property);
			}
			ast.constant = ast.object.constant && (!ast.computed || ast.property.constant);
			//ast.toWatch = [ast]
			break
		case AST.CallExpression:
			ast.arguments.forEach(expr => {
				findConstantExpressions(expr);
			});
			ast.constant = false;
			//ast.toWatch = [ast]
			break
		case AST.FilterExpression:
			//argsToWatch = []
			findConstantExpressions(ast.input);
			//if (!ast.input.constant) {
			//	argsToWatch.push.apply(argsToWatch, ast.input.toWatch)
			//}
			allConstants = true;
			ast.arguments.forEach(expr => {
				findConstantExpressions(expr);
				allConstants = allConstants && expr.constant;
				//if (!expr.constant) {
				//	argsToWatch.push.apply(argsToWatch, expr.toWatch)
				//}
			});
			ast.constant = allConstants;
			//ast.toWatch = argsToWatch
			break
		case AST.LambdaExpression:
			findConstantExpressions(ast.expression);
			ast.constant = ast.expression.constant;
			//ast.toWatch = ast.expression.toWatch
			break
		case AST.SortKeyExpression:
			findConstantExpressions(ast.key);
			ast.constant = ast.key.constant;
			//ast.toWatch = ast.key.toWatch
			break
		case AST.AssignmentExpression:
			findConstantExpressions(ast.left);
			findConstantExpressions(ast.right);
			ast.constant = ast.left.constant && ast.right.constant;
			//ast.toWatch = [ast]
			break
		case AST.ArrayExpression:
			allConstants = true;
			//argsToWatch = []
      ast.elements.forEach(expr => {
				findConstantExpressions(expr);
				allConstants = allConstants && expr.constant;
				//if (!expr.constant) {
				//	argsToWatch.push.apply(argsToWatch, expr.toWatch)
				//}
			});
			ast.constant = allConstants;
			//ast.toWatch = argsToWatch
			break
		case AST.ObjectExpression:
			allConstants = true;
			//argsToWatch = []
      ast.properties.forEach(property => {
				findConstantExpressions(property.value);
				allConstants = allConstants && property.value.constant && !property.computed;
				//if (!property.value.constant) {
				//	argsToWatch.push.apply(argsToWatch, property.value.toWatch)
				//}
			});
			ast.constant = allConstants;
			//ast.toWatch = argsToWatch
			break
		case AST.ThisExpression:
			ast.constant = false;
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
function noop() {}

function isConstant (ast) {
	return ast.constant
}

function isLiteral (ast) {
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

function isAssignable (ast) {
	return ast.type === AST.Identifier || ast.type === AST.MemberExpression
}

const RAW = "RAW";
const TEXT = "TEXT";
const JSON$1 = "JSON"; // chunking has already been done externally and is serialized to JSON

const ChunkMode = { RAW, TEXT, JSON: JSON$1 }; // future: MARKDOWN, maybe also TEXT, HTML, XML, or TAGGED

class TemplateLexer {
  constructor (options) {
    this.options = options;
    this.reset();
  }

  reset () {
    this.text = '';
    this.index = 0;
    this.fieldNum = 0;
    this.tokens = [];
  }

  /**
   * The template lexer is what tokenizes a template, which means it turns a template
   * into a flat array structure enumerating the (numbered) fields in the template and
   * the content OUTSIDE/between fields (if present).
   * If the document includes different logical levels (sections, paragraphs, etc.),
   * nested arrays will indicate this level structure.
   */
  lex (text, mode = ChunkMode.RAW) {
    this.reset();
    if (typeof text === 'string') {
      if (mode === ChunkMode.RAW) {
        this.lexRawChunk(text);
      } else if (mode === ChunkMode.TEXT) {
        this.lexTextChunk(text);
      } else {
        this.chunk(text, mode); // ALWAYS THROWS at this point
        // but in the future we would need a generic way to designate chunks
      }
    } else if (typeof text === 'object') {
      if (mode !== ChunkMode.JSON) {
        throw new Error(`Invalid chunk mode '${mode}' -- not expecting JSON`)
      }
      // tokenize already-chunked field json, e.g. from a docx template
      this.lexContentArray(text);
    }
    return this.tokens
  }

  chunk (text, mode = ChunkMode.RAW) {
    throw new Error(`Invalid chunk mode '${mode}'`)
    // other chunk modes will have different rules for how things get recursively chunked.
    // For example, if we were chunking in "Markdown" mode, we might utilize a markdown parser
    // first to parse the markdown, and then chunk it according to markdown entities such as
    // paragraphs, list items, table cells, etc.  The idea is that the lexer uses these "chunks"
    // to add PushLevel and PopLevel tokens to the token stream, and the parser later uses these tokens
    // to enforce particular rules about what kinds of fields are allowed or required to be
    // at the same level/matched in the same chunk as other fields. (if/endif, list/endlist matching)
  }

  lexRawChunk (chunk) {
    const matches = chunk.matchAll(_fieldsRE);
    for (const match of matches) {
      // insert quasi token to represent content before that field, advance this.index past quasi
      if (match.index > this.index) {
        this.quasiToken(chunk.slice(this.index, match.index));
        this.index = match.index;
      }
      // insert field token to represent field, advance this.index past field
      this.fieldToken(match[1]);
      this.index += match[0].length;
    }
    // insert quasi token to represent content from this.index to end of chunk, advance this.index
    if (chunk.length > this.index) {
      this.quasiToken(chunk.slice(this.index, chunk.length));
      this.index = chunk.length;
    }
  }

  lexTextChunk (chunk) {
    let match;
    while ((match = _fieldsRE.exec(chunk)) !== null) {
      // take note of whether field is at the beginning of a line or not
      let bol = false;
      let eol = false;
      if (match.index === this.index) {
        bol = true;
      } else if (chunk.charAt(match.index - 1) === '\n') {
        bol = true;
      }
      // take note of whether the field is followed by a line break or not
      if (_fieldsRE.lastIndex < chunk.length && chunk.charAt(_fieldsRE.lastIndex) === '\n') {
        eol = true;
      }
      // insert quasi token to represent content before the field, advance this.index past quasi
      if (match.index > this.index) {
        this.quasiToken(chunk.slice(this.index, match.index));
        this.index = match.index;
      }
      // insert field token to represent field, advance this.index past field
      this.fieldToken(match[1], undefined, bol && eol);
      this.index += match[0].length;
      if (bol && eol && this.index < chunk.length) { // if field is alone on line, it consumes the line break after it
        this.index++;
        _fieldsRE.lastIndex++;
      }
    }
    // insert quasi token to represent content from this.index to end of chunk, advance this.index
    if (chunk.length > this.index) {
      this.quasiToken(chunk.slice(this.index, chunk.length));
      this.index = chunk.length;
    }
  }

  fieldToken (text, fieldNum = undefined, soloLine = undefined) {
    const newToken = {
      token: 'Field',
      index: this.index,
      text,
    };
    if (numbered(text)) {
      this.fieldNum++;
      if (fieldNum) {
        if (fieldNum.toString() !== this.fieldNum.toString()) {
          debugger
          // throw new Error('unexpected field numbering')
        }
      }
      newToken.fieldNum = fieldNum || this.fieldNum;
    }
    if (soloLine) {
      newToken.soloLine = true;
    }
    this.tokens.push(newToken);
  }

  quasiToken (text) {
    this.tokens.push({
      token: 'Quasi',
      index: this.index,
      text
    });
  }

  lexContentArray (contentArray) {
    // contentArray can be either an array of strings (as from a text template split via regex)
    // or an array of objects with field text and field IDs (as extracted from a DOCX template)
    // In the latter case (array of objects), sub-arrays indicate discreet blocks of content
    // (paragraphs, table cells, etc.)??
    for (const item of contentArray) {
      this.lexContentItem(item);
    }
  }

  lexContentItem (contentItem) {
    if (Array.isArray(contentItem)) {
      // if there's a sub-array, that item must be its own valid sequence of fields
      // with appropriately matched ifs/endifs and/or lists/endlists
      this.fieldToken('level');
      this.lexContentArray(contentItem);
      this.fieldToken('endlevel');
    } else {
      this.lexToken(contentItem);
    }
  }

  lexToken (contentArrayItem) {
    if (typeof contentArrayItem === 'string') {
      if (contentArrayItem) { // ignore empty strings
        const content = getFieldContent$1(contentArrayItem);
        if (content) { // it's a field
          this.fieldToken(content);
        } else { // not a field means it's static text
          this.quasiToken(contentArrayItem);
        }
      }
    } else { // field object, e.g. extracted from DOCX
      this.fieldToken(contentArrayItem.content, contentArrayItem.id);
    }
  }

}

const _fieldsRE = /\{\[(.*?)\]\}/g;
const _curlyquotes = /[“”]/g;
const _zws = /[\u{200B}\u{200C}]/gu;

function getFieldContent$1 (text) {
  if (text.slice(0, 1) === '[' && text.slice(-1) === ']') {
    return text.slice(1, -1).replace(_curlyquotes, '"').replace(_zws, '')
  }
  return null
}

const UNNUMBERED = ['level', 'endlevel', '_punc'];
function numbered (text) {
  return !UNNUMBERED.includes(text)
}

class TemplateParser {
  constructor (exprParser, options = {}) {
    this.lexer = new TemplateLexer();
    this.exprParser = exprParser;
    this.options = { includeLocation: exprParser.options.includeLocation };
    if (options && ('includeLocation' in options)) {
      this.options.includeLocation = options.includeLocation;
    }
  }

  ast (text) { // top-level asts/programs are reserved for templates
    this.text = text;
    this.tokens = this.lexer.lex(text, ChunkMode.TEXT);

    const value = this.program();

    if (this.tokens.length !== 0) {
      this.throwError("when not expected", this.tokens[0]);
    }

    return value
  }

  addLoc (node, start, end) {
    if (this.options?.includeLocation && typeof start === "number") {
      node.loc = { start: { column: start } };
      if (typeof end === "number") {
        node.loc.end = { column: end };
      }
    }
    return node
  }

  program () {
    const body = this.blockBody();
    return this.addLoc(
      { type: AST.Program, body: body },
      0,
      body && body.length && body[0].loc && body[0].loc.end && body[0].loc.end.column
    )
  }

  templateBlock (body) {
    if (!body) {
      body = this.blockBody();
    }
    return {
      type: AST.TemplateBlock,
      body,
    }
  }

  blockBody () {
    const body = [];
    let ast;
    while ((ast = this.parseBlockElement())) {
      body.push(ast);
    }
    // either we encountered a token that should always end a block (elseif, else, endif, endlist, endlevel)
    // or we are out of tokens
    return body
  }

  levelBlock () {
    if (this.expectField('level')) {
      const body = this.blockBody();
      if (this.expectField('endlevel')) {
        return this.templateBlock(body)
      } else {
        // error
        debugger
      }
    }
  }

  templateElement (text = undefined) {
    let token;
    if (!text) {
      token = this.expect();
    }
    return {
      type: AST.TemplateElement,
      text: text || token.text,
    }
  }

  parseBlockElement () {
    let token = this.peek();
    if (token) {
      if (token.token === 'Quasi') { // consume & return it
        return this.templateElement()
      } else if (token.token === 'Field') {
        let fieldToken;
        if ((fieldToken = this.peekField('if', 'list', 'level'))) {
          if (fieldToken.type === 'if')
            return this.conditionalBlock(false)
          if (fieldToken.type === 'list')
            return this.listBlock()
          // else
          return this.levelBlock()
        }
        if (isTerminalField(token.text)) {
          return false
        }
        // else it must be a content field (the only option left)
        return this.contentField()
      }
    }
    return false
  }

  conditionalBlock (isAlternate = false) {
    // consume if or elseif
    let token, altToken, endToken;
    if ((token = this.expectField(isAlternate ? 'elseif' : 'if'))) {
      // consume block content until we reach the end of a block
      let consequent = this.blockBody();
      let alternate;
      // first check for elseif, then else, then endif:
      let expectEnd = true;
      if (this.peekField('elseif')) {
        alternate = this.conditionalBlock(true);
        expectEnd = false; // the end will have been consumed by the recursion
      } else if ((altToken = this.expectField('else'))) {
        alternate = this.templateBlock();
      }
      if (expectEnd) {
        endToken = this.expectField('endif');
        if (!endToken) {
          this.throwError('when expecting an {[endif]}', this.peek());
        }
      }
      return {
        type: AST.ConditionalField,
        test: this.exprParser.ast(token.content),
        consequent: consequent.length === 1 ? consequent[0] : this.templateBlock(consequent),
        alternate: alternate || null,
        fieldNum: token.fieldNum,
        altFieldNum: altToken ? altToken.fieldNum : undefined,
        endFieldNum: expectEnd ? endToken.fieldNum : undefined,
      }
    }
    return false

    // consume block content until we reach either...
    //    - elseif (in which case we recurse to create a nested conditional field)
    //    - else (in which case we consume and then go until we reach the endif)
    //    - endif (in which case it is consumed and then we finish)
  }

  listBlock () {
    // consume list
    let token, endToken;
    if ((token = this.expectField('list'))) {
      // consume block content until we reach & consume the endlist
      const content = this.templateBlock();
      if ((endToken = this.expectField('endlist'))) {
        this.appendPuncPlaceholder(content.body);
        content.lambda = true;
        return {
          type: AST.ListField,
          expression: this.exprParser.ast(token.content),
          content,
          fieldNum: token.fieldNum,
          endFieldNum: endToken.fieldNum,
        }
      } else {
        this.throwError('when expecting an {[endlist]}', this.peek());
      }
    }
    return false
  }

  appendPuncPlaceholder (body) {
    if (!body.some(elem => elem.type === AST.ContentField
      && elem.expression.type === AST.Identifier
      && elem.expression.name === '_punc'
    )) {
      const last = body.length > 0 && body[body.length - 1];
      if (last && last.type === AST.TemplateElement && last.text.endsWith('\n')) {
        // punc field must be inserted BEFORE last line break -- is a split required?
        if (last.text.length > 1) { // split it -- TODO: make this Windows-text-friendly by supporting \r\n
          last.text = last.text.slice(0,-1);
          body.push(this.templateElement('\n'));
        }
        // insert punc field BEFORE last template element
        body.splice(-1, 0, this.contentField('_punc'));
      } else {
        body.push(this.contentField('_punc'));
      }
    }
  }

  contentField (expr = undefined) {
    let token;
    if (!expr) {
      token = this.expect();
      expr = token.text;
    }
    const result = {
      type: AST.ContentField,
      expression: this.exprParser.ast(expr),
    };
    if (token) {
      if (token.soloLine) {
        // const nextToken = this.peek()
        // if (nextToken.token === 'Quasi') {
        // } else {
        this.tokens.unshift({
          token: 'Quasi',
          index: token.index + token.text.length + 4,
          text: '\n'
        });
        // }
        //result.soloLine = true
      }
      if (token.fieldNum) {
        result.fieldNum = token.fieldNum;
      }
    }
    return result
  }

  // expressionStatement () {
  //   const start = this.tokens[0].index
  //   const expr = this.filterChain()
  //   return this.addLoc({ type: AST.ContentField, expression: expr }, start, expr.loc && expr.loc.end && expr.loc.end.column)
  // }

  throwError (msg, token) {
    throw new Error(`Encountered ${this.describeToken(token)} ${msg}`)
  }

  describeToken (token) {
    let result = '';
    if (!token) {
      result += 'end of template';
    } else {
      let pos = `at character position ${token.index + 1}`;
      if (token.token === 'Field') {
        result += `{[${token.text}]} `;
        if (token.fieldNum) {
          result += `in field ${token.fieldNum} (${pos})`;
        } else {
          result += ` ${pos}`;
        }
      } else if (token.token === 'Quasi') {
        result += `template content '${token.text}' ${pos}`;
      }
    }
    return result
  }

  consume (e1) {
    if (this.tokens.length === 0) {
      throw new Error(`Unexpected end of expression: ${this.text}`)
    }

    const token = this.expect(e1);
    if (!token) {
      this.throwError("is unexpected, expecting [" + e1 + "]", this.peek());
    }
    return token
  }

  peekToken () {
    if (this.tokens.length === 0) {
      throw new Error(`Unexpected end of template: ${this.text}`)
    }
    return this.tokens[0]
  }

  peekField (...names) {
    const token = this.peek();
    if (token && token.token === 'Field') {
      for (const name of names) {
        const content = getFieldContent(name, token.text);
        if (content) {
          token.type = name;
          token.content = content;
          return token
        }
      }
    }
    return false
  }

  peekEndField () {
    return this.peekField('else', 'elseif', 'endif', 'endlist', 'endlevel')
  }

  peek (e1, e2, e3, e4) {
    return this.peekAhead(0, e1, e2, e3, e4)
  }

  peekAhead (i, e1, e2, e3, e4) {
    if (this.tokens.length > i) {
      const token = this.tokens[i];
      const t = token.text;
      if (
        t === e1 ||
        t === e2 ||
        t === e3 ||
        t === e4 ||
        (!e1 && !e2 && !e3 && !e4)
      ) {
        return token
      }
    }
    return false
  }

  expect (e1, e2, e3, e4) {
    const token = this.peek(e1, e2, e3, e4);
    if (token) {
      this.tokens.shift();
      return token
    }
    return false
  }

  expectField (...names) {
    const token = this.peek();
    if (token && token.token === 'Field') {
      for (const name of names) {
        const content = getFieldContent(name, token.text);
        if (content) {
          this.tokens.shift();
          token.type = name;
          token.content = content;
          return token
        }
      }
    }
    return false
  }
}

const _fieldREs = {};

function getFieldContent (name, text) {
  const re = _fieldREs[name] || (_fieldREs[name] = new RegExp('^\\s*' + name + '\\s*(.*)$'));
  const match = re.exec(text);
  if (match !== null) {
    return match[1] || true
  }
  return false
}

function isTerminalField (text) {
  for (const endname of ['else', 'elseif', 'endif', 'endlist', 'endlevel']) {
    if (getFieldContent(endname, text)) {
      return true
    }
  }
  return false
}

const OPERATORS = "+ - * / % === !== == != < > <= >= && || ! = |"
  .split(" ")
  .reduce(
    (operators, operator) => {
      operators[operator] = true;
      return operators
    }, createMap()
  );

const ESCAPE = {
  n: "\n",
  f: "\f",
  r: "\r",
  t: "\t",
  v: "\v",
  "'": "'",
  '"': '"'
};

const defaultLexerOptions = {
	//isIdentifierStart: undefined, //isFunction(identStart) && identStart,
	//isIdentifierContinue: undefined //isFunction(identContinue) && identContinue
};

class Lexer {
  constructor (options = undefined) {
    this.options = options || defaultLexerOptions;
  }

  lex (text) {
		this.text = text;
		this.index = 0;
		this.tokens = [];

		while (this.index < this.text.length) {
			const ch = this.text.charAt(this.index);
			if (ch === '"' || ch === "'") {
				this.readString(ch);
			} else if (
				this.isNumber(ch) ||
				(ch === "." && this.isNumber(this.peek()))
			) {
				this.readNumber();
			} else if (this.isIdentifierStart(this.peekMultichar())) {
				this.readIdent();
			} else if (this.is(ch, "(){}[].,;:?")) {
				this.tokens.push({ index: this.index, text: ch });
				this.index++;
			} else if (this.isWhitespace(ch)) {
				this.index++;
			} else {
				const ch2 = ch + this.peek();
				const ch3 = ch2 + this.peek(2);
				const op1 = OPERATORS[ch];
				const op2 = OPERATORS[ch2];
				const op3 = OPERATORS[ch3];
				if (op1 || op2 || op3) {
					const token = op3 ? ch3 : op2 ? ch2 : ch;
					this.tokens.push({ index: this.index, text: token, operator: true });
					this.index += token.length;
				} else {
					this.throwError(
						"Unexpected next character ",
						this.index,
						this.index + 1
					);
				}
			}
		}
		return this.tokens
  }

  is (ch, chars) {
		return chars.indexOf(ch) !== -1
	}

	peek (i) {
		const num = i || 1;
		return this.index + num < this.text.length
			? this.text.charAt(this.index + num)
			: false
	}

	isNumber (ch) {
		return "0" <= ch && ch <= "9" && typeof ch === "string"
	}

	isWhitespace (ch) {
		return (
			ch === " " ||
			ch === "\r" ||
			ch === "\t" ||
			ch === "\n" ||
			ch === "\v" ||
			ch === "\u00A0"
		)
	}

	isIdentifierStart (ch) {
		return this.options.isIdentifierStart
			? this.options.isIdentifierStart(ch, this.codePointAt(ch))
			: this.isValidIdentifierStart(ch)
	}

	isValidIdentifierStart (ch) {
		return (
			("a" <= ch && ch <= "z") ||
			("A" <= ch && ch <= "Z") ||
			"_" === ch ||
			ch === "$"
		)
	}

	isIdentifierContinue (ch) {
		return this.options.isIdentifierContinue
			? this.options.isIdentifierContinue(ch, this.codePointAt(ch))
			: this.isValidIdentifierContinue(ch)
	}

	isValidIdentifierContinue (ch, cp) {
		return this.isValidIdentifierStart(ch, cp) || this.isNumber(ch)
	}

	codePointAt (ch) {
		if (ch.length === 1) return ch.charCodeAt(0)
		// eslint-disable-next-line no-bitwise
		return (ch.charCodeAt(0) << 10) + ch.charCodeAt(1) - 0x35fdc00
	}

	peekMultichar () {
		const ch = this.text.charAt(this.index);
		const peek = this.peek();
		if (!peek) {
			return ch
		}
		const cp1 = ch.charCodeAt(0);
		const cp2 = peek.charCodeAt(0);
		if (cp1 >= 0xd800 && cp1 <= 0xdbff && cp2 >= 0xdc00 && cp2 <= 0xdfff) {
			return ch + peek
		}
		return ch
	}

	isExpOperator (ch) {
		return ch === "-" || ch === "+" || this.isNumber(ch)
	}

	throwError (error, start, end) {
		end = end || this.index;
		const colStr = isDefined(start)
			? "s " +
			  start +
			  "-" +
			  this.index +
			  " [" +
			  this.text.substring(start, end) +
			  "]"
			: " " + end;
    throw new Error(`Lexer Error: ${error} at column${colStr} in expression [${this.text}].`)
	}

	readNumber () {
		let number = "";
		const start = this.index;
		while (this.index < this.text.length) {
			const ch = lowercase(this.text.charAt(this.index));
			if (ch === "." || this.isNumber(ch)) {
				number += ch;
			} else {
				const peekCh = this.peek();
				if (ch === "e" && this.isExpOperator(peekCh)) {
					number += ch;
				} else if (
					this.isExpOperator(ch) &&
					peekCh &&
					this.isNumber(peekCh) &&
					number.charAt(number.length - 1) === "e"
				) {
					number += ch;
				} else if (
					this.isExpOperator(ch) &&
					(!peekCh || !this.isNumber(peekCh)) &&
					number.charAt(number.length - 1) === "e"
				) {
					this.throwError("Invalid exponent");
				} else {
					break
				}
			}
			this.index++;
		}
		this.tokens.push({
			index: start,
			text: number,
			constant: true,
			value: Number(number)
		});
	}

	readIdent () {
		const start = this.index;
		this.index += this.peekMultichar().length;
		while (this.index < this.text.length) {
			const ch = this.peekMultichar();
			if (!this.isIdentifierContinue(ch)) {
				break
			}
			this.index += ch.length;
		}
		this.tokens.push({
			index: start,
			text: this.text.slice(start, this.index),
			identifier: true
		});
	}

	readString (quote) {
		const start = this.index;
		this.index++;
		let string = "";
		let rawString = quote;
		let escape = false;
		while (this.index < this.text.length) {
			const ch = this.text.charAt(this.index);
			rawString += ch;
			if (escape) {
				if (ch === "u") {
					const hex = this.text.substring(this.index + 1, this.index + 5);
					if (!hex.match(/[\da-f]{4}/i)) {
						this.throwError("Invalid unicode escape [\\u" + hex + "]");
					}
					this.index += 4;
					string += String.fromCharCode(parseInt(hex, 16));
				} else {
					const rep = ESCAPE[ch];
					string = string + (rep || ch);
				}
				escape = false;
			} else if (ch === "\\") {
				escape = true;
			} else if (ch === quote) {
				this.index++;
				this.tokens.push({
					index: start,
					text: rawString,
					constant: true,
					value: string
				});
				return
			} else {
				string += ch;
			}
			this.index++;
		}
		this.throwError("Unterminated quote", start);
	}
}

const defaultParserOptions = {
	includeLocation: false,
	literals: {
		true: true,
		false: false,
		null: null,
		undefined: undefined,
	}
};

class ExpressionParser {
  constructor (getFilter, parserOptions = {}) {
		this.options = { ...defaultParserOptions };
		if (parserOptions) {
			for (const prop of Object.keys(parserOptions)) {
				this.options[prop] = parserOptions[prop];
			}
		}
    this.lexer = new Lexer();
		this.getFilter = getFilter;
    this.selfReferential = {
      this: { type: AST.ThisExpression },
      $locals: { type: AST.ThisExpression } // continue parsing $locals for backcompat with Yatte, but it's same as this
    };
  }

	ast (text) {
		this.text = text;
		this.tokens = this.lexer.lex(text);
		const value = this.tokens.length ? this.filterChain() : null;
		if (this.tokens.length !== 0) {
			this.throwError("is an unexpected token", this.tokens[0]);
		}
		return value
	}

	addLoc (node, start, end) {
		if (this.options.includeLocation && typeof start === "number") {
			node.loc = { start: { column: start } };
			if (typeof end === "number") {
				node.loc.end = { column: end };
			}
		}
		return node
	}

	filterChain () {
		let left = this.expression();
		while (this.expect("|")) {
			left = this.filter(left);
		}
		return left
	}

	expression () {
		return this.assignment() // since an assignment can occur basically anywhere an expression can occur
	}

	lambdaExpression () {
		// const start = this.tokens[0].index
		let result = //this.addLoc(
			{
				type: AST.LambdaExpression,
				expression: this.ternary(),
			};
		//, start)
		return result
	}

	assignment () { // parses bare expressions AND assignments!
		const start = this.tokens[0].index;
		let result = this.ternary();
		if (this.expect("=")) {
			if (!isAssignable(result)) {
				throw new Error("Trying to assign a value to a non l-value")
			}

			result = this.addLoc({
				type: AST.AssignmentExpression,
				left: result,
				right: this.assignment(),
				operator: "="
			}, start);
		}
		return result
	}

	ternary () {
		const start = this.tokens[0].index;
		const test = this.logicalOR();
		let consequent;
		let alternate;
		if (this.expect("?")) {
			consequent = this.expression();
			if (this.consume(":")) {
				alternate = this.expression();
				return this.addLoc({
					type: AST.ConditionalExpression,
					test: test,
					consequent: consequent,
					alternate: alternate,
				}, start)
			}
		}
		return test
	}

	logicalOR () {
		const start = this.tokens[0].index;
		let left = this.logicalAND();
		while (this.expect("||")) {
			left = this.addLoc({
				type: AST.LogicalExpression,
				operator: "||",
				left: left,
				right: this.logicalAND()
			}, start);
		}
		return left
	}

	logicalAND () {
		const start = this.tokens[0].index;
		let left = this.equality();
		while (this.expect("&&")) {
			left = this.addLoc({
				type: AST.LogicalExpression,
				operator: "&&",
				left: left,
				right: this.equality()
			}, start);
		}
		return left
	}

	equality () {
		const start = this.tokens[0].index;
		let left = this.relational();
		let token;
		while ((token = this.expect("==", "!=", "===", "!=="))) {
			left = this.addLoc({
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.relational()
			}, start);
		}
		return left
	}

	relational () {
		let left = this.additive();
		let token;
		while ((token = this.expect("<", ">", "<=", ">="))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.additive()
			};
		}
		return left
	}

	additive () {
		let left = this.multiplicative();
		let token;
		while ((token = this.expect("+", "-"))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.multiplicative()
			};
		}
		return left
	}

	multiplicative () {
		let left = this.unary();
		let token;
		while ((token = this.expect("*", "/", "%"))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.unary()
			};
		}
		return left
	}

	unary () {
		let token;
		if ((token = this.expect("+", "-", "!"))) {
			return {
				type: AST.UnaryExpression,
				operator: token.text,
				prefix: true,
				argument: this.unary()
			}
		} else {
			return this.primary()
		}
	}

	sortKey () {
		const token = this.expect("+", "-");
		return {
			type: AST.SortKeyExpression,
			key: this.primary(),
			descending: Boolean(token && token.text === "-"),
		}
	}

	selfRef () {
		const start = this.tokens[0].index;
		const token = this.consume().text;
		return this.addLoc({ ...this.selfReferential[token] }, start, start + token.length)
	}

	primary () {
		let primary;
		if (this.expect("(")) {
			primary = this.filterChain();
			this.consume(")");
			if (primary.rtl) {
				primary.endGroup = true; // the parentheses override this node's normal RTL behavior
			}
		} else if (this.expect("[")) {
			primary = this.arrayDeclaration();
		} else if (this.expect("{")) {
			primary = this.object();
		} else if (this.selfReferential.hasOwnProperty(this.peek().text)) {
			primary = this.selfRef();
		} else if (this.options.literals.hasOwnProperty(this.peek().text)) {
			primary = {
				type: AST.Literal,
				value: this.options.literals[this.consume().text]
			};
		} else if (this.peek().identifier) {
			primary = this.identifier();
		} else if (this.peek().constant) {
			primary = this.constant();
		} else {
			this.throwError("not a primary expression", this.peek());
		}

		let next;
		while ((next = this.expect("(", "[", "."))) {
			if (next.text === "(") {
				primary = {
					type: AST.CallExpression,
					callee: primary,
					arguments: this.parseArguments()
				};
				this.consume(")");
			} else if (next.text === "[") {
				primary = {
					type: AST.MemberExpression,
					object: primary,
					property: this.expression(),
					computed: true
				};
				this.consume("]");
			} else if (next.text === ".") {
				primary = {
					type: AST.MemberExpression,
					object: primary,
					property: this.identifier(),
					computed: false
				};
			} else {
				this.throwError("IMPOSSIBLE");
			}
		}
		return primary
	}

	filter (baseExpression) {
		const filterIdent = this.identifier();
		let filterFunc = this.getFilter(filterIdent.name);
		if (filterFunc) {
			// filterIdent.origName = filterIdent.name // breaks some tests right now, but might be useful?
			filterIdent.name = filterFunc.ident || filterFunc.name; // aliases get normalized in AST
		}
		const isListFilter = filterFunc && filterFunc.listFilter;
		const isSort = isListFilter && filterFunc.keyFilter;
		const isRTL = isListFilter && filterFunc.rtlFilter;
		const newNode = {
			type: AST.FilterExpression,
			filter: filterIdent,
			input: baseExpression,
			lambda: Boolean(isListFilter),
			rtl: Boolean(isRTL),
		};
		const args = newNode.arguments = [];
		let argNum = 0;
		while (this.expect(":")) {
			args.push(
				isSort
					? this.sortKey()
					: isListFilter && argNum === 0
					  ? this.lambdaExpression()
						: this.expression()
			);
			argNum++;
		}
		if (isRTL && baseExpression.rtl && !baseExpression.endGroup) {
			// modify filter chaining for adjacent filters with right-to-left preference
			let reparent = baseExpression;
			while (reparent.arguments[0].expression.rtl && !reparent.endGroup) {
				reparent = reparent.arguments[0].expression;
			}
			newNode.input = reparent.arguments[0].expression;
			reparent.arguments[0].expression = newNode;
			return baseExpression
		} // else
		return newNode
	}

	parseArguments () {
		const args = [];
		if (this.peekToken().text !== ")") {
			do {
				args.push(this.filterChain());
			} while (this.expect(","))
		}
		return args
	}

	identifier () {
		const start = this.tokens[0].index;
		const end = start + this.tokens[0].text.length;
		const token = this.consume();
		if (!token.identifier) {
			this.throwError("is not a valid identifier", token);
		}
		return this.addLoc({ type: AST.Identifier, name: token.text }, start, end)
	}

	constant () {
		// TODO check that it is a constant
		return { type: AST.Literal, value: this.consume().value }
	}

	arrayDeclaration () {
		const elements = [];
		if (this.peekToken().text !== "]") {
			do {
				if (this.peek("]")) {
					// Support trailing commas per ES5.1.
					break
				}
				elements.push(this.expression());
			} while (this.expect(","))
		}
		this.consume("]");

		return { type: AST.ArrayExpression, elements: elements }
	}

	object () {
		const properties = [];
		let property;
		if (this.peekToken().text !== "}") {
			do {
				if (this.peek("}")) {
					// Support trailing commas per ES5.1.
					break
				}
				property = { type: AST.Property, kind: "init" };
				if (this.peek().constant) {
					property.key = this.constant();
					property.computed = false;
					this.consume(":");
					property.value = this.expression();
				} else if (this.peek().identifier) {
					property.key = this.identifier();
					property.computed = false;
					if (this.peek(":")) {
						this.consume(":");
						property.value = this.expression();
					} else {
						property.value = property.key;
					}
				} else if (this.peek("[")) {
					this.consume("[");
					property.key = this.expression();
					this.consume("]");
					property.computed = true;
					this.consume(":");
					property.value = this.expression();
				} else {
					this.throwError("invalid key", this.peek());
				}
				properties.push(property);
			} while (this.expect(","))
		}
		this.consume("}");

		return { type: AST.ObjectExpression, properties: properties }
	}

	throwError (msg, token) {
		throw new Error(`Syntax Error: Token '${token.text}' ${msg} at column ${
      token.index + 1} of the expression [${this.text}] starting at [${
      this.text.substring(token.index)}].`)
	}

	consume (e1) {
		if (this.tokens.length === 0) {
			throw new Error(`Unexpected end of expression: ${this.text}`)
		}

		const token = this.expect(e1);
		if (!token) {
			this.throwError("is unexpected, expecting [" + e1 + "]", this.peek());
		}
		return token
	}

	peekToken () {
		if (this.tokens.length === 0) {
			throw new Error(`Unexpected end of expression: ${this.text}`)
		}
		return this.tokens[0]
	}

	peek (e1, e2, e3, e4) {
		return this.peekAhead(0, e1, e2, e3, e4)
	}

	peekAhead (i, e1, e2, e3, e4) {
		if (this.tokens.length > i) {
			const token = this.tokens[i];
			const t = token.text;
			if (
				t === e1 ||
				t === e2 ||
				t === e3 ||
				t === e4 ||
				(!e1 && !e2 && !e3 && !e4)
			) {
				return token
			}
		}
		return false
	}

	expect (e1, e2, e3, e4) {
		const token = this.peek(e1, e2, e3, e4);
		if (token) {
			this.tokens.shift();
			return token
		}
		return false
	}
}

function pushScope (scope) {
	return scope instanceof Scope$1 ? scope : new Scope$1(scope)
}

function isScope (obj) {
  return obj instanceof Scope$1
}

let Scope$1 = class Scope {
  constructor (value, parentScope) {
    if (value instanceof Scope) {
      throw new Error('value is already an instance of Scope')
    }
    this.value = value;
    let vt = typeof value;
    if (value === null || vt === 'undefined') {
      vt = 'null';
    } else {
      this.typename = value.__typename; // just in case?
      if (vt === 'object') {
        if (value.constructor && primitiveConstructors$1.includes(value.constructor)) {
          vt = value.constructor.name.toLowerCase();
          // if (['string', 'number', 'boolean'].includes(vt)) { // unwrap the primitive
          //   Object.keys(value)
          //     .filter(key => isNaN(+key))
          //     .forEach(key => this[key] = value[key])
          //   value = value.valueOf()
          // }
        } // else {
        // 	Object.assign(this, value)
        // }
      }
    }
    this.type = vt;
    this.isPrimitive = (vt !== 'object');
    if (parentScope && !(parentScope instanceof Scope)) {
        throw new Error('parentScope is not an instance of scope!')
    }
    this._parent = parentScope || null;
  }

  ps (value, index0, count, punc) {
    if (isNaN(index0)) { // no index provided; intent is to push an object scope
      if (value instanceof Scope) {
        if (value._parent === this) {
          return value // looks okay, it's a no-op
        }
        throw new Error('Cannot reuse conflicting Scope. What are you trying to do?')
      }
      return new Scope(value, this)
    } else { // index provided; intent is to push an iteration scope
      if (value instanceof Scope) {
        if (value._parent === this && value._index0 == index0) {
          return value // looks okay I guess, let it go
        }
        throw new Error('Cannot reuse conflicting EnumerationScope. What are you tryig to do?')
      }
      return new EnumerationScope(this, value, +index0, count, punc)
    }
  }

  lookupVal (ident, ns) {
    if (ns) {
      // look up scope chain until you find a frame of the expected typename, then look up ident on that frame (or return whole frame's value if no ident given)
      const frame = this.lookupScope(null, ns);
      return frame && frame.getOwnVal(ident)
    }
    if (ident) {
      // look up scope chain until you find one that "has" a member by the name of ident, and return that ident's value
      const frame = this.lookupScope(ident);
      return frame && frame.getOwnVal(ident)
    }
    // else: return the whole value for this frame
    return this.value
  }

  setOwnVal (ident, value, ns) {
    //throw new error('not implemented')
    this.value[ident] = value;
  }

  hasOwnVal (ident) {
    if (ident && ident.startsWith('_')) {
      if (ident in this) return true // _parent, _index0 etc. are on this, but _key, _values (for grouping) are on this.value
    }
    if (this.type === 'null') return false
    if (!ident) return true
    if (typeof this.value === 'object') return (ident in this.value)
    return Boolean(this.value[ident])
  }

  getOwnVal (ident) {
    if (!ident) return this.value
    if (ident.startsWith('_') && (ident in this)) return this[ident]
    if (this.type === 'null') return undefined
    let result = this.value[ident];
    if (typeof result === 'function' && result.ast) {
      result = result.apply(undefined, [this]);
    }
    return result
  }

  lookupScope (ident, ns) {
    let result = this;
    if (ns) { // only look at type name for lookup
      while (result && (result.typename !== ns)) result = result._parent;
      return result
    }
    if (ident) {
      // when ns not specified, just look for presence of ident (fall-back to top of stack if not found)
      while (result && !result.hasOwnVal(ident)) result = result._parent;
      return result || this
    }
    // if no ident specified, just return this frame
    return result
  }

  [Symbol.toPrimitive] (hint) {
    switch (this.type) {
      case 'null':
        return this.value
      case 'string':
      case 'number':
      case 'boolean':
      case 'date':
        return this.value.valueOf()
      default:
        if (hint === 'string') return ''+this.value
        if (hint === 'number') return +this.value
        // else
        return Boolean(this.value)
    }
  }

	toString (...args) {
    if (this.value === null) return this.type
    if (this.value === undefined) return 'undefined'
		return this.value.toString.apply(this.value, args)
  }

  valueOf () {
    return this.value
  }
};

class EnumerationScope extends Scope$1 {
	constructor (parent, item, index0, count, punc) {
    super(item, parent);
  	this._index0 = index0;
    this.length = count;
    this.punc = punc;
	}

	get _index () {
		return this._index0 + 1
	}

	get _punc () {
    const index0 = this._index0;
    const lastItem = this.length - 1;
    const punc = this.punc;
    return punc                     // if punctuation was specified
      ? (index0 === lastItem)       //   (then) if index0 is the last item
        ? punc.suffix               //     (then) get the list suffix (if any)
        : (index0 === lastItem - 1) //     (else) if index0 is 2nd to last
          ? index0 === 0            //       (then) if first (meaning there are only 2!)
            ? punc.only2            //         (then) get only2
            : punc.last2            //         (else) get last2
          : punc.between            //       (else) just get regular 'between' punctuation
      : ''                          //   (else) no punctuation
	}
}

function parseListExample (example) {
  const p1 = example.indexOf('1');
  const p2 = example.indexOf('2');
  const p3 = example.indexOf('3');
  if (p1 >= 0 && p2 > p1) { // at least 1 & 2 are present and in the right order (minimum for valid example)
    // const prefix = example.slice(0, p1)
    // you may wonder why we don't bother remembering the stuff prior to the "1" token (if any)
    // It's because right now, this stuff only gets merged into assembled content at the location where
    // the template compiler has placed a {[_punc]} field, and no _punc field gets added at the beginning
    // of a list item.  In fact, it kinda raises the question of how appropriate it is to support the suffix,
    // as we do, because if there are NO items in the list, you might expect the suffix to be merged anyway,
    // but it's not -- it only gets merged as a suffix to the last item in the list.  If we wanted to add a
    // prefix, but still be consistent, we'd need the prefix to only be merged as a prefix to the first item,
    // and if there were no items, you'd get neither prefix nor suffix.
    const between = example.slice(p1 + 1, p2);
    if (p3 > p2) { // 3 is also present and in the expected order
      const last2 = example.slice(p2 + 1, p3);
      let only2;
      if (last2.startsWith(',') && last2.trimRight().length > 1 && between.trimRight() === ',') {
        // oxford comma: "1, 2, and 3". But if only 2 items in list, omit oxford comma: "1 and 2"
        only2 = last2.slice(1);
      } else {
        only2 = last2;
      }
      const suffix = example.slice(p3 + 1);
      return { between, last2, only2, suffix }
    } else { // 3 is not present or is not in the valid order
      const suffix = example.slice(p2 + 1);
      return { between, last2: between, only2: between, suffix }
    }
  }
}

// An instance of ExternalBinary represents an external file or BLOB that
// (1) TINQ does not know how to create (hence "External"... TINQ only does text)
// (2) CAN be created dynamically by some other, (again) external, code
// (3) needs data from inside TINQ's scope to produce this external file
// (4) (optionally) needs to composite this external output with other output ALSO being created by TINQ
class ExternalBinary {
  constructor (props, scope, contentType = '') {
    for (const [key, value] of Object.entries(props)) {
      this[key] = value;
    }
    if (scope || !('scope' in this)) {
      this.scope = scope;
    }
    // contentType is inherited from props (if it's there) or it can be explicitly specified
    // contentType should be 'text', 'markdown', or 'docx' (for indirects using opendocx)
    if (contentType || !('contentType' in this)) {
      this.contentType = contentType;
    }
  }

  isEqualTo (that) {
    // compare based on enumeration of that's properties instead of this,
    // because we want to match if that has no "id" property even if this does!
    return Object
      .keys(that)
      .every(propName => {
        const indPropVal = that[propName];
        return (indPropVal && (indPropVal instanceof Scope$1))
          ? indPropVal.valueEqualTo(this[propName])
          : indPropVal === this[propName]
      })
  }

  // toString () {} // When an ExternalBinary is encountered during (synchronous) text-based assembly,
  //                // toString() is called on the instance in order to retrieve a text representation. (maybe)
  //                // In (async) docx-based assembly, encountering an indirect causes a special
  //                // placeholder to be inserted so the resulting files can be composed later.
}

class ASTInterpreter {
	constructor (filters) {
		this.filters = filters;
	}

	compile (ast) {
		const self = this;
		if (ast) {
			findConstantExpressions(ast, self.filters);
			// let assignable
			// let assign
			// if ((assignable = assignableAST(ast))) {
			// 	assign = this.recurse(assignable)
			// }
		}
		// const toWatch = getInputs(astProg.body)
		// let inputs
		// if (toWatch) {
		// 	inputs = []
		// 	toWatch.forEach((watch, key) => {
		// 		const input = self.recurse(watch)
		// 		watch.winput = input
		// 		inputs.push(input)
		// 		watch.watchId = key
		// 	})
		// }
		let fn = self.recurse(ast);
		// if (!ast || (ast.type === AST.Program && !ast.body.length)) { // special case
		// 	fn = noop
		// } else if (ast.type === AST.Program) { // it's a template AST, so compile the template
		// 	const expressions = []
		// 	ast.body.forEach(elem => {
		// 		expressions.push(elem.type === AST.TemplateElement ? elem : self.recurse(elem.expression))
		// 	})
		// 	fn = function (scope) {
		// 		let results = expressions.map(exp => exp(scope))
		// 		return results.join()
		// 	}
		// } else { // it's just an expression AST, so compile the expression
		// 	fn = self.recurse(ast)
		// }
		// if (assign) {
		// 	fn.assign = function (scope, value) {
		// 		return assign(scope, value)
		// 	}
		// }
		// if (inputs) {
		// 	fn.inputs = inputs
		// }
		fn.ast = ast;
		if (ast) {
			fn.literal = isLiteral(ast);
			fn.constant = isConstant(ast);
		}
		return fn
	}

	recurse (ast, contextOut, create) {
		if (!ast) return noop
		const self = this;
		let left, right, args, obj, expression;
		// if (ast.winput) {
		// 	return this.inputs(ast.winput, ast.watchId)
		// }
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				args = ast.body.map(elem => self.recurse(elem));
				return function template_block (scope) {
					return args
						.map(fn => fn(scope))
						.join('')
				}
			case AST.TemplateElement:
				return () => ast.text //this.staticText(ast.text)
			case AST.ContentField:
				right = this.recurse(ast.expression);
				return function content_field (scope) {
					return right(scope) + ""
				}
			case AST.ConditionalField:
				expression = this.recurse(ast.test);
				left = this.recurse(ast.consequent);
				right = ast.alternate && this.recurse(ast.alternate);
				return function conditional_field (scope, assign, inputs) {
					const value = expression(scope, assign, inputs)
						? left(scope, assign, inputs)
						: (right ? right(scope, assign, inputs) : '');
					return value
				}
			case AST.ListField:
				obj = {};
				expression = this.recurse(ast.expression, obj);
				right = this.recurse(ast.content); // in essence a lambda
				return function list_field (scope) {
					const exprListValue = expression(scope);
					if (exprListValue && exprListValue.length) {
						const results = exprListValue.map(
							(item, index) => right.call(undefined,
								obj.context.ps(item, index, exprListValue.length, exprListValue.punc)
							)
						);
						return results.join('')
					}
					return ''
				}
			case AST.Literal:
				return () => ast.value
			case AST.UnaryExpression:
				right = this.recurse(ast.argument);
				return function unary_op (scope, assign, inputs) {
					let result = right(scope, assign, inputs);
					if (ast.operator === '!') return !result
					if (isDefined(result)) return ast.operator === '-' ? -result : +result
					return 0
				}
			case AST.BinaryExpression:
				left = this.recurse(ast.left);
				right = this.recurse(ast.right);
				return function binary_op (scope, assign, inputs) {
					const lhs = left(scope, assign, inputs);
					const rhs = right(scope, assign, inputs);
					switch (ast.operator) {
						case '+': return plusFn(lhs, rhs)
						case '-': return (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0)
						case '*': return lhs * rhs
						case '/': return lhs / rhs
						case '%': return lhs % rhs
						case '===': return lhs === rhs
						case '!==': return lhs !== rhs
						case '==': return lhs == rhs
						case '!=': return lhs != rhs
						case '<': return lhs < rhs
						case '>': return lhs > rhs
						case '<=': return lhs <= rhs
						case '>=': return lhs >= rhs
					}
				}
			case AST.LogicalExpression:
				left = this.recurse(ast.left);
				right = this.recurse(ast.right);
				return function logical_op (scope, assign, inputs) {
					const lhs = left(scope, assign, inputs);
					switch (ast.operator) {
						case '&&': return lhs && right(scope, assign, inputs)
						case '||': return lhs || right(scope, assign, inputs)
					}
				}
			case AST.ConditionalExpression:
				expression = this.recurse(ast.test);
				left = this.recurse(ast.consequent);
				right = this.recurse(ast.alternate);
				return function ternary_op (scope, assign, inputs) {
					return expression(scope, assign, inputs)
						? left(scope, assign, inputs)
						: right(scope, assign, inputs)
				}
			case AST.Identifier:
				if (self.stage === 'inputs') throw "error: this has been broken for inputs"
				return function identifier_ (scope, assign, inputs) {
					const c = pushScope(scope);
					let base, value;
					if (contextOut || (create && create !== 1)) {
						base = c.lookupScope(ast.name, ast.ns);
						if (create && create !== 1
							&& base.getOwnVal(ast.name) == null
						) {
							base.setOwnVal(ast.name, {}, ast.ns);
						}
						value = base.getOwnVal(ast.name);
					} else {
						value = c.lookupVal(ast.name, ast.ns);
					}
					if (contextOut) {
						contextOut.context = base;
						contextOut.name = ast.name;
					}
					return value
				}
			case AST.MemberExpression:
				obj = {}; // we need context info for the object
				left = this.recurse(ast.object, obj, !!create);
				if (ast.computed) {
					right = this.recurse(ast.property);
					return function member_computed (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs);
						let value;
						let rhs = right(scope, assign, inputs);
						rhs = getStringValue(rhs);
						if (contextOut) {
							contextOut.context = obj.context;
							contextOut.name = rhs;
							contextOut.computed = true;
						}
						if (isScope(lhs)) {
							value = lhs.getOwnVal(rhs);
							if (create && create !== 1) {
								if (!value) {
									lhs.setOwnVal(rhs, {});
									value = lhs.getOwnVal(rhs);
								}
							}
							if (contextOut) {
								contextOut.object = value;
							}
						} else { // should be primitive or array
							if (lhs) {
								value = lhs[rhs];
								if (create && create !== 1) {
									if (!value) {
										value = lhs.value[rhs] = {};
									}
								}
							}
							if (contextOut) {
								contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs;
								if (!isNaN(rhs)) { // numeric index into array; // avoid losing scope chain!
									if (Array.isArray(lhs)) {
										value = pushScope(obj.context).ps(value, rhs, lhs.length, lhs.punc);
									} else {
										value = pushScope(obj.context).ps(value, rhs, 0);
									}
								}
							}
						}
						return value
					}
				} else { // !ast.computed
					const propName = ast.property.name;
					return function member_named (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs); // alert: lhs can be a Scope IF left is a computed member expression!
						if (!obj.context) throw "what to do?" // maybe base = pushScope(lhs)??
						// handle special case for _parent identifier, whose value is already a scope!
						const base = obj.name === '_parent' ? lhs : obj.context.ps(lhs);
						if (create && create !== 1) { // when create===1 that means we're called by an assignment so no need to create
							if (base.getOwnVal(propName) == null) {
								base.setOwnVal(propName, {});
							}
						}
						const value = base.getOwnVal(propName);
						if (contextOut) {
							contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs; // contextOut.object should not be a Scope
							contextOut.context = base;
							contextOut.computed = false;
							contextOut.name = propName;
						}
						return value
					}
				}
			case AST.CallExpression:
				obj = {}; // callee contextual info
				args = [];
				right = this.recurse(ast.callee, obj); // 2nd arg=={} means we are requesting the result's context
					// as well as its value. If the result is a function to be called, its context is the object ON WHICH
					// that function should be called)... and Knackly uses this ALL THE TIME, whenever (e.g.)
					// someone calls prototype methods on text strings, numbers, etc.
					// This is so the function can ultimately be invoked with "this" referring to the right thing
					// (see `rhs.value.apply(rhs.context, values)` below)
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr));
				});
				return function call_expr (scope, assign, inputs) {
					const rhs = right(scope, assign, inputs);
					let value;
					if (rhs != null) {
						const argValues = args.map(arg => arg(scope, assign, inputs));
						value = rhs.apply(obj.context.valueOf(), argValues);
					}
					return value
				}
			case AST.FilterExpression:
				right = this.filters(ast.filter.name);
				// Filters are implemented as functions, retrieved from this.filters().
				// These functions expect the first argument to be the INPUT to the filter.
				// ARGUMENTS to the filter (if any) are passed as SUBSEQUENT arguments to this function. 
				args = []; // (for the filter function to be called)
				obj = ast.lambda ? {} : undefined; // for list filters, we need the filter input's context!
				args.push(self.recurse(ast.input, obj));
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr));
				});
				return function filter_expr (scope, assign, inputs) {
					const argValues = [];
					args.forEach((arg, i) => {
						const result = arg(scope, assign, inputs);
						argValues.push(result);
						if (i === 0 && obj) { // list filter functions get the parent context as the 2nd argument!
							argValues.push(obj.context || pushScope(null)); // must have a context, even if null
						}
					});
					const value = right.apply(undefined, argValues, inputs); // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
					if (contextOut) {
						contextOut.context = pushScope(scope);
					}
					return value
				}
			case AST.LambdaExpression:
				right = self.recurse(ast.expression);
				return function lambda_expr () { return right }
			case AST.SortKeyExpression:
				right = self.recurse(ast.key);
				if (ast.descending) {
					right.descending = true;
				}
				return function sort_key () { return right }
			case AST.AssignmentExpression:
				obj = {};
				left = this.recurse(ast.left, obj, 1); // 2nd arg=={} means we are requesting both the value (the
				// ...value that is being re-assigned) AND its context (the object ON WHICH that value exists)
				// This is so the value reassignment can happen on the correct object
				// (see `lhs.context[lhs.name] = rhs` below)
				right = this.recurse(ast.right);
				return function assign_expr (scope, assign, inputs) {
					left(scope, assign, inputs); // need to call because this is what actually populates obj!
					const rhs = right(scope, assign, inputs);
					obj.context.setOwnVal(obj.name, rhs, ast.ns);
					return obj.context.getOwnVal(obj.name) // should === rhs but just to be sure
				}
			case AST.ArrayExpression:
				args = [];
				ast.elements.forEach(expr => {
					args.push(self.recurse(expr));
				});
				return function array_expr (scope, assign, inputs) {
					return args.map(arg => arg(scope, assign, inputs))
				}
			case AST.ObjectExpression:
				args = [];
				ast.properties.forEach(property => {
					if (property.computed) {
						args.push({
							key: self.recurse(property.key),
							computed: true,
							value: self.recurse(property.value),
						});
					} else {
						args.push({
							key: property.key.type === AST.Identifier ? property.key.name : "" + property.key.value,
							computed: false,
							value: self.recurse(property.value),
						});
					}
				});
				return function object_expr (scope, assign, inputs) {
					const value = {};
					for (const arg of args) {
						if (arg.computed) {
							value[arg.key(scope, assign, inputs)] = arg.value(scope, assign, inputs);
						} else {
							value[arg.key] = arg.value(scope, assign, inputs);
						}
					}
					return value
				}
			case AST.ThisExpression:
				return function this_expr (scope) {
					const c = pushScope(scope);
					if (contextOut) {
						contextOut.context = c._parent;
					}
					return c.getOwnVal()
				}
			case AST.NGValueParameter:
				return function (scope, assign) {
					return assign
				}
		}
	}

	// inputs (input, watchId) {
	// 	return function (scope, value, inputs) {
	// 		if (inputs) return inputs[watchId]
	// 		return input(scope, value)
	// 	}
	// }
}

class ASTCompiler {
  constructor (filters) {
    this.filters = filters;
    this.USE = "use";
    this.STRICT = "strict";
    this.stringEscapeRegex = /[^ a-zA-Z0-9]/g;
  }

	compile (ast) {
		const self = this;
		this.state = {
			nextId: 0,
			filters: {},
			fn: { vars: [], body: [], own: {} },
			assign: { vars: [], body: [], own: {} },
			inputs: []
		};
		let extra = "";
		if (ast) {
			findConstantExpressions(ast, self.filters);
			this.stage = "lambdas";
			let index = 0;
			for (const lnode of FindLambdas(ast)) {
				const lkey = 'lambda' + ++index;
				lnode._lkey = lkey;
				self.state[lkey] = { vars: [], body: [], own: {} };
				self.state.computing = lkey;
				// pre-processing for each lambda
				let rnode, init;
				if (lnode.type === AST.SortKeyExpression) rnode = lnode.key;
				else if (lnode.type === AST.LambdaExpression) rnode = lnode.expression;
				else { // it's a content block inside a list field
					rnode = lnode;
					init = '[]';
				}
				const lid = self.nextId(false, init);
				const cinfo = {};
				self.recurse(rnode, lid, cinfo);
				lnode._ckey = cinfo.context;
				self.return_(lid);
			}
			// let assignable
			// this.stage = "assign"
			// if ((assignable = assignableAST(ast))) {
			// 	this.state.computing = "assign"
			// 	const result = this.nextId()
			// 	this.recurse(assignable, result)
			// 	this.return_(result)
			// 	extra = "fn.assign=" + this.generateFunction("assign", "s,v")
			// }
			// const toWatch = getInputs(ast.body)
			// self.stage = "inputs"
			// if (toWatch) {
			// 	toWatch.forEach((watch, key) => {
			// 		const fnKey = "fn" + key
			// 		self.state[fnKey] = { vars: [], body: [], own: {} }
			// 		self.state.computing = fnKey
			// 		const intoId = self.nextId()
			// 		self.recurse(watch, intoId)
			// 		self.return_(intoId)
			// 		self.state.inputs.push(fnKey)
			// 		watch.watchId = key
			// 	})
			// }
		}
		this.state.computing = "fn";
		this.stage = "main";
		if (ast) {
			this.recurse(ast, undefined, undefined, (intoId) => {
				this.return_(intoId);
			});
		}
		// The build and minification steps remove the string "use strict" from the code, but this is done using a regex.
		// This is a workaround for this until we do a better job at only removing the prefix only when we should.
		const fns = [];
		append(fns, `"${this.USE} ${this.STRICT}"`);
		append(fns, this.filterPrefix());
		append(fns, `var fn=${this.generateFunction("fn", "s,a,i")}`);
		append(fns, extra);
		append(fns, this.watchFns());
		append(fns, 'return fn');
		// eslint-disable-next-line no-new-func
		const fn = new Function(
			"flt",
			"gsv",
			"ifd",
			"pls",
			"ps",
			"iss",
			fns.join('\n') // last argument to Function() is function body; each prior is an argument name
		)(this.filters, getStringValue, ifDefined, plusFn, pushScope, isScope);

		this.state = this.stage = undefined;
		fn.ast = ast;
		if (ast) {
			fn.literal = isLiteral(ast);
			fn.constant = isConstant(ast);
		}
		return fn
	}

	watchFns () {
		const result = [];
		const fns = this.state.inputs; // currently always empty because inputs stage & watch finding is commented out
		const self = this;
		fns.forEach(name => {
			result.push(`var ${name}=${self.generateFunction(name, "s")}`);
		});
		if (fns.length) {
			result.push(`fn.inputs=[${fns.join(",")}];`);
		}
		return result.join("")
	}

	generateFunction (name, params) {
		return `function(${params}){${this.varsPrefix(name)}${this.funcBody(name)}}`
	}

	filterPrefix () {
		const parts = [];
		const self = this;
		for (const [filter, id] of Object.entries(this.state.filters)) {
			parts.push(id + "=flt(" + self.escape(filter) + ")");
		}
		if (parts.length) return `var ${parts.join(",")};`
		return ""
	}

	varsPrefix (section) {
		return this.state[section].vars.length
			? `var ${this.state[section].vars.join(",")};`
			: ""
	}

	funcBody (section) {
		return this.state[section].body.join("")
	}

	/**
	 * transpiles the given ast node into JavaScript code that can execute in the browser or NodeJS
	 * 
	 * @param {object} ast node
	 * @param {string} intoId id of the variable (in the target code) in which the result of the current operation should
	 *                        be stored
	 * @param {object?} contextOut if the current operation needs to return contextual (scope) information, contextOut is
	 *                             an object through which that contextual information can flow back up the call stack.
	 * @param {*} returnFn for all expressions and sub-expressions that ultimately compile down to strings (containing
	 *                        JavaScript), this callback (if specified) is invoked as the last thing after that
	 *                        compilation is complete. Not currently called for template & field nodes.
	 * @param {*} create 
	 * @param {*} skipWatchIdCheck 
	 * @returns void. The recurse method alters the state of this ASTCompiler instance, such that after the call to
	 * recurse returns, the generateFunction() method can be used to finish the code generation.
	 */
	recurse (ast, intoId, contextOut, returnFn, create, skipWatchIdCheck) {
		if (!ast) return // any need to call returnFn() here before returning, or will it always already be noop?
		const self = this;
		let left, right, args, obj, expression;
		returnFn = returnFn || noop;
		if (!skipWatchIdCheck && isDefined(ast.watchId)) {
			intoId = intoId || this.nextId();
			this.if_(
				"i",
				this.lazyAssignId(intoId, this.computedMember("i", ast.watchId)),
				this.lazyRecurse(ast, intoId, contextOut, returnFn, create, true)
			);
			return
		}
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				intoId = intoId || this.nextId(false, '[]');
				ast.body.forEach(elem => self.recurse(elem, undefined, undefined, result => {
					this.current().body.push(intoId, ".push(", result, ");");
				}));
				returnFn(this.assignId(intoId, intoId + '.join("")'));
				break
			case AST.TemplateElement:
				returnFn(this.escape(ast.text));
				break
			case AST.ContentField:
				self.recurse(ast.expression, undefined, undefined, result => {
					right = result;
				});
				right += '+""'; // to string
				returnFn(right);
				break
			case AST.ConditionalField:
				intoId = intoId || this.nextId();
				self.recurse(ast.test, intoId);
				self.if_(
					intoId,
					() => { // consequent can be either a block node or a single
						if (ast.consequent.type === AST.TemplateBlock) {
							self.assignId(intoId, '[]');
							self.recurse(ast.consequent, intoId);
						} else {
							self.recurse(ast.consequent, undefined, undefined, result => {
								self.assignId(intoId, result);
							});
						}
					},
					ast.alternate && (() => { // alternate, if specified, can be either a block node or a single
						if (ast.alternate.type === AST.TemplateBlock) {
							self.assignId(intoId, '[]');
							self.recurse(ast.alternate, intoId);
						} else {
							self.recurse(ast.alternate, undefined, undefined, result => {
								self.assignId(intoId, result);
							});
						}
					}),
				);
				returnFn(intoId);
				break
			case AST.ListField:
				expression = self.nextId(); // the list value itself
				obj = {}; // to receive the list value's context info
				self.recurse(ast.expression, expression, obj); // get list value
				right = self.assignId(self.nextId(), self.generateFunction(ast.content._lkey, "s")); // list content lambda
				left = self.nextId(false, ""); // var to hold result of list
				self.if_(
					expression + '&&' + expression + '.length',
					() => {
						self.assignId(left, `${expression}.map(` +
							`(e,i)=>${right}.call(undefined,ps(${obj.context}).ps(e,i,${expression}.length,${expression}.punc))` +
						').join("")');
					}
				);
				returnFn(left);
				break
			case AST.Literal:
				expression = this.escape(ast.value);
				this.assignId(intoId, expression);
				returnFn(intoId || expression);
				break
			case AST.UnaryExpression:
				this.recurse(ast.argument, undefined, undefined, expr => {
					right = expr;
				});
				expression = ast.operator + "(" + this.ifDefined(right, 0) + ")"; // TODO: I don't think these parens are necessary, are they?
				this.assignId(intoId, expression);
				returnFn(expression);
				break
			case AST.BinaryExpression:
				this.recurse(ast.left, undefined, undefined, expr => left = expr);
				this.recurse(ast.right, undefined, undefined, expr => right = expr);
				if (ast.operator === "+") {
					expression = this.plus(left, right);
				} else if (ast.operator === "-") {
					expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0);
				} else {
					expression = "(" + left + ")" + ast.operator + "(" + right + ")"; // todo: use OOP to determine when parens are needed
				}
				this.assignId(intoId, expression);
				returnFn(expression);
				break
			case AST.LogicalExpression:
				intoId = intoId || this.nextId();
				self.recurse(ast.left, intoId);
				self.if_(
					ast.operator === "&&" ? intoId : self.not(intoId),
					self.lazyRecurse(ast.right, intoId)
				);
				returnFn(intoId);
				break
			case AST.ConditionalExpression:
				intoId = intoId || this.nextId();
				self.recurse(ast.test, intoId);
				self.if_(
					intoId,
					self.lazyRecurse(ast.consequent, intoId),
					self.lazyRecurse(ast.alternate, intoId),
				);
				returnFn(intoId);
				break
			case AST.Identifier:
				if (self.stage === 'inputs') throw "error: this has been broken for inputs"
				intoId = intoId || self.nextId();
				if (contextOut || (create && create !== 1)) {
					left = self.assignId(self.nextId(), self.lookupScopeOf(ast.name, ast.ns));
					if (create && create !== 1) {
						self.if_(
							self.isNull(self.getOwnValue(left, ast.name)),
							() => {
								self.setOwnValue(left, ast.name, '{}', ast.ns);
							}
						);
					}
					self.assignId(intoId, self.getOwnValue(left, ast.name));
				} else {
					self.assignId(intoId, self.lookupValue(ast.name, ast.ns));
				}
				if (contextOut) {
					contextOut.context = left;
					contextOut.name = ast.name;
				}
				returnFn(intoId);
				break
			case AST.MemberExpression:
				left = this.nextId(); // object will be stored here
				intoId = intoId || this.nextId(); // whole member expression will be stored here
				obj = {}; // we need context info for the object
				self.recurse(ast.object, left, obj, () => {
					if (ast.computed) {
						right = self.nextId();
						self.if_(
							self.notNull(left),
							function () {
								self.recurse(ast.property, right);
								self.setStringValue(right);
								if (contextOut) {
									contextOut.context = obj.context;
									contextOut.name = right;
									contextOut.computed = true;
								}
								self.if_(
									self.isScope(left),
									function consequent () { // lhs is a scope; use scope accessors
										self.assignId(intoId, self.getOwnValueDyn(left, right));
										if (create && create !== 1) {
											self.if_(
												self.isNull(intoId),
												() => {
													self.setOwnValueDyn(left, right, '{}', ast.ns);
													self.assignId(intoId, self.getOwnValueDyn(left, right));
												},
											);
										}
										if (contextOut) contextOut.object = intoId;
									},
									function alternate () { // lhs is a primitive or array; use native accessors
										const member = self.computedMember(left, right); // `${left}[${right}]`
										self.assignId(intoId, member);
										if (create && create !== 1) {
											self.if_(
												self.not(intoId),
												() => {
													self.assignId(member, '{}');
													self.assignId(intoId, member);
												}
											);
										}
										if (contextOut) {
											contextOut.object = left;
											self.if_(
												self.isArray(left) + "&&" + self.isNumber(right), // numeric index into array
												// avoid losing scope chain
												self.lazyAssignId(intoId, `ps(${obj.context}).ps(${[intoId, right, left+'.length', left+'.punc'].join(',')})`)
											);
										}
									}
								);
							}
						);
					} else { // !ast.computed
						if (!obj.context) throw "what to do?"
						const propName = ast.property.name;
						const base = obj.name === '_parent' ? left : obj.context+'.ps(' + left + ')';
						expression = self.assignId(self.nextId(), base);
						//const member = self.nonComputedMember(left, propName) // `${left}.${propName}` (plus some other checks)
						if (create && create !== 1) {
							self.if_(
								self.isNull(self.getOwnValue(expression, propName)),
								() => {
									self.setOwnValue(expression, propName, '{}');
								}
							);
						}
						self.assignId(intoId, self.getOwnValue(expression, propName));
						if (contextOut) {
							contextOut.object = left; // native value of what's to the left of the .
							contextOut.context = expression; // context object of what's to the left of the .
							contextOut.computed = false;
							contextOut.name = propName;
						}
					}
					returnFn(intoId);
				}, !!create);
				break
			case AST.CallExpression:
				intoId = intoId || this.nextId();
				right = self.nextId(); // callee value -- the function to be called (ident for globals, member expr for methods)
				obj = {}; // callee contextual info
				args = [];
				self.recurse(ast.callee, right, obj, function () {
					self.if_(
						self.notNull(right),
						function () {
							ast.arguments.forEach(expr => {
								self.recurse(
									expr,
									ast.constant ? undefined : self.nextId(),
									undefined,
									function (argument) {
										args.push(argument);
									}
								);
							});
							expression = right + '.call(' + obj.context + '.valueOf(),' + args.join(',') + ')';
							// if (obj.object /*obj.name || obj.context*/) {
							// 	// right == v1, which is wrong (function instead of value on which function is invoked)
							// 	// obj.context == v4, which is wrong (scope instead of raw value)
							// 	// need access to v2, which is the object on which we need to call v1, but not sure how we should be getting it!
							// 	// we could re-extract it from v4 by calling getObjectVal on it??  (even though it's already stored in v2?)
							// 	expression = right + '.call(' + obj.context + ',' + args.join(',') + ')'
							// 	// expression =
							// 	// 	self.member(right, obj.name, obj.computed) +
							// 	// 	"(" + args.join(",") + ")"
							// } else {
							// 	expression = right + "(" + args.join(",") + ")"
							// }
							self.assignId(intoId, expression);
						},
						function () {
							self.assignId(intoId, "undefined");
						}
					);
					returnFn(intoId);
				});
				break
			case AST.FilterExpression:
				intoId = intoId || this.nextId();
				right = self.filter(ast.filter.name);
				args = [];
				obj = ast.lambda ? {} : undefined;
				left = self.nextId();
				self.recurse(ast.input, left, obj);
				args.push(left);
				if (ast.lambda) {
					if (obj.context) // normal case, list value came from some parent context
						args.push(obj.context);
					else
						args.push('ps(null)'); // if no parent context, we must construct an empty one
				}
				ast.arguments.forEach(expr => {
					const argId = self.nextId();
					if (expr.type === AST.LambdaExpression || expr.type === AST.SortKeyExpression) {
						self.assignId(argId, self.generateFunction(expr._lkey, "s"));
						if (expr.type === AST.SortKeyExpression && expr.descending) {
							self.assignId(argId + '.descending', 'true'); // sets a "descending" property on the sort key lambda function
						}
					} else {
						self.recurse(expr, argId);
					}
					args.push(argId);
				});
				// call the filter function, passing in the arguments assembled above
				expression = `${right}.call(undefined,${args.join(',')})`;
				self.assignId(intoId, expression);
				if (contextOut) {
					contextOut.context = self.assignId(self.nextId(), 'ps(s)');
				}
				returnFn(intoId);
				break
			case AST.LambdaExpression:
			case AST.SortKeyExpression:
				// currently no-op; already handled earlier in lambda pass
				break
			case AST.AssignmentExpression:
				right = this.nextId();
				obj = {};
				this.recurse(ast.left, undefined, obj, () => {
					self.recurse(ast.right, right);
					self.setOwnValue(obj.context, obj.name, right, ast.ns);
					self.assignId(intoId, self.getOwnValue(obj.context, obj.name));
					returnFn(intoId || right);
				}, 1);
				break
			case AST.ArrayExpression:
				args = [];
				ast.elements.forEach(expr => {
					self.recurse(
						expr,
						ast.constant ? undefined : self.nextId(),
						undefined,
						function (argument) {
							args.push(argument);
						}
					);
				});
				expression = "[" + args.join(",") + "]";
				this.assignId(intoId, expression);
				returnFn(intoId || expression);
				break
			case AST.ObjectExpression:
				args = [];
				if (ast.properties.some(property => property.computed)) {
					intoId = intoId || this.nextId();
					this.assignId(intoId, "{}");
					ast.properties.forEach(property => {
						if (property.computed) {
							left = self.nextId();
							self.recurse(property.key, left);
						} else {
							left = property.key.type === AST.Identifier ? property.key.name : "" + property.key.value;
						}
						right = self.nextId();
						self.recurse(property.value, right);
						self.assignId(self.member(intoId, left, property.computed), right);
					});
				} else {
					ast.properties.forEach(property => {
						self.recurse(
							property.value,
							ast.constant ? undefined : self.nextId(),
							undefined,
							function (expr) {
								args.push(
									self.escape(property.key.type === AST.Identifier ? property.key.name : "" + property.key.value )
									  + ":" + expr
								);
							}
						);
					});
					expression = "{" + args.join(",") + "}";
					this.assignId(intoId, expression);
				}
				returnFn(intoId || expression);
				break
			case AST.ThisExpression:
				this.useScope();
				this.assignId(intoId, "c.getOwnVal()");
				if (contextOut) {
					contextOut.context = this.assignId(this.nextId(), "c._parent");
				}
				returnFn(intoId || "c.getOwnVal()");
				break
			case AST.NGValueParameter:
				this.assignId(intoId, "v");
				returnFn(intoId || "v");
				break
		}
	}

	getHasOwnProperty (element, property) {
		const key = element + "." + property;
		const own = this.current().own;
		if (!own.hasOwnProperty(key)) {
			own[key] = this.nextId(
				false,
				element + "&&(" + this.escape(property) + " in " + element + ")"
			);
		}
		return own[key]
	}

	useScope () {
		const own = this.current().own;
		if (!own.hasOwnProperty('_scope_')) {
			this.current().vars.push('c=ps(s)');
			own['_scope_'] = 'c';
		}
	}

	/**
	 * If a destination variable id is provided, assigns value to that variable id and returns
	 * the variable id. If no destination variable is provided, ignores the value and returns
	 * falsy.
	 * @param {string?} id the runtime identifier that will be assigned to value
	 * @param {string} value raw string that will be assigned to id
	 * @returns {string?} which identifier the value was stored to, if any
	 */
	assignId (id, value) {
		if (!id) return
		this.current().body.push(id, "=", value, ";");
		return id
	}

	pushElement (id, value) {
		if (!id) return
		this.current().body.push(id, ".push(", value, ");");
	}

	lookupValue (name, ns) {
		this.useScope();
		return 'c.lookupVal("' + name + (ns ? '","' + ns : '') + '")'
	}

	lookupScopeOf (name, ns) {
		this.useScope();
		return 'c.lookupScope("' + name + (ns ? '","' + ns : '') + '")'
	}

	getOwnValue (scope, name) {
		this.useScope();
		return scope + '.getOwnVal("' + name + '")'
	}

	getOwnValueDyn (scope, id) {
		this.useScope();
		return scope + '.getOwnVal(' + id + ')'
	}

	hasOwnValue (scope, name) {
		this.useScope();
		return scope + '.hasOwnVal("' + name + '")'
	}

	hasOwnValueDyn (scope, id) {
		this.useScope();
		return scope + '.hasOwnVal(' + id + ')'
	}

	setOwnValue (scope, name, value, ns) {
		this.useScope();
		this.current().body.push( // whoever actually pushes a command onto body is responsible for the ';':
			scope + '.setOwnVal("' + name + '",' + value + (ns ? ',"' + ns + '"' : '') + ');'
		);
	}

	setOwnValueDyn (scope, id, value, ns) {
		this.useScope();
		this.current().body.push( // whoever actually pushes a command onto body is responsible for the ';':
			scope + '.setOwnVal(' + id + ',' + value + (ns ? ',"' + ns + '"' : '') + ');'
		);
	}

	isScope (id) {
		return 'iss(' + id + ')'
	}

	isArray (id) {
		return 'Array.isArray(' + id + ')'
	}

	isNumber (id) {
		return '!isNaN(' + id + ')'
	}

	filter (filterName) {
		if (!this.state.filters.hasOwnProperty(filterName)) {
			this.state.filters[filterName] = this.nextId(true);
		}
		return this.state.filters[filterName]
	}

	ifDefined (id, defaultValue) {
		return 'ifd(' + id + ',' + this.escape(defaultValue) + ')'
	}

	plus (left, right) {
		return 'pls(' + left + ',' + right + ')'
	}

	return_ (id) {
		this.current().body.push('return ', id, ';');
	}

	// if test === true AT COMPILE TIME, we will execute consequentFn and ignore alternateFn.
	// Otherwise it devolves into a test performed at runtime, where if test evaluates to truthy
	// consequentFn will be executed, otherwise (if specified) alternateFn will be executed.
	if_ (test, consequentFn, alternateFn) {
		if (test === true) {
			consequentFn();
		} else {
			const body = this.current().body;
			body.push("if(", test, "){");
			consequentFn();
			body.push("}");
			if (alternateFn) {
				body.push("else{");
				alternateFn();
				body.push("}");
			}
		}
	}

	// "lazy" functions are just conveniences to curry calls to recurse and setValue,
	// used only in conjunction with _if() (which expects curried functions for its
	// consequentFn and alternateFn parameters).
	lazyRecurse (ast, intoId, contextOut, returnFn, create, skipWatchIdCheck) {
		const self = this;
		return function () {
			self.recurse(ast, intoId, contextOut, returnFn, create, skipWatchIdCheck);
		}
	}

	lazyAssignId (id, value) {
		const self = this;
		return function () {
			self.assignId(id, value);
		}
	}

	not (expression) {
		return "!(" + expression + ")"
	}

	isNull (expression) {
		return expression + "==null"
	}

	notNull (expression) {
		return expression + "!=null"
	}

	member (left, right, computed) {
		if (computed) return this.computedMember(left, right)
		return this.nonComputedMember(left, right)
	}

	computedMember (left, right) {
		return left + "[" + right + "]"
	}

	nonComputedMember (left, right) {
		const SAFE_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;
		const UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g;
		let expr = "";
		if (SAFE_IDENTIFIER.test(right)) {
			expr = left + "." + right;
		} else {
			right = right.replace(UNSAFE_CHARACTERS, this.stringEscapeFn);
			expr = left + '["' + right + '"]';
		}
		return expr
	}

	setStringValue (item) {
		this.assignId(item, "gsv(" + item + ")");
	}

	stringEscapeFn (c) {
		return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4)
	}

	escape (value) {
		if (isString(value))
			return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'"
		if (isNumber(value)) return value.toString()
		if (value === true) return "true"
		if (value === false) return "false"
		if (value === null) return "null"
		if (typeof value === "undefined") return "undefined"
		throw new Error("IMPOSSIBLE")
	}

	nextId (skip, init) {
		const id = "v" + this.state.nextId++;
		if (!skip) {
			this.current().vars.push(id + (init ? "=" + init : ""));
		}
		return id
	}

	current () {
		return this.state[this.state.computing]
	}
}

function append(builder, str) {
	if (str) {
		builder.push(str);
	}
}

function * FindLambdas (ast) {
  switch (ast.type) {
		case AST.Identifier:
		case AST.Literal:
		case AST.ThisExpression:
		case AST.NoOp:
			break
    case AST.Program:
		case AST.TemplateBlock:
			for (const elem of ast.body) yield * FindLambdas(elem);
		  break
    case AST.ContentField:
			yield * FindLambdas(ast.expression);
			break
    case AST.ConditionalField:
			yield * FindLambdas(ast.test);
			yield * FindLambdas(ast.consequent);
			if (ast.alternate) yield * FindLambdas(ast.alternate);
			break
    case AST.ListField:
			yield * FindLambdas(ast.expression);
			yield * FindLambdas(ast.content);
			yield ast.content; // list block (but not other blocks!) treated as a lambda by the compiler
			break
    case AST.MemberExpression:
			yield * FindLambdas(ast.object);
			yield * FindLambdas(ast.property);
      break
    case AST.CallExpression:
			yield * FindLambdas(ast.callee);
			for (const argument of ast.arguments) yield * FindLambdas(argument);
			break
    case AST.FilterExpression:
			yield * FindLambdas(ast.input);
			for (const argument of ast.arguments) yield * FindLambdas(argument);
			break
		case AST.LambdaExpression:
			yield * FindLambdas(ast.expression);
			yield ast;
			break
		case AST.SortKeyExpression:
			yield * FindLambdas(ast.key);
			yield ast;
			break
    case AST.ArrayExpression:
			for (const elem of ast.elements) yield * FindLambdas(elem);
			break
    case AST.ObjectExpression:
			for (const prop of ast.properties) yield * FindLambdas(prop);
			break
    case AST.Property:
			yield * FindLambdas(ast.value);
			break
    case AST.BinaryExpression:
    case AST.LogicalExpression:
			yield * FindLambdas(ast.left);
			yield * FindLambdas(ast.right);
			break
    case AST.UnaryExpression:
			yield * FindLambdas(ast.argument);
			break
    case AST.ConditionalExpression:
			yield * FindLambdas(ast.test);
			yield * FindLambdas(ast.consequent);
			yield * FindLambdas(ast.alternate);
			break
  }
	return
}

function isIterable (obj) {
  // checks for null and undefined; also strings (though iterable) should not be iterable *contexts*
  if (obj == null || isPrimitive(obj)) {
    return false
  }
  return isObjectIterable(obj)
}

function isObjectIterable (obj) {
  return obj && (typeof obj[Symbol.iterator] === 'function')
}

const primitiveConstructors = [String, Number, Boolean, Date];

function isPrimitive (value, includeWrapped = true) {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (includeWrapped) {
        if (value && value.constructor && primitiveConstructors.includes(value.constructor)) {
          return true
        }
      } else if (value && (value instanceof Date)) {
        return true
      }
  }
  return false
}

// define built-in filters
var filters = {
  // regular (scalar value) filters
  upper, lower, initcap, titlecaps, format, cardinal, ordinal, ordsuffix, else: else_filter, contains, punc, keepsections, 
  // list (array) filters
  sort, filter, find, any, every, map, group, reduce,
};

function upper (input) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString();
  return input.toUpperCase()
}

function lower (input) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString();
  return input.toLowerCase()
}

function initcap (input, forceLower = false) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString();
  if (forceLower) input = input.toLowerCase();
  return input.charAt(0).toUpperCase() + input.slice(1)
}

// const TitleCapRegEx_AsciiOnly = /(^|[^'’]|\W['’])\b([a-z])/gm // not only [a-z], but also \W and \b are ASCII only!
// without \b and \W, this is harder to do...
const TitleCapRegEx = /^\p{Ll}|(?:\s|(?:^|.)\p{P})\p{Ll}/gmu;
// 1st case: ^\p{Ll}  - char 0 is lowercase letter
// 2nd case: \s\p{Ll} - char n is whitespace, char n+1 is lowercase letter
// 3rd case: ^\p{P}\p{Ll} - char 0 is punctuation, char 1 lowercase letter
// 4th case: .\p{P}\p{Ll} - char n is ANYTHING (.), char n+1 is punctuation, char n+2 is lowercase letter
//      >> in this case additional logic is required to decide whether it's an exceptional case or not!
const UnicodeWordChar = /\p{L}|\p{N}/u;

function titlecaps (input, forceLower = false) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString();
  if (forceLower) input = input.toLowerCase();
  return input.replace(TitleCapRegEx, s => {
    // console.log(s)
    if (s.length === 3) { // 4th case above
      return (s[1] === "'" || s[1] === '’') && UnicodeWordChar.test(s[0])
        ? s // EXCEPTION for possessives and mid-word contractions: don't capitalize
        : s.slice(0, 2) + s[2].toUpperCase() // otherwise - do capitalize
    }
    return s.toUpperCase() // all other cases
  })
}

class DateFormatFixer {
  constructor (oldDateFormat) {
    this.formatStr = oldDateFormat;
  }

  fixed () {
    return this
      .replaceAll('YY', 'yy')
      .replaceAll('D', 'd')
      .replaceAll('[', '\'')
      .replaceAll(']', '\'')
      .formatStr
  }

  replaceAll (find, replaceWith) {
    return new DateFormatFixer(
      this.formatStr.replace(
        new RegExp(find.replace(DateFormatFixer.escRE, '\\$&'), 'g'),
        replaceWith
      )
    )
  }
}
DateFormatFixer.escRE = /[.*+?^${}()|[\]\\]/g;

function format (input, generalFmt, negativeFmt, zeroFmt) {
  if (input === null || typeof input === 'undefined') return input
  if (input instanceof Date) {
    // fix up format string to accommodate differences between date-fns 1.3 and current:
    const newFormat = new DateFormatFixer(generalFmt).fixed();
    return dateFns.format(input, newFormat)
  }
  if (typeof input === 'boolean' || input instanceof Boolean) {
    input = input.valueOf();
    if (generalFmt || negativeFmt) {
      generalFmt = generalFmt ? String(generalFmt) : '';
      negativeFmt = negativeFmt ? String(negativeFmt) : '';
      return input ? generalFmt : negativeFmt
    } // else
    return input ? 'true' : 'false'
  }
  // else number
  const num = Number(input);
  if (!isFinite(num)) return null
  let fmtStr;
  if (num === 0) {
    fmtStr = zeroFmt || generalFmt || '0,0';
  } else if (num < 0) {
    fmtStr = negativeFmt || generalFmt || '0,0';
  } else {
    fmtStr = generalFmt || '0,0';
  }
  if (fmtStr === 'cardinal') {
    return numWords.toWords(num, { useCommas: false })
  }
  if (fmtStr === 'ordinal') {
    return numWords.toWordsOrdinal(num, { useCommas: false })
  }
  if (fmtStr.toLowerCase() === 'a') {
    return base26(num, fmtStr === 'A')
  }
  return numeral(num).format(fmtStr)
}

function base26 (input, upper) {
  if (input === null || typeof input === 'undefined') return input
  const places = [];
  let quotient = Number(input);
  if (!isFinite(quotient)) return null
  let remain, dec;
  while (quotient !== 0) {
    dec = quotient - 1;
    quotient = Math.floor(dec / 26);
    remain = dec % 26;
    places.unshift(remain + 1);
  }
  const codes = places.map(n => n + (upper ? 64 : 96));
  return String.fromCharCode.apply(null, codes)
}

function cardinal (input) {
  if (input === null || typeof input === 'undefined') return input
  const num = Number(input);
  if (!isFinite(num)) return null
  return numWords.toWords(num, { useCommas: false })
}

function ordinal (input) {
  if (input === null || typeof input === 'undefined') return input
  const num = Number(input);
  if (!isFinite(num)) return null
  return numWords.toWordsOrdinal(num, { useCommas: false })
}

function ordsuffix (input) {
  if (input === null || typeof input === 'undefined') return input
  if (typeof input !== 'number') input = Number(input);
  if (!isFinite(input)) return null
  // English-language exception for 11th, 12th, 13th, 111th, 112th, 113th, 211th, 212th, 213th, etc.
  if (~~(input % 100 / 10) === 1) return 'th'
  switch (input % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function else_filter (input, unansweredFmt) {
  if (input === null || typeof input === 'undefined') return unansweredFmt
  if (typeof input === 'number') {
    if (!isFinite(input)) return unansweredFmt
  }
  return input
}
else_filter.ident = 'else'; // canonical name for normalization

function contains (input, value) {
  if (input === null || typeof input === 'undefined' || input === '') return false
  const inputPrimitive = input.valueOf();
  if (typeof inputPrimitive === 'string') {
    return inputPrimitive.includes(value)
  }
  // if (input instanceof Scope) throw new Error('Unexpected scope as contains input')
  if (!isIterable(input)) return false
  value = value && value.valueOf();
  for (const item of input) {
    if (deepEqual(item && item.valueOf(), value)) {
      return true
    }
  }
  return false
}

function punc (inputList, example = '1, 2, and 3') {
  if (!inputList) return inputList
  // if (inputList instanceof Scope) throw new Error('Unexpected scope as punc input')
  if (!inputList || !Array.isArray(inputList) || !inputList.length) return inputList
  const parsed = parseListExample(example);
  if (parsed) {
    // inputList may be the actual source array (the context stack has not yet been pushed!)
    // so make a shallow copy before adding any custom properties onto the array
    inputList = [...inputList];
    inputList['punc'] = parsed;
  }
  return inputList
}

function keepsections (input) {
  if (!input) return input
  if (typeof input !== 'object') return input
  const newInput = input.valueOf();
  if (newInput && (!newInput.contentType || newInput.contentType === 'docx')) {
    newInput.KeepSections = true;
  } else {
    console.log('keepsections filter used on something other than a DOCX insert/indirect');
  }
  return newInput
}

// runtime implementation of list filters:

function sort (array, parentScope) {
  if (!Array.isArray(array) || !array.length || arguments.length < 2) return array
  const sortBy = [];
  let i = 2;
  while (i < arguments.length) {
    // TODO: what is argument at this point?
    const sortKeyLambda = arguments[i++];
    sortBy.push({
      descending: sortKeyLambda.descending,
      evaluator: sortKeyLambda
    });
  }
  function compare (a, b, depth) {
    if (!depth) {
      depth = 0;
    }
    if (depth >= sortBy.length) { return 0 }
    const valA = sortBy[depth].evaluator(a, a); // sort expressions must only refer to stuff in the current list item
    const valB = sortBy[depth].evaluator(b, b);
    if (valA < valB) { return sortBy[depth].descending ? 1 : -1 }
    if (valA > valB) { return sortBy[depth].descending ? -1 : 1 }
    return compare(a, b, depth + 1)
  }
  return array.slice().sort(compare)
}
sort.listFilter = true;
sort.keyFilter = true;

function filter (array, parentScope, predicate) {
  if (!array || !array.length) return array
  return callArrayFunc(Array.prototype.filter, array, parentScope, predicate, 'filter')
}
filter.listFilter = true;

function find (array, parentScope, predicate) {
  if (!array || !array.length) return null
  return callArrayFunc(Array.prototype.find, array, parentScope, predicate, 'find')
}
find.listFilter = true;

function any (array, parentScope, predicate) {
  if (!array || !array.length) return false
  return callArrayFunc(Array.prototype.some, array, parentScope, predicate, 'any')
}
any.aliases = ['some'];
any.ident = 'any'; // canonical name for normalization
any.listFilter = true;
any.rtlFilter = true;

function every (array, parentScope, predicate) {
  if (!array || !array.length) return true
  return callArrayFunc(Array.prototype.every, array, parentScope, predicate, 'every')
}
every.aliases = ['all'];
every.ident = 'every'; // canonical name for normalization
every.listFilter = true;
every.rtlFilter = true;

function map (array, parentScope, mapLambda) {
  return callArrayFunc(Array.prototype.map, array, parentScope, mapLambda, 'map')
}
map.listFilter = true;

function group (array, parentScope, groupLambda) {
  if (!Array.isArray(array) || arguments.length < 2) {
    return array
  }
  if (array.length === 0) return []
  const grouped = array.reduce(
    (result, item, index) => {
      /* const key = lScope.evaluate(groupLambda).toString() */
      let key = groupLambda(parentScope.ps(item, index, array.length));
      key = key && key.valueOf(); // ensure wrapped primitives and dates are unwrapped too
      let bucket = result.find(b => b._key === key);
      if (!bucket) {
        bucket = { _key: key, _values: [] };
        result.push(bucket);
      }
      bucket._values.push(item);
      return result
    },
    []
  );
  return grouped
}
group.listFilter = true;

function reduce (array, parentScope, reducerLambda, initValue = undefined) {
  if (!Array.isArray(array) || arguments.length < 2) {
    return array
  }
  if (array.length === 0) return initValue
  const input0 = array[0];
  const yobj0 = input0 && input0.__yobj;
  Scope.pushList(array, yobj0 && yobj0.getParentEffective());
  const reduced = array.items.reduce(
    (result, item, index) => {
      if (index === 0 && initValue === undefined) {
        return item
      } // else
      const reducerItemFrame = parentScope.ps(item, index, array.length);
      reducerItemFrame._result = result;
      return reducerLambda(reducerItemFrame)
    },
    initValue
  );
  return reduced
}
reduce.listFilter = true;
// reduce.immediateArgs = [1]

// helper functions

function callArrayFunc (func, array, parentScope, predicateLambda, funcName) {
  if (!array) return array
  // if (array instanceof Scope) throw new Error('Unexpected scope as list filter input')
  if (!Array.isArray(array) || arguments.length < 2) {
    return array // maybe we should throw instead...
  }
  if (typeof predicateLambda !== 'function') {
    let filter = 'a list';
    if (funcName) {
      filter = 'the ' + funcName;
    }
    throw new Error(`Invalid argument passed to ${filter} filter: ${predicateLambda}`)
  }

  const result = func.call(array, (item, index) => (
    predicateLambda(parentScope.ps(item, index, array.length))
  ));
  // const result = func.call(array, (item) => evaluator(item.scopeProxy))
  return result
}

// legacy field types
const OD = {
  Content: 'Content',
  If: 'If',
  ElseIf: 'ElseIf',
  Else: 'Else',
  EndIf: 'EndIf',
  List: 'List',
  EndList: 'EndList'
};

function toContentArray (ast, subs = false, isElseIf = false) {
  switch (ast.type) {
    case AST.Program:
    case AST.TemplateBlock:
      return ast.body.map(elem => toContentArray(elem))
    case AST.TemplateElement:
      return ast.text
    case AST.ContentField:
      return legacyNode({
        type: OD.Content,
        expr: AST.serialize(ast.expression),
        id: ast.fieldNum,
      })
    case AST.ConditionalField: {
      const contentArray = [].concat(toContentArray(ast.consequent));
      let endArray = contentArray;
      if (ast.alternate) {
        if (ast.alternate.type === AST.ConditionalField) {
          contentArray.push(toContentArray(ast.alternate, false, true));
        } else {
          contentArray.push(legacyNode({
            type: OD.Else,
            id: ast.altFieldNum,
            contentArray: (endArray = [].concat(toContentArray(ast.alternate))),
          }));
        }
      }
      if (ast.endFieldNum) {
        endArray.push(legacyNode({
          type: OD.EndIf,
          id: ast.endFieldNum,
        }));
      }
      return legacyNode({
        type: isElseIf ? OD.ElseIf : OD.If,
        expr: AST.serialize(ast.test),
        id: ast.fieldNum,
        contentArray,
      })
    }
    case AST.ListField: {
      const contentArray = [].concat(toContentArray(ast.content));
      contentArray.push(legacyNode({
        type: OD.EndList,
        id: ast.endFieldNum,
      }));
      return legacyNode({
        type: OD.List,
        expr: AST.serialize(ast.expression),
        id: ast.fieldNum,
        contentArray,
      })
    }
    default:
      throw new Error(`Unsupported node type '${ast.type}'`)
  }
}

function legacyNode (obj) {
  const result = {
    type: obj.type
  };
  if (typeof obj.expr === 'string') result.expr = obj.expr;
  if (obj.id) result.id = String(obj.id);
  if (obj.contentArray) result.contentArray = obj.contentArray;
  return result
}

class LogicTreeImporter {
  constructor (tinql) {
    this.tinql = tinql;
  }

  arrayToBlock (nodeArray, type) {
    if (nodeArray.length === 1 && type === AST.TemplateBlock) {
      // block is unnecessary when length === 1
      return this.nodeToAst(nodeArray[0])
    }
    const body = nodeArray.map(node => this.nodeToAst(node));
    return {
      type,
      body,
    }
  }
  
  nodeToAst (node) {
    switch (node.type) {
      case OD.Content:
        return this.contentField(node)
      case OD.If:
        return this.conditionalBlock(node)
      case OD.List:
        return this.listBlock(node)
    }
  }
  
  contentField (node) {
    const result = {
      type: AST.ContentField,
      expression: this.tinql.parseExpression(node.expr),
    };
    if (node.id) {
      result.fieldNum = node.id;
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName;
    }
    return result
  }

  conditionalBlock (node) {
    const lastChild = node.contentArray.length > 0 && node.contentArray[node.contentArray.length - 1];
    let consequent, alternate;
    if (lastChild && (lastChild.type === OD.Else || lastChild.type === OD.ElseIf)) {
      consequent = this.arrayToBlock(node.contentArray.slice(0,-1), AST.TemplateBlock);
      alternate = lastChild.type === OD.ElseIf
        ? this.conditionalBlock(lastChild)
        : this.arrayToBlock(lastChild.contentArray, AST.TemplateBlock);
    } else {
      consequent = this.arrayToBlock(node.contentArray, AST.TemplateBlock);
      alternate = null;
    }
    const result = {
      type: AST.ConditionalField,
      test: this.tinql.parseExpression(node.expr),
      consequent,
      alternate,
    };
    if (node.id) {
      result.fieldNum = node.id;
      // result.endFieldNum = ?
    }
    if (alternate && lastChild.id) {
      result.altFieldNum = lastChild.id;
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName;
    }
    return result
  }

  listBlock (node) {
    const content = this.arrayToBlock(node.contentArray, AST.TemplateBlock);
    const result = {
      type: AST.ListField,
      expression: this.tinql.parseExpression(node.expr),
      content,
    };
    if (node.id) {
      result.fieldNum = node.id;
      //result.endFieldNum = ?
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName;
    }
    return result
  }

}

// this code is carried over from Yatte. Its original purpose was to do some low-hanging optimizations of parsed
// templates, for example removing redundant content fields to make the logical structure of the template more
// clear. As it turns out this probably doesn't do nearly as much as we were hoping, but it's something so I've
// brought it over to TINQ for now.

function extractLogic (ast) {
  // returns a 'logic tree' for this template --
  // a filtered, optimized AST representing the logical structure of the template
  const legacyBody = toContentArray(ast);
  return buildLogicTree(legacyBody)
}

function buildLogicTree (astBody) {
  // return a copy of astBody with all (or at least some) logically insignificant nodes pruned out:
  // remove plain text nodes (non-dynamic)
  // remove EndIf and EndList nodes
  // remove Content nodes that are already defined in the same logical/list scope
  // always process down all if branches & lists
  // ~~~strip field ID metadata (for docx templates) since it no longer applies
  // ~~~ revised: leave it in so we know more about error location
  const copy = reduceContentArray(astBody);
  simplifyContentArray2(copy);
  simplifyContentArray3(copy);
  return copy
}

function reduceContentArray (astBody, newBody = null, scope = null, parentScope = null) {
  // prune plain text nodes (non-dynamic, so they don't affect logic)
  // prune EndIf and EndList nodes (only important insofar as we need to match up nodes to fields --
  //   which will not be the case with a reduced logic tree)
  // prune redundant Content nodes that are already defined in the same logical & list scope
  // always process down all if branches & lists
  //    but mark check whether each if expression is the first (in its scope) to refer to the expression,
  //    and if so, indicate it on the node
  // future: compare logical & list scopes of each item, and eliminate logical branches
  //    and list iterations that are redundant
  if (newBody === null) newBody = [];
  if (scope === null) scope = {};
  for (const obj of astBody) {
    const newObj = reduceContentNode(obj, scope, parentScope);
    if (newObj !== null) {
      newBody.push(newObj);
    }
  }
  return newBody
}

function reduceContentNode (astNode, scope, parentScope = null) {
  if (typeof astNode === 'string') return null // plain text node -- boilerplate content in a text template
  if (astNode.type === OD.EndList) {
    // can we find the matching List field, to set its .endid = astNode.id before returning?
    return null
  }
  if (astNode.type === OD.EndIf) {
    // can we find the initial matching If field (not ElseIf or Else), to set its .endid = astNode.id before returning?
    return null
  }
  if (astNode.type === OD.Content) {
    if (!astNode.id && astNode.expr === '_punc') { // _punc nodes do not affect logic!
      return null
    }
    const existing = scope[astNode.expr];
    if (existing) { // expression already defined in this scope
      if (astNode.id && typeof existing === 'object') {
        const idd = existing.idd || (existing.idd = []);
        idd.push(astNode.id);
      }
      return null
    }
    const { /* id, */ ...copyOfNode } = astNode; // stopped stripping field id
    scope[astNode.expr] = copyOfNode;
    return copyOfNode
  }
  if (astNode.type === OD.List) {
    const existing = scope[astNode.expr];
    if (existing) {
      // this list has already been added to the parent scope; revisit it to add more content members if necessary
      reduceContentArray(astNode.contentArray, existing.contentArray, existing.scope);
      if (astNode.id) {
        const idd = existing.idd || (existing.idd = []);
        idd.push(astNode.id);
      }
      return null
    } else {
      const { /* id, */ contentArray, ...copyOfNode } = astNode; // stopped stripping the id
      copyOfNode.scope = {}; // fresh new wholly separate scope for lists
      copyOfNode.contentArray = reduceContentArray(contentArray, null, copyOfNode.scope);
      scope[astNode.expr] = copyOfNode; // set BEFORE recursion for consistent results?  (or is it intentionally after?)
      return copyOfNode
    }
  }
  if (astNode.type === OD.If || astNode.type === OD.ElseIf || astNode.type === OD.Else) {
    // if's are always left in at this point (because of their importance to the logic;
    // a lot more work would be required to accurately optimize them out.)
    // HOWEVER, we can't add the expr to the parent scope by virtue of it having been referenced in a condition,
    // because it means something different for the same expression to be evaluated
    // in a Content node vs. an If/ElseIf node, and therefore an expression emitted/evaluated as part of a condition
    // still needs to be emitted/evaluated as part of a merge/content node.
    // AND VICE VERSA: an expression emitted as part of a content node STILL needs to be emitted as part of a condition,
    // too.

    const { /* id, */ contentArray, ...copyOfNode } = astNode; // stopped stripping the id
    // this 'parentScope' thing is a bit tricky.  The parentScope argument is only supplied
    // when we're inside an If/ElseIf/Else block within the current scope.
    // If supplied, it INDIRECTLY refers to the actual scope -- basically, successive layers of "if" blocks
    // that each establish a new "mini" scope, that has the parent scope as its prototype.
    // This means, a reference to an identifier in a parent scope, will prevent that identifier from
    // subsequently appearing (redundantly) in a child; but a reference to an identifier in a child scope,
    // must NOT prevent that identifier from appearing subsequently in a parent scope.
    const pscope = (parentScope != null) ? parentScope : scope;
    if (copyOfNode.type === OD.If || copyOfNode.type === OD.ElseIf) {
      if (!(('if$' + astNode.expr) in pscope)) {
        pscope['if$' + astNode.expr] = copyOfNode;
      }
    }
    const childContext = Object.create(pscope);
    copyOfNode.contentArray = reduceContentArray(contentArray, null, childContext, pscope);
    return copyOfNode
  }
}

function simplifyContentArray2 (astBody) {
  // 2nd pass at simplifying logic
  // for now, just clean up scope helpers leftover from first pass
  for (const obj of astBody) {
    simplifyNode2(obj);
  }
}

function simplifyNode2 (astNode) {
  if (astNode.scope) { delete astNode.scope; }
  if (Array.isArray(astNode.contentArray)) { simplifyContentArray2(astNode.contentArray); }
}

function simplifyContentArray3 (body, scope = {}) {
  // 3rd pass at simplifying scopes
  const initialScope = { ...scope }; // shallow-clone the scope to start with
  // first go through content fields
  let i = 0;
  while (i < body.length) {
    const field = body[i];
    let nodeRemoved = false;
    if (field.type === OD.Content) {
      if (field.expr in scope) {
        if (field.id) {
          const existing = scope[field.expr];
          const idd = existing.idd || (existing.idd = []);
          idd.push(field.id);
        }
        body.splice(i, 1);
        nodeRemoved = true;
      } else {
        scope[field.expr] = field;
      }
    }
    if (!nodeRemoved) {
      i++;
    }
  }
  // then recurse into ifs and lists
  for (const field of body) {
    if (field.type === OD.List) {
      if (!(field.expr in scope)) {
        scope[field.expr] = field;
      }
      simplifyContentArray3(field.contentArray, {}); // new scope for lists
    } else if (field.type === OD.If) {
      // the content in an if block has everything in its parent scope
      simplifyContentArray3(field.contentArray, { ...scope }); // copy the parent scope
    } else if (field.type === OD.ElseIf || field.type === OD.Else) {
      // elseif and else fields are (in the logic tree) children of ifs,
      // but they do NOT have access to the parent scope, reset to initial scope for if
      simplifyContentArray3(field.contentArray, { ...initialScope });
    }
  }
  // note: although this will eliminate some redundant fields, it will not eliminate all of them.
  // A partial rewrite is planned to implement a new, more straight-forward approach.
}

class DataAggregator {
  constructor () {
    this.data = {};
    this.stack = [this.data];
  }

  empty () {
    return this.stack.length === 0
  }

  pushObject (ident) {
    const currentFrame = this.peek();
    let pushedObj;
    if (Array.isArray(currentFrame)) {
      currentFrame._ident = ident; // used for XML output and ignored for JSON
      pushedObj = currentFrame[currentFrame.index];
      if (!pushedObj) {
        pushedObj = currentFrame[currentFrame.index] = {};
      }
    } else {
      pushedObj = currentFrame[ident];
      if (!pushedObj) {
        pushedObj = currentFrame[ident] = {};
      }
    }
    this.push(pushedObj);
  }

  popObject () {
    const poppedFrame = this.pop();
    const currentFrame = this.peek();
    if (Array.isArray(currentFrame)) {
      currentFrame.index = currentFrame.index + 1;
    }
    return poppedFrame
  }

  pushList (ident) {
    const currentFrame = this.peek();
    let pushedArray;
    if (Array.isArray(currentFrame)) {
      throw new Error('Data aggregation error: Cannot push a list onto a list')
    } else {
      pushedArray = currentFrame[ident];
      if (!pushedArray) {
        pushedArray = currentFrame[ident] = [];
      }
      pushedArray.index = 0;
    }
    this.push(pushedArray);
  }

  popList () {
    const poppedFrame = this.pop();
    if (!Array.isArray(poppedFrame)) {
      throw new Error(`Data aggregation error: expected array frame, got ${typeof poppedFrame} instead`)
    }
    return poppedFrame
  }

  set (ident, value) {
    const currentFrame = this.peek();
    if (ident in currentFrame) {
      if ((currentFrame[ident] && currentFrame[ident].valueOf()) !== (value && value.valueOf())) {
        throw new Error('Data aggregation error: mutation?')
      }
    } else {
      currentFrame[ident] = value;
    }
  }

  push (frame) {
    this.stack.push(frame);
  }

  pop () {
    return this.stack.pop()
  }

  peek () {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null
  }

  toJson () {
    return JSON.stringify(this.data, (key, value) => {
      if (value instanceof ExternalBinary) {
        const { scope, assembler, ...orig } = value;
        if (assembler && !orig.data) {
          orig.data = assembler.data.data;
        }
        return orig
      } // else
      return value
    })
  }

  toXml (elementName) {
    return '<?xml version="1.0"?>' + this.serializeXmlElement(elementName, this.data)
  }

  serializeXmlElement (ident, value) {
    if (value === '' || value === null || value === undefined /* || (Array.isArray(value) && value.length === 0) */) {
      return `<${ident}/>`
    } // else
    return `<${ident}>${this.serializeXmlValue(value)}</${ident}>`
  }

  serializeXmlValue (value) {
    const valueType = Array.isArray(value.valueOf()) ? 'array' : isDate(value) ? 'date' : typeof value.valueOf();
    switch (valueType) {
      case 'string':
        return escapeXml(value)
      case 'date':
        return dateFormat(value) // 'yyyy-MM-dd')
      case 'number':
        return value.toString()
      case 'boolean':
        return value ? 'true' : 'false'
      case 'object':
        return this.serializeXmlObject(value)
      case 'array': {
        const itemIdent = value._ident;
        return value.map(item => this.serializeXmlElement(itemIdent, item)).join('')
      }
    }
  }

  serializeXmlObject (obj) {
    if (obj instanceof ExternalBinary) {
      let uri = `oxpt://DocumentAssembler/insert/${obj.id}`;
      if (obj.KeepSections) {
        uri += '?KeepSections=true';
      }
      return uri
    } // else
    var sb = [];
    for (var key in obj) {
      sb.push(this.serializeXmlElement(key, obj[key]));
    }
    return sb.join('')
  }
}

const escapeXml = function (str) {
  str = str.valueOf();
  if (typeof str !== 'string') {
    console.log(`Unexpected: while aggregating, escapeXml called on a ${typeof str}!`);
    str = str.toString();
  }
  return str.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '\'': return '&apos;'
      case '"': return '&quot;'
    }
  })
};

class DataExtractor {
  constructor () {
    this.filters = GetFilter;
    this.indirects = [];
    this.missing = {};
    this.errors = [];
    this.data = new DataAggregator();
  }

  assembleData (ast, scope) {
    let evaluator = this.compile(ast);
    evaluator(pushScope(scope));
    return this.data
  }

  compile (ast) {
    const self = this;
    if (ast) {
      findConstantExpressions(ast, self.filters);
    }
    let fn = self.recurse(ast);
    fn.ast = ast;
    if (ast) {
      fn.literal = isLiteral(ast);
      fn.constant = isConstant(ast);
    }
    return fn
  }

  recurse (ast, contextOut) {
    if (!ast) return noop
    const self = this;
    let key, expr, left, right, args, obj, expression;
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        args = ast.body.map(elem => self.recurse(elem));
        return function template_block (scope) {
          return args
            .map(fn => fn(scope))
            .join('')
        }
      case AST.ContentField:
        expr = AST.serialize(ast.expression);
        key = ast.key || expr;
        right = this.recurse(ast.expression);
        return function content_field (scope) {
          self._setContent(key, right(scope), expr, ast.expression);
        }
      case AST.ConditionalField:
        expr = AST.serialize(ast.test);
        key = ast.key ? ast.key + 'b' : expr + '_BOOL';
        expression = this.recurse(ast.test);
        left = this.recurse(ast.consequent);
        right = ast.alternate && this.recurse(ast.alternate);
        return function conditional_field (scope, assign, inputs) {
          const testValue = expression(scope, assign, inputs);
          if (self._setCondition(key, testValue)) {
            left(scope, assign, inputs);
          } else if (right) {
            right(scope, assign, inputs);
          }
        }
      case AST.ListField:
        expr = AST.serialize(ast.expression);
        obj = {};
        expression = this.recurse(ast.expression, obj);
        right = this.recurse(ast.content); // in essence a lambda
        return function list_field (scope) {
          const exprListValue = expression(scope);
          const listAtom = ast.key || expr;
          self._startList(listAtom);
          if (exprListValue) {
            const itemAtom = ast.key ? ast.key + 'i' : expr + '_ITEM';
            const puncAtom = ast.key ? ast.key + 'p' : expr + '_PUNC';
            exprListValue.forEach((item, index) => {
              const itemScope = obj.context.ps(item, index, exprListValue.length, exprListValue.punc);
              self._startListItem(itemAtom);
              right.call(undefined, itemScope);
              self._endListItem(puncAtom, itemScope._punc);
            });
          }
          self._endList(listAtom);
        }
      case AST.Literal:
        return () => ast.value
      case AST.UnaryExpression:
        right = this.recurse(ast.argument);
        return function unary_op (scope, assign, inputs) {
          let result = right(scope, assign, inputs);
          if (ast.operator === '!') return !result
          if (isDefined(result)) return ast.operator === '-' ? -result : +result
          return 0
        }
      case AST.BinaryExpression:
        left = this.recurse(ast.left);
        right = this.recurse(ast.right);
        return function binary_op (scope, assign, inputs) {
          const lhs = left(scope, assign, inputs);
          const rhs = right(scope, assign, inputs);
          switch (ast.operator) {
            case '+': return plusFn(lhs, rhs)
            case '-': return (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0)
            case '*': return lhs * rhs
            case '/': return lhs / rhs
            case '%': return lhs % rhs
            case '===': return lhs === rhs
            case '!==': return lhs !== rhs
            case '==': return lhs == rhs
            case '!=': return lhs != rhs
            case '<': return lhs < rhs
            case '>': return lhs > rhs
            case '<=': return lhs <= rhs
            case '>=': return lhs >= rhs
          }
        }
      case AST.LogicalExpression:
        left = this.recurse(ast.left);
        right = this.recurse(ast.right);
        return function logical_op (scope, assign, inputs) {
          const lhs = left(scope, assign, inputs);
          switch (ast.operator) {
            case '&&': return lhs && right(scope, assign, inputs)
            case '||': return lhs || right(scope, assign, inputs)
          }
        }
      case AST.ConditionalExpression:
        expression = this.recurse(ast.test);
        left = this.recurse(ast.consequent);
        right = this.recurse(ast.alternate);
        return function ternary_op (scope, assign, inputs) {
          return expression(scope, assign, inputs)
            ? left(scope, assign, inputs)
            : right(scope, assign, inputs)
        }
      case AST.Identifier:
        if (self.stage === 'inputs') throw "error: this has been broken for inputs"
        return function identifier_ (scope, assign, inputs) {
          const c = pushScope(scope);
          let base, value;
          if (contextOut) {
            base = c.lookupScope(ast.name, ast.ns);
            value = base.getOwnVal(ast.name);
          } else {
            value = c.lookupVal(ast.name, ast.ns);
          }
          if (contextOut) {
            contextOut.context = base;
            contextOut.name = ast.name;
          }
          return value
        }
      case AST.MemberExpression:
        obj = {}; // we need context info for the object
        left = this.recurse(ast.object, obj);
        if (ast.computed) {
          right = this.recurse(ast.property);
          return function member_computed (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs);
            let value;
            let rhs = right(scope, assign, inputs);
            rhs = getStringValue(rhs);
            if (contextOut) {
              contextOut.context = obj.context;
              contextOut.name = rhs;
              contextOut.computed = true;
            }
            if (isScope(lhs)) {
              value = lhs.getOwnVal(rhs);
              if (contextOut) {
                contextOut.object = value;
              }
            } else { // should be primitive or array
              value = lhs && lhs[rhs];
              if (contextOut) {
                contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs;
                if (!isNaN(rhs)) { // numeric index into array; avoid losing scope chain!
                  if (Array.isArray(lhs)) {
                    value = pushScope(obj.context).ps(value, rhs, lhs.length, lhs.punc);
                  } else {
                    value = pushScope(obj.context).ps(value, rhs, 0);
                  }
                }
              }
            }
            return value
          }
        } else { // !ast.computed
          const propName = ast.property.name;
          return function member_named (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs); // alert: lhs can be a Scope IF left is a computed member expression!
            if (!obj.context) throw "what to do?" // maybe base = pushScope(lhs)??
            // handle special case for _parent identifier, whose value is already a scope!
            const base = obj.name === '_parent' ? lhs : obj.context.ps(lhs);
            const value = base.getOwnVal(propName);
            if (contextOut) {
              contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs; // contextOut.object should not be a Scope
              contextOut.context = base;
              contextOut.computed = false;
              contextOut.name = propName;
            }
            return value
          }
        }
      case AST.CallExpression:
        obj = {}; // callee contextual info
        args = [];
        right = this.recurse(ast.callee, obj); // 2nd arg=={} means we are requesting the result's context
          // as well as its value. If the result is a function to be called, its context is the object ON WHICH
          // that function should be called)... and Knackly uses this ALL THE TIME, whenever (e.g.)
          // someone calls prototype methods on text strings, numbers, etc.
          // This is so the function can ultimately be invoked with "this" referring to the right thing
          // (see `rhs.value.apply(rhs.context, values)` below)
        ast.arguments.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function call_expr (scope, assign, inputs) {
          const rhs = right(scope, assign, inputs);
          let value;
          if (rhs != null) {
            const argValues = args.map(arg => arg(scope, assign, inputs));
            value = rhs.apply(obj.context.valueOf(), argValues);
          }
          return value
        }
      case AST.FilterExpression:
        right = this.filters(ast.filter.name);
        // Filters are implemented as functions, retrieved from this.filters().
        // These functions expect the first argument to be the INPUT to the filter.
        // ARGUMENTS to the filter (if any) are passed as SUBSEQUENT arguments to this function. 
        args = []; // (for the filter function to be called)
        obj = ast.lambda ? {} : undefined; // for list filters, we need the filter input's context!
        args.push(self.recurse(ast.input, obj));
        ast.arguments.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function filter_expr (scope, assign, inputs) {
          const argValues = [];
          args.forEach((arg, i) => {
            const result = arg(scope, assign, inputs);
            argValues.push(result);
            if (i === 0 && obj) { // list filter functions get the parent context as the 2nd argument!
              argValues.push(obj.context || pushScope(null)); // must have a context, even if null
            }
          });
          const value = right.apply(undefined, argValues, inputs); // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
          if (contextOut) {
            contextOut.context = pushScope(scope);
          }
          return value
        }
      case AST.LambdaExpression:
        right = self.recurse(ast.expression);
        return function lambda_expr () { return right }
      case AST.SortKeyExpression:
        right = self.recurse(ast.key);
        if (ast.descending) {
          right.descending = true;
        }
        return function sort_key () { return right }
      case AST.ArrayExpression:
        args = [];
        ast.elements.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function array_expr (scope, assign, inputs) {
          return args.map(arg => arg(scope, assign, inputs))
        }
      case AST.ObjectExpression:
        args = [];
        ast.properties.forEach(property => {
          if (property.computed) {
            args.push({
              key: self.recurse(property.key),
              computed: true,
              value: self.recurse(property.value),
            });
          } else {
            args.push({
              key: property.key.type === AST.Identifier ? property.key.name : "" + property.key.value,
              computed: false,
              value: self.recurse(property.value),
            });
          }
        });
        return function object_expr (scope, assign, inputs) {
          const value = {};
          for (const arg of args) {
            if (arg.computed) {
              value[arg.key(scope, assign, inputs)] = arg.value(scope, assign, inputs);
            } else {
              value[arg.key] = arg.value(scope, assign, inputs);
            }
          }
          return value
        }
      case AST.ThisExpression:
        return function this_expr (scope) {
          const c = pushScope(scope);
          if (contextOut) {
            contextOut.context = c._parent;
          }
          return c.getOwnVal()
        }
    }
  }

  _setContent (ident, value, expr, ast) {
    if (value === null || typeof value === 'undefined') {
      this.missing[expr] = true;
      value = this._missingValuePlaceholder(expr, ast);
    } else if (typeof value === 'object') {
      if (value instanceof ExternalBinary) {
        this.data.set(ident, this._indirectLookup(value));
        return
      } else if (value.errors || value.missing) {
        // value is a yatte EvaluationResult, probably because of nested template evaluation
        if (value.missing && value.missing.length > 0) {
          value.missing.forEach((expr) => { this.missing[expr] = true; });
        }
        if (value.errors && value.errors.length > 0) {
          value.errors.forEach((errmsg) => { this.errors.push(errmsg); });
        }
        value = value.valueOf(); // get the actual evaluated value
      }
    }
    if (value === '') {
      this.data.set(ident, undefined);
    } else if (typeof value === 'object') { // setContent should only be used to output simple scalar values
      this.data.set(ident, value.toString()); // probably bad input; convert to a string representation
    } else {
      this.data.set(ident, value);
    }
  }

  _indirectLookup (indirObj) {
    // see if this indirect has already been encountered/added
    let indirect = this.indirects.find(ex => ex.isEqualTo(indirObj));
    if (!indirect) {
      indirect = new ExternalBinary(indirObj); // { ...indirObj, id: uuidv4() }
      indirect.id = uuid.v4();
      this.indirects.push(indirect);
    }
    return indirect
  }

  _setCondition (ident, value) {
    const bValue = isTruthy(value);
    this.data.set(ident, bValue);
    return bValue
  }

  _startList (listIdent) {
    // begin list context:
    this.data.pushList(listIdent);
  }

  _startListItem (itemIdent) {
    // begin child object context -- individual item in a list context
    this.data.pushObject(itemIdent);
  }

  _endListItem (puncIdent, punc) {
    // set the list punctuation
    this._setContent(puncIdent, punc);
    // end object context
    this.data.popObject();
  }

  _endList (listIdent) {
    // end list context:
    this.data.popList();
  }

  _missingValuePlaceholder (expr, ast) {
    if (ast && ast.type === AST.FilterExpression && !ast.lambda) {
      return this._missingValuePlaceholder(AST.serialize(ast.input), ast.input)
    }
    return '[' + expr + ']'
  }
}

const defaultOptions = {
	interpreter: false, // true uses interpreter instead of compiler
	includeLocation: false, // true includes character location metadata in AST
};

const untypedDefault = {
	name: '*',
	type: '*',
	properties: [{ name: '*', type: '*', isList: '*' }],
	functions: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
	filters: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
};

const filterAliases = {};
// initialize filterAliases
for (const name in filters) {
	const func = filters[name];
	if (func && func.aliases) {
		func.aliases.forEach(alias => {
			filterAliases[alias] = func;
		});
	}
}
function GetFilter (name) {
	return filters[name] || filterAliases[name]
}

class Tinq {
	constructor (options = {}, typeDefs = [untypedDefault]) {
		this.options = { ...defaultOptions };
		for (const prop of Object.keys(options)) {
			this.options[prop] = options[prop];
		}
		const typeDict = this.typeDict = {};
		typeDefs.forEach(typeDef => typeDict[typeDef.name] = typeDef);
		this.expressioner = new ExpressionParser(GetFilter, { includeLocation: this.options.includeLocation });
		this.templater = new TemplateParser(this.expressioner);
		this.astCompiler = this.options.interpreter
			? new ASTInterpreter(GetFilter)
			: new ASTCompiler(GetFilter);

		/**
		 * A cache containing all compiled functions. The src is used as key.
		 * Set this to false to disable the cache.
		 *
		 * @type {object}
		 */
		this.cache = createMap();
	}

	/**
	 * Lexes and parses src and returns an AST.
	 *
	 * @param {string} src
	 * @returns {object}
	 */
	parseExpression (src) {
		if (typeof src !== "string") {
			throw new TypeError(`src must be a string; instead saw '${typeof src}'`)
		}
		const ast = this.expressioner.ast(src);
		return ast
	}

	parseTemplate (src) {
		if (typeof src !== "string") {
			throw new TypeError(`src must be a string; instead saw '${typeof src}'`)
		}
		const ast = this.templater.ast(src);
		return ast
	}

	extractTemplateLogic (src) {
		let ast;
		if (typeof src === 'string') {
			ast = this.parseTemplate(src);
		} else if (src && typeof src === 'object') {
			ast = src;
		} else {
			throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
		}
		return extractLogic(ast)
	}

	extractData (logicTree, scope) {
		const importer = new LogicTreeImporter(this);
		const ast = importer.arrayToBlock(logicTree, AST.Program);
		// now we can try to use it to extract the necessary data from a data context:
		const extractor = new DataExtractor();
		const result = extractor.assembleData(ast, scope);
		return result
	}

	compileExpression (src) {
		let func = this.cache && this.cache[src];
		if (!func) {
			let ast;
			if (typeof src === 'string') {
				ast = this.parseExpression(src);
			} else if (src && typeof src === 'object') {
				ast = src;
			} else {
				throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
			}
			func = this.compile(ast);
			if (func) {
				func.normalized = AST.serialize(ast);
			}
			if (this.cache) {
				this.cache[src] = func;
				if (src !== func.normalized) {
					this.cache[func.normalized] = func;
				}
			}
		}
		return func
	}

	compileTemplate (src) {
		let ast;
		if (typeof src === 'string') {
			ast = this.parseTemplate(src);
		} else if (src && typeof src === 'object') {
			ast = src;
		} else {
			throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
		}
		return this.compile(ast)
	}

	/**
	 * Compiles ast and returns a function that executes ast on a target object.
	 * The compiled function is cached under compile.cache[src] to speed up further calls.
	 *
	 * @param {string} src
	 * @returns {function}
	 */
	compile (ast) {
		if (typeof ast !== 'object') {
			throw new TypeError("ast must be an already-parsed AST object; instead saw '" + typeof ast + "'")
		}
		let func = this.astCompiler.compile(ast);
		return func
	}
}

exports.AST = AST;
exports.EnumerationScope = EnumerationScope;
exports.ExpressionParser = ExpressionParser;
exports.ExternalBinary = ExternalBinary;
exports.GetFilter = GetFilter;
exports.Scope = Scope$1;
exports.TemplateParser = TemplateParser;
exports.Tinq = Tinq;
