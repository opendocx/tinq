'use strict';

require('node:assert');
var equal = require('fast-deep-equal');
var dateFns = require('date-fns');
var numeral = require('numeral');
var numWords = require('number-to-words-en');
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
				+ (ast.alternate
				  ? ast.alternate.type === AST.ConditionalField
					  ? '{[elseif ' + serializeAstNode(ast.alternate.test, subs) + ']}' + serializeAstNode(ast.alternate.consequent)
						: '{[else]}' + serializeAstNode(ast.alternate, subs) + '{[endif]}'
					: '{[endif]}'
        )
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

const primitiveConstructors = [String, Number, Boolean, Date, Function];

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
	if (value && isIterable(value)) {
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

function isIterable (obj) {
	// checks for null and undefined; also strings (though iterable) should not be iterable *contexts*
	if (obj == null || isPrimitive(obj)) {
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

function useScope (valueOrScope) {
	return valueOrScope instanceof Scope ? valueOrScope : scopeFactory.createScope(valueOrScope)
}

class Scope {
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
        if (value.constructor && primitiveConstructors.includes(value.constructor)) {
          vt = value.constructor.name.toLowerCase();
        } else if (Array.isArray(value)) {
          vt = 'array';
          this.length = value.length;
          this.punc = value.punc;
        }
      }
    }
    this.type = vt;
    this.isPrimitive = (vt !== 'object' && vt !== 'array');
    if (parentScope && !(parentScope instanceof Scope)) {
        throw new Error('parentScope is not an instance of scope!')
    }
    this._parent = parentScope || null;
  }

  pushScope (value) {
    if (value instanceof Scope) {
      if (value._parent === this) {
        return value // looks okay, it's a no-op
      }
      throw new Error('Cannot reuse conflicting Scope. What are you trying to do?')
    }
    return scopeFactory.createScope(value, this)
  }
  
  lookupBase (ident, baseTypeName) {
    let base = this;
    if (baseTypeName) { // use only type name to find correct scope
      while (base && (base.typename !== baseTypeName)) base = base._parent;
    } else { // when not specified, just look for presence of ident (fall-back to top of stack if not found)
      while (base && !base.hasOwnValue(ident)) base = base._parent;
      if (!base) base = this; // if we are searching purely on name (no types), fall back to "this" (local scope)
    }
    return base // may be undefined if baseTypeName was provided but not found (== bug in caller's code)
  }

  lookupScope (ident, baseTypeName) { // this gets called at compile-time to resolve an identifier INCL CONTEXT
    const base = this.lookupBase(ident, baseTypeName);
    return base
      ? base.getOwnScope(ident)
      : scopeFactory.createScope(null) // identifier not found; return null scope (?)
  }

  lookupValue (ident, baseTypeName) { // this gets called at compile-time to resolve an identifier WITHOUT CONTEXT
    const base = this.lookupBase(ident, baseTypeName);
    return base && base.getOwnValue(ident)
  }

  getOwnScope (ident) { // == old lookupScope + getOwnValue + pushScope
    Scope.validateIdent(ident, this.type);
    if (!isNaN(ident)) { // ident is numeric -- array index
      return scopeFactory.createEnumScope(this._parent, this.value && this.value[ident], +ident, this.length, this.punc)
    }
    if (ident === '_parent') return this._parent // special case
    // else normal use case -- ident is alphanumeric identifier
    const result = scopeFactory.createScope(this.getOwnValue(ident), this);
    result.name = ident;
    return result
  }

  forEachScope (enumScopeFunc) {
    if (this.type !== 'array') {
      throw new Error('forEachScope called on non-array')
    }
    let i = 0;
    while (i < this.length) {
      enumScopeFunc(this.getOwnScope(i));
      i++;
    }
  }

  hasOwnValue (ident) {
    if (ident && ident.startsWith('_')) {
      if (ident in this) return true // _parent, _index0 etc. are on this, but _key, _values (for grouping) are on this.value
    }
    if (this.type === 'null') return false
    if (!ident) return true
    if (typeof this.value === 'object') return (ident in this.value)
    return Boolean(this.value[ident])
  }

  getOwnValue (ident) {
    if (!ident) return this.value
    if (ident.startsWith('_') && (ident in this)) {
      return ident === '_parent'
        ? this._parent && this._parent.valueOf()
        : this[ident]
    }
    if (this.type === 'null') return undefined
    let result = this.value[ident];
    if (typeof result === 'function' && result.ast) {
      result = result.apply(undefined, [this]);
      // the following would cause all text-based ExternalFiles to auto-compose, but we don't want this here.
      // if (result instanceof ExternalFile && typeof result.data !== 'object') {
      //   result = result.data
      // }
    }
    return result
  }

  setOwnValue (ident, value, ns) {
    this.value[ident] = value;
  }

  root () {
    return this._parent ? this._parent.root() : this
  }

  isNull () {
    return this.value == null
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

  static validateIdent (ident, type) {
    const t = typeof ident;
    if (t !== 'string' && t !== 'number') throw new Error(`received a ${t} instead of an identifier`)
    if (isNaN(ident)) { // alphanumeric identifier
      if (!ident) throw new Error('Identifier required')
    } else { // ident is numeric -- array index
      if (type !== 'array' && type !== 'null') {
        throw new Error(`Requested numeric element of ${type} (non-array)`)
      }
    }
  }
}

class EnumerationScope extends Scope {
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

// An instance of ExternalFile represents an external file or BLOB that
// (1) TINQ does not know how to create (hence "External"... TINQ only does text)
// (2) CAN be created dynamically by some other, (again) external, code
// (3) needs data from inside TINQ's scope to produce this external file
// (4) (optionally) needs to composite this external output with other output ALSO being created by TINQ
class ExternalFile {
  constructor (template, data, fileName) {
    this.template = template;
    if (fileName) {
      this.name = fileName;
    }
    if (data || !('data' in this)) {
      this.data = data;
    }
  }

  isEqualTo (that) {
    // compare the things that potentially make a difference in output: the template metadata
    // (as provided by the caller) and the data requested by that template's logic
    return equal(that.template, this.template) && equal(that.data, this.data)
  }

  toString () {
    // When an ExternalFile is encountered during (synchronous) text-based assembly,
    // it is converted to a string (by adding "") to retrieve a text representation.
    return this.data + ''
    // In (async) docx-based assembly, encountering an indirect causes a special
    // placeholder to be inserted so the resulting files can be composed later.
  }
}

class ScopeFactory {
  constructor() {
    this.ScopeClass = Scope;
    this.EnumScopeClass = EnumerationScope;
  }

  registerScopeClass (derivedScopeClass) {
    this.ScopeClass = derivedScopeClass;
  }

  registerEnumScopeClass (derivedScopeClass) {
    this.EnumScopeClass = derivedScopeClass;
  }

  createScope (value, parentScope) {
    const ScopeConstructor = this.ScopeClass;
    return new ScopeConstructor(value, parentScope)
  }

  createEnumScope (parent, item, index0, count, punc) {
    const EnumScopeConstructor = this.EnumScopeClass;
    return new EnumScopeConstructor(parent, item, index0, count, punc)
  }
}

const scopeFactory = new ScopeFactory();

class ASTInterpreterBase {
  constructor () {
    this.filters = GetFilter;
  }

  compile (ast) {
    if (ast) {
      findConstantExpressions(ast, this.filters);
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
    let fn = this.recurse(ast);
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

  recurse (ast, wantScope, create) {
    if (!ast) return noop
    const self = this;
    let left, right, args, expression, key;
    // if (ast.winput) {
    // 	return this.inputs(ast.winput, ast.watchId)
    // }
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        args = ast.body.map(elem => self.recurse(elem));
        return function template_block (scope) {
          return self.templateBlock(args, scope)
        }
      case AST.TemplateElement:
        return () => self.templateElement(ast.text)
      case AST.ContentField:
        key = this.fieldKey(ast);
        right = this.recurse(ast.expression);
        return function content_field (scope) {
          return self.contentField(right, scope, key, ast.expression)
        }
      case AST.ConditionalField:
        key = this.fieldKey(ast, 'b');
        expression = this.recurse(ast.test);
        left = this.recurse(ast.consequent);
        right = ast.alternate && this.recurse(ast.alternate);
        return function conditional_field (scope) {
          return self.conditionalField(expression, left, right, scope, key)
        }
      case AST.ListField:
        key = this.fieldKey(ast, 'i');
        expression = this.recurse(ast.expression, true);
        right = this.recurse(ast.content);
        return function list_field (scope) {
          return self.listField(expression, right, scope, key)
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
          const c = useScope(scope);
          let value;
          if (wantScope || (create && create !== 1)) {
            value = c.lookupScope(ast.name, ast.ns);
            if (create && create !== 1) {
              if (value.isNull() && value._parent) {
                value._parent.setOwnValue(ast.name, {}, ast.ns);
                value = wantScope
                  ? value._parent.getOwnScope(ast.name)
                  : value._parent.getOwnValue(ast.name);
              }
            }
          } else {
            value = c.lookupValue(ast.name, ast.ns);
          }
          return value
        }
      case AST.MemberExpression:
        left = this.recurse(ast.object, true, !!create);
        if (ast.computed) {
          right = this.recurse(ast.property);
          return function member_computed (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs);
            const rhs = right(scope, assign, inputs);
            if (create && create !== 1) {
              if (lhs.getOwnValue(rhs) == null) {
                lhs.setOwnValue(rhs, {});
              }
            }
            return wantScope
              ? lhs.getOwnScope(rhs)
              : lhs.getOwnValue(rhs)
          }
        } else { // !ast.computed
          const propName = ast.property.name;
          return function member_named (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs);
            if (create && create !== 1) { // when create===1 that means we're called by an assignment so no need to create
              if (lhs.getOwnValue(propName) == null) {
                lhs.setOwnValue(propName, {});
              }
            }
            return wantScope
              ? lhs.getOwnScope(propName)
              : lhs.getOwnValue(propName)
          }
        }
      case AST.CallExpression:
        args = [];
        right = this.recurse(ast.callee, true); // request scope because we need BOTH the callee function AND the object/context on which it is called, if any. (see .valueOf() and ._parent.valueOf() below)
        ast.arguments.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function call_expr (scope, assign, inputs) {
          const rhs = right(scope, assign, inputs);
          let value;
          if (rhs != null) {
            const argValues = args.map(arg => arg(scope, assign, inputs));
            value = rhs.valueOf().apply(rhs._parent.valueOf(), argValues);
          }
          return wantScope
            ? useScope(scope).pushScope(value)
            : value
        }
      case AST.FilterExpression:
        right = this.filters(ast.filter.name);
        // Filters are implemented as functions, retrieved from this.filters().
        // These functions expect the first argument to be the INPUT to the filter.
        // ARGUMENTS to the filter (if any) are passed as SUBSEQUENT arguments to this function. 
        args = []; // (for the filter function to be called)
        args.push(self.recurse(ast.input, ast.lambda)); // for list filters, we need the filter input's context!
        ast.arguments.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function filter_expr (scope, assign, inputs) {
          const argValues = args.map(arg => arg(scope, assign, inputs));
          const value = right.apply(undefined, argValues, inputs); // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
          return wantScope
            ? useScope(scope).pushScope(value)
            : value
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
        left = this.recurse(ast.left, true, 1);
        right = this.recurse(ast.right);
        return function assign_expr (scope, assign, inputs) {
          const lhs = left(scope, assign, inputs); // need to call because this is what actually determines context!
          if (lhs._parent && lhs.name) {
            const rhs = right(scope, assign, inputs);
            lhs._parent.setOwnValue(lhs.name, rhs, ast.ns);
            // todo: shouldn't we be checking contextOut here and returning a scope if requested?
            return lhs._parent.getOwnValue(lhs.name) // should === rhs but just to be sure
          }
        }
      case AST.ArrayExpression:
        args = [];
        ast.elements.forEach(expr => {
          args.push(self.recurse(expr));
        });
        return function array_expr (scope, assign, inputs) {
          const value = args.map(arg => arg(scope, assign, inputs));
          return wantScope
            ? useScope(scope).pushScope(value)
            : value
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
              key: property.key.type === AST.Identifier ? property.key.name : property.key.value + '',
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
          return wantScope
            ? scope.pushScope(value)
             : value
        }
      case AST.ThisExpression:
        return function this_expr (scope) {
          const c = useScope(scope);
          return wantScope
            ? c
            : c.valueOf()
        }
      case AST.NGValueParameter:
        return function (scope, assign) {
          return assign
        }
    }
  }

  fieldKey (ast, suffix) {}

  templateBlock (elemFns, scope) {
    return elemFns.map(fn => fn(scope))
  }

  templateElement (text) {
    return text
  }

  contentField (valueFn, scope, key, ast) {
    return valueFn(scope)
  }

  conditionalField (testFn, consequentFn, alternateFn, scope, key) {
    if (testFn(scope)) {
      return consequentFn(scope)
    } else if (alternateFn) {
      return alternateFn(scope)
    }
  }

  listField (listFn, lambdaContentFn, scope, key) {
    const listValue = listFn(scope);
    if (listValue && listValue.length) {
      const results = [];
      listValue.forEachScope(enumScope => {
        results.push(lambdaContentFn.call(undefined, enumScope));
      });
      return results
    }
  }

  // inputs (input, watchId) {
  // 	return function (scope, value, inputs) {
  // 		if (inputs) return inputs[watchId]
  // 		return input(scope, value)
  // 	}
  // }
}

class ASTInterpreter extends ASTInterpreterBase {
  // just a few function overrides to ensure text templates are composited correctly:

  templateBlock (elemFns, scope) {
    return super.templateBlock(elemFns, scope).join('')
  }

	contentField (valueFn, scope) {
		return super.contentField(valueFn, scope) + '' // convert to string
	}

	listField (listFn, lambdaContentFn, scope) {
    return super.listField(listFn, lambdaContentFn, scope).join('')
	}
}

const stringEscapeRegex = /[^ a-zA-Z0-9]/g;
const USE = "use";
const STRICT = "strict";

class ASTCompiler {
  constructor (filters) {
    this.filters = filters;
  }

  compile (ast) {
    this.state = {
      nextId: 0,
      filters: {},
      fn: { vars: [], body: [], own: {} },
      assign: { vars: [], body: [], own: {} },
      inputs: []
    };
    let extra = '';
    if (ast) {
      findConstantExpressions(ast, this.filters);
      this.stage = "lambdas";
      let index = 0;
      for (const lnode of FindLambdas(ast)) {
        const lkey = 'lambda' + ++index;
        lnode._lkey = lkey;
        this.state[lkey] = { vars: [], body: [], own: {} };
        this.state.computing = lkey;
        // pre-processing for each lambda
        let rnode, init;
        if (lnode.type === AST.SortKeyExpression) rnode = lnode.key;
        else if (lnode.type === AST.LambdaExpression) rnode = lnode.expression;
        else { // it's a content block inside a list field
          rnode = lnode;
          init = '[]';
        }
        const lid = this.nextId(false, init);
        this.recurse(rnode, lid);
        this.return_(lid);
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
    append(fns, `"${USE} ${STRICT}"`);
    append(fns, this.filterPrefix());
    append(fns, `var fn=${this.generateFunction("fn", "s,a,i")}`);
    append(fns, extra);
    append(fns, this.watchFns());
    append(fns, 'return fn');
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'flt',
      'ifd',
      'pls',
      'use',
      fns.join('\n') // last argument to Function() is function body; each prior is an argument name
    )(this.filters, ifDefined, plusFn, useScope);

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
      result.push(`var ${name}=${self.generateFunction(name, 's')}`);
    });
    if (fns.length) {
      result.push(`fn.inputs=[${fns.join(',')}];`);
    }
    return result.join('')
  }

  generateFunction (name, params) {
    return `function(${params}){${this.varsPrefix(name)}${this.funcBody(name)}}`
  }

  filterPrefix () {
    const parts = [];
    for (const [filter, id] of Object.entries(this.state.filters)) {
      parts.push(id + '=flt(' + escape(filter) + ')');
    }
    if (parts.length) return `var ${parts.join(',')};`
    return ''
  }

  varsPrefix (section) {
    return this.state[section].vars.length
      ? `var ${this.state[section].vars.join(',')};`
      : ''
  }

  funcBody (section) {
    return this.state[section].body.join('')
  }

  /**
   * transpiles the given ast node into JavaScript code that can execute in the browser or NodeJS
   * 
   * @param {object} ast node
   * @param {string} intoId id of the variable (in the target code) in which the result of the current operation should
   *                        be stored
   * @param {object?} wantScope if the current operation needs to return a Scope object rather than a regular value
   * @param {*} returnFn for all expressions and sub-expressions that ultimately compile down to strings (containing
   *                        JavaScript), this callback (if specified) is invoked as the last thing after that
   *                        compilation is complete. Not currently called for template & field nodes.
   * @param {*} create 
   * @param {*} skipWatchIdCheck 
   * @returns void. The recurse method alters the state of this ASTCompiler instance, such that after the call to
   * recurse returns, the generateFunction() method can be used to finish the code generation.
   */
  recurse (ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck) {
    if (!ast) return // any need to call returnFn() here before returning, or will it always already be noop?
    const self = this;
    let left, right, args, expression, key;
    returnFn = returnFn || noop;
    if (!skipWatchIdCheck && isDefined(ast.watchId)) {
      intoId = intoId || this.nextId();
      this.if_(
        'i',
        this.lazyAssignId(intoId, computedMember('i', ast.watchId)),
        this.lazyRecurse(ast, intoId, wantScope, returnFn, create, true)
      );
      return
    }
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        intoId = intoId || this.nextId(false, '[]');
        ast.body.forEach(elem => self.recurse(elem, undefined, undefined, result => {
          self.pushElement(intoId, result);
        }));
        returnFn(this.assignId(intoId, intoId + '.join("")'));
        break
      case AST.TemplateElement:
        returnFn(escape(ast.text));
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
        self.recurse(ast.test, intoId, undefined, undefined, 'bool');
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
        expression = this.nextId(); // the list value itself
        this.recurse(ast.expression, expression, true); // get list value
        right = this.assignId(this.nextId(), this.generateFunction(ast.content._lkey, 's')); // list content lambda
        left = this.nextId(false, ''); // var to hold result of list concatenation
        this.if_(
          expression + '&&' + expression + '.length',
          () => {
            self.assignId(left, '[]');
            self.forEachScope(expression, left, right);
            self.assignId(left, left + '.join("")');
          }
        );
        returnFn(left);
        break
      case AST.Literal:
        expression = escape(ast.value);
        this.assignId(intoId, expression);
        returnFn(intoId || expression);
        break
      case AST.UnaryExpression:
        this.recurse(ast.argument, undefined, undefined, expr => {
          right = expr;
        });
        expression = ast.operator + '(' + if_Defined(right, 0) + ')'; // TODO: use precedence to determine whether parens are needed
        this.assignId(intoId, expression);
        returnFn(expression);
        break
      case AST.BinaryExpression:
        this.recurse(ast.left, undefined, undefined, expr => left = expr);
        this.recurse(ast.right, undefined, undefined, expr => right = expr);
        if (ast.operator === '+') {
          expression = plus_(left, right);
        } else if (ast.operator === '-') {
          expression = if_Defined(left, 0) + ast.operator + if_Defined(right, 0);
        } else {
          expression = '(' + left + ')' + ast.operator + '(' + right + ')'; // todo: use precedence to determine when parens are needed
        }
        this.assignId(intoId, expression);
        returnFn(expression);
        break
      case AST.LogicalExpression:
        intoId = intoId || this.nextId();
        this.recurse(ast.left, intoId);
        this.if_(
          ast.operator === '&&' ? intoId : not_(intoId),
          this.lazyRecurse(ast.right, intoId)
        );
        returnFn(intoId);
        break
      case AST.ConditionalExpression:
        intoId = intoId || this.nextId();
        this.recurse(ast.test, intoId);
        this.if_(
          intoId,
          this.lazyRecurse(ast.consequent, intoId),
          this.lazyRecurse(ast.alternate, intoId),
        );
        returnFn(intoId);
        break
      case AST.Identifier:
        if (this.stage === 'inputs') throw 'error: this has been broken for inputs'
        // get cache key for identifier (incl. whether wantScope is true/false), see if there's an existing id for it, and only create a new one if not
        key = getCacheKey(ast, wantScope, ckPrefix);
        if (this.getCacheId(key)) {
          if (intoId) {
            this.assignId(intoId, this.getCacheId(key));
          } else {
            intoId = this.getCacheId(key);
          }
        } else {
          intoId = intoId || this.nextId();
          if (wantScope || (create && create !== 1)) {
            this.assignId(intoId, this.lookupScope(ast.name, ast.ns));
            if (create && create !== 1) {
              this.if_(
                and_(scopeIsNull(intoId), getParentScope(intoId)),
                () => {
                  self.setOwnValue(getParentScope(intoId), ast.name, '{}', ast.ns);
                  self.assignId(intoId,
                    wantScope
                      ? getOwnScope(getParentScope(intoId), ast.name)
                      : getOwnValue(getParentScope(intoId), ast.name)
                  );
                }
              );
            }
          } else {
            this.assignId(intoId, self.lookupValue(ast.name, ast.ns));
          }
          this.setCacheId(key, intoId);
        }
        returnFn(intoId);
        break
      case AST.MemberExpression:
        // get cache key for entire member expression (incl. whether wantScope is true/false), see if there's an existing id for it, and only create a new one if not
        key = getCacheKey(ast, wantScope, ckPrefix);
        if (this.getCacheId(key)) {
          if (intoId) {
            this.assignId(intoId, this.getCacheId(key));
          } else {
            intoId = this.getCacheId(key);
          }
        } else {
          intoId = intoId || this.nextId(); // whole member expression will be stored here
          // once the object (left) side is handled (see below), this will handle the property (right) side:
          const memberContinuation = () => {
            if (ast.computed) {
              right = self.nextId();
              self.recurse(ast.property, right);
              if (create && create !== 1) {
                self.if_(
                  isNull(getOwnValueDyn(left, right)),
                  () => {
                    self.setOwnValueDyn(left, right, '{}', ast.ns);
                  },
                );
              }
              self.assignId(intoId, wantScope
                ? getOwnScopeDyn(left, right)
                : getOwnValueDyn(left, right)
              );
            } else { // !ast.computed
              const propName = ast.property.name;
              if (create && create !== 1) {
                self.if_(
                  isNull(getOwnValue(left, propName)),
                  () => {
                    self.setOwnValue(left, propName, '{}');
                  },
                );
              }
              self.assignId(intoId, wantScope
                ? getOwnScope(left, propName)
                : getOwnValue(left, propName)
              );
            }
            self.setCacheId(key, intoId);
            returnFn(intoId);
          };
          // handle left side, THEN invoke right side handler
          left = getCacheKey(ast.object, true);
          if (this.getCacheId(left)) {
            left = this.getCacheId(left);
            memberContinuation();
          } else {
            left = this.nextId(); // object scope will be stored here
            this.recurse(ast.object, left, true, memberContinuation, undefined, !!create);
          }
        }
        break
      case AST.CallExpression:
        intoId = intoId || this.nextId();
        right = self.nextId(); // callee value -- the function to be called (ident for globals, member expr for methods)
        args = [];
        self.recurse(ast.callee, right, true, function () {
          self.if_(
            notNull(right),
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
              expression = right + '.valueOf().call(' + getParentScope(right) + '.valueOf(),'
                + args.join(',') + ')';
              self.assignId(intoId, wantScope
                ? self.pushScope(expression)
                : expression
              );
            },
            function () {
              self.assignId(intoId, wantScope
                ? self.pushScope('null')
                : 'undefined'
              );
            }
          );
          returnFn(intoId);
        });
        break
      case AST.FilterExpression:
        intoId = intoId || this.nextId(); // holds the final result of the filter
        right = self.filter(ast.filter.name); // holds the filter function (to call)
        args = []; // strings (ids/source code) representing each argument to the filter function
        left = self.nextId(); // to hold the evaluated input to the filter
        self.recurse(ast.input, left, ast.lambda); // get the input
        // add the INPUT to the filter function's argument list...
        args.push(left);
        // add the rest of the filter's arguments to the filter function'd argument list
        ast.arguments.forEach(expr => {
          const argId = self.nextId();
          if (expr.type === AST.LambdaExpression || expr.type === AST.SortKeyExpression) {
            self.assignId(argId, self.generateFunction(expr._lkey, 's'));
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
        self.assignId(intoId, wantScope
          ? self.pushScope(expression)
          : expression
        );
        returnFn(intoId);
        break
      case AST.LambdaExpression:
      case AST.SortKeyExpression:
        // currently no-op; already handled earlier in lambda pass
        break
      case AST.AssignmentExpression:
        left = this.nextId();
        right = this.nextId();
        this.recurse(ast.left, left, true, () => {
          self.if_(
            and_(getParentScope(left), left + '.name'),
            () => {
              self.recurse(ast.right, right);
              self.setOwnValueDyn(getParentScope(left), left + '.name', right, ast.ns);
              self.assignId(intoId, getOwnValueDyn(getParentScope(left), left + '.name'));
            }
          );
          returnFn(intoId || right);
        }, undefined, 1);
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
        expression = '[' + args.join(',') + ']';
        if (wantScope) {
          expression = this.pushScope(expression);
        }
        this.assignId(intoId, expression);
        returnFn(intoId || expression);
        break
      case AST.ObjectExpression:
        args = [];
        if (ast.properties.some(property => property.computed)) {
          intoId = intoId || this.nextId();
          this.assignId(intoId, '{}');
          ast.properties.forEach(property => {
            if (property.computed) {
              left = self.nextId();
              self.recurse(property.key, left);
            } else {
              left = property.key.type === AST.Identifier ? property.key.name : property.key.value + '';
            }
            right = self.nextId();
            self.recurse(property.value, right);
            self.assignId(member(intoId, left, property.computed), right);
          });
        } else {
          ast.properties.forEach(property => {
            self.recurse(
              property.value,
              ast.constant ? undefined : self.nextId(),
              undefined,
              function (expr) {
                args.push(
                  escape(property.key.type === AST.Identifier ? property.key.name : property.key.value + '')
                    + ':' + expr
                );
              }
            );
          });
          expression = '{' + args.join(',') + '}';
          if (wantScope) {
            expression = this.pushScope(expression);
          }
          this.assignId(intoId, expression);
        }
        returnFn(intoId || expression);
        break
      case AST.ThisExpression:
        this.useScope();
        expression = wantScope
          ? 'c'
          : 'c.valueOf()';
        this.assignId(intoId, expression);
        returnFn(intoId || expression);
        break
      case AST.NGValueParameter:
        this.assignId(intoId, 'v');
        returnFn(intoId || 'v');
        break
    }
  }

  // getHasOwnProperty (element, property) {
  // 	const key = element + "." + property
  // 	const own = this.current().own
  // 	if (!own.hasOwnProperty(key)) {
  // 		own[key] = this.nextId(
  // 			false,
  // 			element + "&&(" + escape(property) + " in " + element + ")"
  // 		)
  // 	}
  // 	return own[key]
  // }

  hasCachedExpr (cacheKey) {
    return this.current().own.hasOwnProperty(cacheKey)
  }

  getCacheId (cacheKey) {
    const own = this.current().own;
    return own[cacheKey]
  }

  setCacheId (cacheKey, id) {
    const own = this.current().own;
    if (own[cacheKey]) throw new Error('cache key already has value set')
    own[cacheKey] = id;
  }

  useScope () {
    const own = this.current().own;
    if (!own.hasOwnProperty('_scope_')) {
      this.current().vars.unshift('c=use(s)');
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
    this.current().body.push(id, '=', value, ';');
    return id
  }

  pushElement (id, value) {
    if (!id) return
    this.current().body.push(id, '.push(', value, ');');
  }

  pushScope (expression) {
    this.useScope();
    return 'c.pushScope(' + expression + ')'
  }

  lookupScope (name, ns) {
    this.useScope();
    return 'c.lookupScope("' + name + (ns ? '","' + ns : '') + '")'
  }

  lookupValue (name, ns) {
    this.useScope();
    return 'c.lookupValue("' + name + (ns ? '","' + ns : '') + '")'
  }

  forEachScope (scopeId, accumulatorId, lambdaId) {
    const result = scopeId + '.forEachScope(es=>'
      + accumulatorId + '.push(' + lambdaId + '.call(undefined,es)))';
    this.current().body.push(result, ';');
  }

  setOwnValue (scopeId, name, value, ns) {
    return this.setOwnValueDyn(scopeId, '"' + name + '"', value, ns)
  }

  setOwnValueDyn (scopeId, id, value, ns) {
    this.current().body.push( // whoever actually pushes a command onto body is responsible for the ';':
      scopeId + '.setOwnValue(' + id + ',' + value + (ns ? ',"' + ns + '"' : '') + ');'
    );
  }

  filter (filterName) {
    if (!this.state.filters.hasOwnProperty(filterName)) {
      this.state.filters[filterName] = this.nextId(true);
    }
    return this.state.filters[filterName]
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
      body.push('if(', test, '){');
      consequentFn();
      body.push('}');
      if (alternateFn) {
        body.push('else{');
        alternateFn();
        body.push('}');
      }
    }
  }

  // "lazy" functions are just conveniences to curry calls to recurse and setValue,
  // used only in conjunction with _if() (which expects curried functions for its
  // consequentFn and alternateFn parameters).
  lazyRecurse (ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck) {
    const self = this;
    return function () {
      self.recurse(ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck);
    }
  }

  lazyAssignId (id, value) {
    const self = this;
    return function () {
      self.assignId(id, value);
    }
  }

  nextId (skip, init) {
    const id = 'v' + this.state.nextId++;
    if (!skip) {
      this.current().vars.push(id + (init ? '=' + init : ''));
    }
    return id
  }

  current () {
    return this.state[this.state.computing]
  }
}

function getCacheKey (ast, isScope, prefix) {
  return (prefix ? prefix + '::' : '') + (isScope ? 'scope::' : '') + AST.serialize(ast)
}

function getOwnScope (scopeId, name) {
  return getOwnScopeDyn(scopeId, '"' + name + '"')
}

function getOwnScopeDyn (scopeId, id) {
  return scopeId + '.getOwnScope(' + id + ')'
}

function getParentScope (scopeId) {
  return scopeId + '._parent'
}

function getOwnValue (scopeId, name) {
  return getOwnValueDyn(scopeId, '"' + name + '"')
}

function getOwnValueDyn (scopeId, id) {
  return scopeId + '.getOwnValue(' + id + ')'
}

function if_Defined (id, defaultValue) {
  return 'ifd(' + id + ',' + escape(defaultValue) + ')'
}

function plus_ (left, right) {
  return 'pls(' + left + ',' + right + ')'
}

function not_ (expression) {
  return '!(' + expression + ')'
}

function and_ (left, right, needParens = false) {
  return needParens
    ? `(${left})&&(${right})`
    : left + '&&' + right
}

function scopeIsNull (scopeId) {
  return scopeId + '.isNull()'
}

function isNull (expression) {
  return expression + '==null'
}

function notNull (expression) {
  return expression + '!=null'
}

function member (left, right, computed) {
  if (computed) return computedMember(left, right)
  return nonComputedMember(left, right)
}

function computedMember (left, right) {
  return left + '[' + right + ']'
}

function nonComputedMember (left, right) {
  const SAFE_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;
  const UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g;
  let expr = '';
  if (SAFE_IDENTIFIER.test(right)) {
    expr = left + '.' + right;
  } else {
    right = right.replace(UNSAFE_CHARACTERS, stringEscapeFn);
    expr = left + '["' + right + '"]';
  }
  return expr
}

function escape (value) {
  if (isString(value))
    return "'" + value.replace(stringEscapeRegex, stringEscapeFn) + "'"
  if (isNumber(value)) return value.toString()
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null) return 'null'
  if (typeof value === 'undefined') return 'undefined'
  throw new Error('IMPOSSIBLE')
}

function stringEscapeFn (c) {
  return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
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
    if (equal(item && item.valueOf(), value)) {
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

function sort (arrayScope) {
  if (arrayScope.type !== 'array') {
    throw new Error('sort filter requires an array scope')
  }
  const array = arrayScope.valueOf();
  if (!array.length || arguments.length < 2) return array
  const sortBy = [];
  let i = 1; // skip first (scope) argument; rest are sort keys
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
    const valA = sortBy[depth].evaluator(a); // sort expressions must only refer to stuff in the current list item
    const valB = sortBy[depth].evaluator(b);
    if (valA < valB) { return sortBy[depth].descending ? 1 : -1 }
    if (valA > valB) { return sortBy[depth].descending ? -1 : 1 }
    return compare(a, b, depth + 1)
  }
  return array.slice().sort(compare)
}
sort.listFilter = true;
sort.keyFilter = true;

function filter (arrayScope, predicate) {
  return callArrayFunc(Array.prototype.filter, arrayScope, predicate, 'filter')
}
filter.listFilter = true;

function find (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return null
  return callArrayFunc(Array.prototype.find, arrayScope, predicate, 'find')
}
find.listFilter = true;

function any (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return false
  return callArrayFunc(Array.prototype.some, arrayScope, predicate, 'any')
}
any.aliases = ['some'];
any.ident = 'any'; // canonical name for normalization
any.listFilter = true;
any.rtlFilter = true;

function every (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return true
  return callArrayFunc(Array.prototype.every, arrayScope, predicate, 'every')
}
every.aliases = ['all'];
every.ident = 'every'; // canonical name for normalization
every.listFilter = true;
every.rtlFilter = true;

function map (arrayScope, mapLambda) {
  return callArrayFunc(Array.prototype.map, arrayScope, mapLambda, 'map')
}
map.listFilter = true;

function group (arrayScope, groupLambda) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('group filter requires an array scope')
  }
  const array = arrayScope.valueOf();
  // const parentScope = arrayScope._parent
  let grouped;
  if (array.length === 0) {
    grouped = [];
  } else {
    grouped = array.reduce(
      (result, item, index) => {
        let key = groupLambda(arrayScope.getOwnScope(index));
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
  }
  return grouped
}
group.listFilter = true;

function reduce (arrayScope, reducerLambda, initValue = undefined) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('reduce filter requires an array scope')
  }
  const array = arrayScope.valueOf();
  // const parentScope = arrayScope._parent
  let reduced;
  if (array.length === 0) {
    reduced = initValue;
  } else {
    reduced = array.reduce(
      (result, item, index) => {
        if (index === 0 && initValue === undefined) {
          return item
        } // else
        const reducerItemFrame = arrayScope.getOwnScope(index);
        reducerItemFrame._result = result;
        return reducerLambda(reducerItemFrame)
      },
      initValue
    );
  }
  return reduced
}
reduce.listFilter = true;
// reduce.immediateArgs = [1]

// helper functions

// callArrayFunc accepts an "array scope" and returns a regular array
function callArrayFunc (func, arrayScope, predicateLambda, funcName) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('list filters require an array scope')
  }
  const array = arrayScope.valueOf();
  // const parentScope = arrayScope._parent
  if (!predicateLambda) {
    throw new Error('no predicate supplied to callArrayFunc')
  }
  if (typeof predicateLambda !== 'function') {
    let filter = 'a list';
    if (funcName) {
      filter = 'the ' + funcName;
    }
    throw new Error(`Invalid argument passed to ${filter} filter: ${predicateLambda}`)
  }
  const result = func.call(array, (item, index) => (
    predicateLambda(arrayScope.getOwnScope(index))
  ));
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
  constructor (tinq) {
    this.tinq = tinq;
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
      expression: this.tinq.parseExpression(node.expr),
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
      test: this.tinq.parseExpression(node.expr),
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
      expression: this.tinq.parseExpression(node.expr),
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

  toJson (composeTextExternals = false) {
    return JSON.stringify(this.data, (key, value) => {
      if (value instanceof ExternalFile) {
        if (typeof value.data === 'string' && composeTextExternals) {
          return value.data
        }
        let uri = `tinq://ExternalFile/${value.id}`;
        if (value.KeepSections) {
          uri += '?KeepSections=true';
        }
        return uri
      } // else
      return value
    })
  }

  toXml (elementName = 'top', composeTextExternals = false) {
    return '<?xml version="1.0"?>' + this.serializeXmlElement(elementName, this.data, composeTextExternals)
  }

  serializeXmlElement (ident, value, cte) {
    const name = validXmlNameRegex.test(ident) ? ident : encodeToValidXmlName(ident);
    if (value === '' || value === null || value === undefined /* || (Array.isArray(value) && value.length === 0) */) {
      return `<${name}/>`
    } // else
    return `<${name}>${this.serializeXmlValue(value, cte)}</${name}>`
  }

  serializeXmlValue (value, cte) {
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
        return this.serializeXmlObject(value, cte)
      case 'array': {
        const itemIdent = value._ident;
        return value.map(item => this.serializeXmlElement(itemIdent, item, cte)).join('')
      }
    }
  }

  serializeXmlObject (obj, cte) {
    if (obj instanceof ExternalFile) {
      if (typeof obj.data === 'string' && cte) {
        return obj.data
      } // else
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

const validXmlNameRegex = /^[a-zA-Z_][\w.-]*$/;

const encodeToValidXmlName = function (input) {
  return input.split('').map(char => {
    const code = char.charCodeAt(0);
    if ((code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122) || // a-z
        (code >= 48 && code <= 57) || // 0-9
        char === '.' || char === '-' || char === '_') {
      return char
    } else {
      return '_' + code.toString(16).toUpperCase()
    }
  }).join('')
};

class DataExtractor extends ASTInterpreterBase {
  constructor (externals = null) {
    super();
    this.externals = externals || []; // queue of ALL externals encountered in the extraction or its parents
    this.requires = []; // externals on which this extraction depends (directly)
    this.missing = {};
    this.errors = [];
    this.data = new DataAggregator();
  }

  assembleData (ast, scope, outputName = undefined) {
    let evaluator = this.compile(ast);
    evaluator(useScope(scope));
    delete this.data.stack;
    const wrapper = new ExternalFile(null, this.data, outputName);
    if (this.requires.length > 0) {
      wrapper.requires = this.requires.map(e => e.id);
    }
    return wrapper
  }

  fieldKey (ast, keyType) {
    let key = ast.key || AST.serialize(ast);
    if (keyType === 'b') {
      key += ast.key ? keyType : '_BOOL';
    } else if (keyType === 'i') {
      key = {
        list: key,
        item: key + (ast.key ? keyType : '_ITEM'),
        punc: key + (ast.key ? 'p' : '_PUNC'),
      };
    }
    return key
  }

  templateElement () {}

  contentField (valueFn, scope, key, ast) {
    this._setContent(key, valueFn(scope), ast);
  }

  _setContent (ident, value, ast) {
    if (value === null || typeof value === 'undefined') {
      if (ast) {
        const expr = AST.serialize(ast);
        this.missing[expr] = true;
        value = this._missingValuePlaceholder(expr, ast);
      }
    } else if (typeof value === 'object') {
      if (value instanceof ExternalFile) {
        this.data.set(ident, this._registerExternal(value));
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

  _lookupExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    return this.externals.find(ex => ex.isEqualTo(extFile))
  }

  _registerExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    let existing = this._lookupExternal(extFile);
    if (!existing) {
      extFile.id = uuid.v4(); // assign unique ID
      this.externals.push(extFile);
      existing = extFile;
    }
    if (!this.requires.includes(existing)) {
      this.requires.push(existing);
    }
    return existing
  }

  conditionalField (testFn, consequentFn, alternateFn, scope, key) {
    const testValue = testFn(scope);
    if (this._setCondition(key, testValue)) {
      consequentFn(scope);
    } else if (alternateFn) {
      alternateFn(scope);
    }
  }

  _setCondition (ident, value) {
    const bValue = isTruthy(value);
    this.data.set(ident, bValue);
    return bValue
  }

  listField (listFn, lambdaContentFn, scope, key) {
    const listScope = listFn(scope);
    this._startList(key.list);
    if (listScope.type === 'array') {
      listScope.forEachScope(itemScope => {
        this._startListItem(key.item);
        lambdaContentFn.call(undefined, itemScope);
        this._endListItem(key.punc, itemScope._punc);
      });
    }
    this._endList(key.list);
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

  extractTemplateLogic (src) { // accepts either a string or an already-parsed template AST
    let ast;
    if (typeof src === 'string') {
      ast = this.parseTemplate(src);
    } else if (src && typeof src === 'object') {
      ast = src;
    } else {
      throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
    }
    // HOWEVER, the first thing extractLogic() does is to convert the AST into a (legacy)
    // content array, which is then simplified using legacy code ported over from Yatte.
    const logicTree = extractLogic(ast);
    // Note that extractLogic is mostly legacy code ported over from Yatte.
    // The first thing it does is convert the given AST into a Yatte content array, and
    // it also returns a content array. HOWEVER, because those content arrays are more
    // condensed than TINQ ASTs, we're just returning it directly here rather than
    // converting it back.
    return logicTree
    // At some point we may consider cleaning this up by rewriting extractLogic to work directly
    // with Tinq's AST format. But for now, we use both.
  }

  logicToTemplateAst (logicTree) {
    const importer = new LogicTreeImporter(this);
    return importer.arrayToBlock(logicTree, AST.Program)
  }

  extractData (ast, scope, externals = undefined, outputName = undefined) { // accepts EITHER a TINQ AST or a Yatte-style logic tree
    if (Array.isArray(ast)) {
      ast = this.logicToTemplateAst(ast);
    } // (else _hopefully_ the ast is already simplified)
    // use the ast to extract the necessary data from a data context:
    const extractor = new DataExtractor(externals);
    const result = extractor.assembleData(ast, scope, outputName);
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

  compileExternal (templateInfo, ast, fileName = undefined) {
    let result, evaluateName;
    if (typeof fileName === 'string') {
      evaluateName = this.compileTemplate(fileName);
    }
    if (typeof ast === 'object') { // use AST to evaluate & extract data from scope
      result = scope => {
        // look up parentExternals in scope, create it if not there already
        scope = useScope(scope);
        const root = scope.root();
        const isDependant = Boolean(root.externals);
        const externals = isDependant ? root.externals : (root.externals = []);
        const extracted = this.extractData(ast, scope, externals,
          evaluateName && evaluateName(scope));
        extracted.template = templateInfo;
        if (isDependant) {
          return externals.find(ex => ex.isEqualTo(extracted)) || extracted
        } // else
        if (externals.length === 0) return extracted
        return [...externals, extracted]
      };
    } else if (typeof ast === 'string') { // AST is a template; evaluate that template to get its text result:
      const evaluate = this.compileTemplate(ast);
      result = scope => new ExternalFile(templateInfo, evaluate(scope),
        evaluateName && evaluateName(scope)); // and return that result as its own external
    }
    result.ast = true;
    // so when result is seen as a function during evaluation, it will be recognized as expecting the scope
    // as its parameter (and will therefore be called automatically, as we want it to be)
    return result
  }

  compileBatch (batchTemplate) {
    const evaluate = this.compileExternal('batch', typeof batchTemplate === 'object'
      ? batchTemplate
      : this.parseTemplate(batchTemplate)
    );
    const result = scope => {
      let interim = evaluate(scope);
      if (Array.isArray(interim)) {
        const batch = interim.pop();
        const index = interim.reduce((acc, curr) => {
          acc[curr.id] = curr;
          return acc
        }, {});
        batch.requires.forEach((id, idx) => index[id].outputOrder = idx + 1);
      } else {
        interim.outputOrder = 1;
        interim = [interim];
      }
      return interim
    };
    return result
  }
}

exports.AST = AST;
exports.EnumerationScope = EnumerationScope;
exports.ExpressionParser = ExpressionParser;
exports.ExternalFile = ExternalFile;
exports.GetFilter = GetFilter;
exports.Scope = Scope;
exports.TemplateParser = TemplateParser;
exports.Tinq = Tinq;
exports.scopeFactory = scopeFactory;
