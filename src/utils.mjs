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
