import { Tinq } from '../src/index.mjs'
import { useScope as use } from '../src/scope.mjs'
import chai from 'chai'
var expect = chai.expect

chai.config.includeStack = true;

var testPhases = ['interpreter', 'compiler']

describe("tinq", function() {
	describe(".parseExpression", function() {
		it("should be a function", function() {
			expect(Tinq).to.be.a("function") // class actually? can we easily test for that?
		})

		it("should provide a .compile()-method", function() {
			var tinq = new Tinq()
			expect(tinq.compileExpression).to.be.a("function")
		})
	})

	testPhases.forEach(phase => {
		const options = { interpreter: (phase === 'interpreter') }

		describe(phase, function() {
			var scope;
			var evaluate;
			var tinq = new Tinq(options)
	
			beforeEach(function() {
				scope = {
					ship: {
						pirate: {
							name: "Jenny"
						}
					}
				};
			});
	
			it("should return a function", function() {
				var c = tinq.compileExpression("")
				expect(c).to.be.a("function");
			});
	
			it("should throw an error if the given value is not a string", function() {
				expect(function() {
					tinq.compileExpression();
				}).to.throw("src must be a string or AST object; instead saw 'undefined'");
			});
	
			it("should expose the ast", function() {
				expect(tinq.compileExpression("tmp").ast).to.be.a("object");
			});
	
			describe("when evaluating literals", function() {
				it("should return null", function() {
					evaluate = tinq.compileExpression("null");
					expect(evaluate(scope)).to.equal(null);
				});
	
				it("should return true", function() {
					evaluate = tinq.compileExpression("true");
					expect(evaluate(scope)).to.equal(true);
				});
	
				it("should return false", function() {
					evaluate = tinq.compileExpression("false");
					expect(evaluate(scope)).to.equal(false);
				});
	
				it("should return 2.34e5", function() {
					evaluate = tinq.compileExpression("2.34e5");
					expect(evaluate(scope)).to.equal(2.34e5);
				});
	
				it("should return 'string'", function() {
					evaluate = tinq.compileExpression("'string'");
					expect(evaluate(scope)).to.equal("string");
				});
	
				it("should return [ship, 1, 2, []]", function() {
					evaluate = tinq.compileExpression("[ship, 1, 2, []]");
					expect(evaluate(scope)).to.eql([scope.ship, 1, 2, []]);
				});
	
				it("should return { test: 'value', 'new-object': {} }", function() {
					evaluate = tinq.compileExpression("{ test: 'value', 'new-object': {} }");
					expect(evaluate(scope)).to.eql({ test: "value", "new-object": {} });
				});
	
				it("should return context value when nothing in the scope", function() {
					evaluate = tinq.compileExpression("test");
					expect(evaluate(use(scope).pushScope({ test: "hello" }))).to.equal("hello");
				});
	
				it("should return context value when something in the scope", function() {
					evaluate = tinq.compileExpression("test");
					expect(evaluate(use({ test: "bye" }).pushScope({ test: "hello" }))).to.equal("hello");
				});
			});
	
			describe("when evaluating simple key look-ups", function() {
				it("should return the value if its defined on scope", function() {
					evaluate = tinq.compileExpression("ship");
					expect(evaluate(scope)).to.equal(scope.ship);
				});
	
				it("should return undefined instead of throwing a ReferenceError if it's not defined on scope", function() {
					evaluate = tinq.compileExpression("notDefined");
					expect(evaluate(scope)).to.equal(undefined);
				});
	
				it("should return the scope even when the 'this' keyword is used", function() {
					evaluate = tinq.compileExpression("this");
					expect(evaluate(scope)).to.equal(scope);
				});
			});
	
			describe("when evaluating simple assignments", function() {
				it("should set the new value on scope", function() {
					evaluate = tinq.compileExpression("newValue = 'new'");
					evaluate(scope);
					expect(scope.newValue).to.equal("new");
				});
	
				it("should change the value if its defined on scope", function() {
					evaluate = tinq.compileExpression("ship = 'ship'");
					evaluate(scope);
					expect(scope.ship).to.equal("ship");
				});
			});
	
			describe("when evaluating dot-notated loop-ups", function() {
				it("should return the value if its defined on scope", function() {
					evaluate = tinq.compileExpression("ship.pirate.name");
					expect(evaluate(scope)).to.equal("Jenny");
				});
	
				it("should return undefined instead of throwing a ReferenceError if it's not defined on scope", function() {
					evaluate = tinq.compileExpression("island.pirate.name");
					expect(evaluate(scope)).to.equal(undefined);
				});
			});
	
			describe("when evaluating dot-notated assignments", function() {
				it("should set the new value on scope", function() {
					evaluate = tinq.compileExpression("island.pirate.name = 'Störtebeker'");
					evaluate(scope);
					expect(scope.island.pirate.name).to.equal("Störtebeker");
				});
	
				it("should change the value if its defined on scope", function() {
					evaluate = tinq.compileExpression("ship.pirate.name = 'Störtebeker'");
					evaluate(scope);
					expect(scope.ship.pirate.name).to.equal("Störtebeker");
				});
			});
	
			describe("when evaluating array look-ups", function() {
				beforeEach(function() {
					scope.ships = [{ pirate: "Jenny" }, { pirate: "Störtebeker" }];
				});
	
				it("should return the value if its defined on scope", function() {
					evaluate = tinq.compileExpression("ships[1].pirate");
					expect(evaluate(scope)).to.equal("Störtebeker");
				});
	
				it("should return undefined instead of throwing a ReferenceError if it's not defined on scope", function() {
					evaluate = tinq.compileExpression("ships[2].pirate");
					expect(evaluate(scope)).to.equal(undefined);
				});
			});
	
			describe("when evaluating array assignments", function() {
				it("should change the value if its defined on scope", function() {
					scope.ships = [{ pirate: "Jenny" }];
					evaluate = tinq.compileExpression("ships[0].pirate = 'Störtebeker'");
					evaluate(scope);
					expect(scope.ships[0].pirate).to.equal("Störtebeker");
				});
			});
	
			describe("when evaluating function calls", function() {
				describe("using no arguments", function() {
					it("should return the function's return value", function() {
						scope.findPirate = function() {
							return scope.ship.pirate;
						};
	
						evaluate = tinq.compileExpression("findPirate()");
						expect(evaluate(scope)).to.equal(scope.ship.pirate);
					});
	
					it("should call the function on the scope", function() {
						scope.returnThis = function() {
							return this;
						};
						evaluate = tinq.compileExpression("returnThis()");
						expect(evaluate(scope)).to.equal(scope);
					});
	
					it("should call the function on the object where it is defined", function() {
						scope.ship.returnThis = function() {
							return this;
						};
						evaluate = tinq.compileExpression("ship.returnThis()");
						expect(evaluate(scope)).to.equal(scope.ship);
					});
				});
	
				describe("using arguments", function() {
					it("should parse the arguments accordingly", function() {
						scope.findPirate = function() {
							return Array.prototype.slice.call(arguments);
						};
						evaluate = tinq.compileExpression("findPirate(ship.pirate, 1, [2, 3])");
						expect(evaluate(scope)).to.eql([scope.ship.pirate, 1, [2, 3]]);
					});
				});
			});
	
			describe("when evaluating operators", function() {
				it("should return the expected result when using +", function() {
					evaluate = tinq.compileExpression("1 + 1");
					expect(evaluate()).to.equal(2);
				});
	
				it("should return the expected result when using -", function() {
					evaluate = tinq.compileExpression("1 - 1");
					expect(evaluate()).to.equal(0);
				});
	
				it("should return the expected result when using *", function() {
					evaluate = tinq.compileExpression("2 * 2");
					expect(evaluate()).to.equal(4);
				});
	
				it("should return the expected result when using /", function() {
					evaluate = tinq.compileExpression("4 / 2");
					expect(evaluate()).to.equal(2);
				});
	
				it("should return the expected result when using %", function() {
					evaluate = tinq.compileExpression("3 % 2");
					expect(evaluate()).to.equal(1);
				});
	
				it("should return the expected result when using &&", function() {
					evaluate = tinq.compileExpression("true && true");
					expect(evaluate()).to.equal(true);
					evaluate = tinq.compileExpression("true && false");
					expect(evaluate()).to.equal(false);
					evaluate = tinq.compileExpression("false && false");
					expect(evaluate()).to.equal(false);
				});
	
				it("should return the expected result when using ||", function() {
					evaluate = tinq.compileExpression("true || true");
					expect(evaluate()).to.equal(true);
					evaluate = tinq.compileExpression("true || false");
					expect(evaluate()).to.equal(true);
					evaluate = tinq.compileExpression("false || false");
					expect(evaluate()).to.equal(false);
				});
	
				it("should return the expected result when using !", function() {
					evaluate = tinq.compileExpression("!true");
					expect(evaluate()).to.equal(false);
					evaluate = tinq.compileExpression("!false");
					expect(evaluate()).to.equal(true);
				});
	
				/* Ooops, angular doesn't support ++. Maybe someday?
							it("should return the expected result when using ++", function () {
									scope.value = 2;
									evaluate = compiler.compile("value++");
									expect(evaluate()).to.equal(3);
									expect(scope.value).to.equal(3);
							});*/
	
				/* Ooops, angular doesn't support --. Maybe someday?
							it("should return the expected result when using --", function () {
									scope.value = 2;
									evaluate = compiler.compile("value--");
									expect(evaluate()).to.equal(1);
									expect(scope.value).to.equal(1);
							});*/
	
				it("should return the expected result when using ?", function() {
					evaluate = tinq.compileExpression("true? 'it works' : false");
					expect(evaluate()).to.equal("it works");
					evaluate = tinq.compileExpression("false? false : 'it works'");
					expect(evaluate()).to.equal("it works");
				});
			});
	
			describe("using complex expressions", function() {
				beforeEach(function() {
					scope.ships = [
						{
							pirate: function(str) {
								return str;
							}
						},
						{
							pirate: function(str) {
								return str;
							}
						}
					];
					scope.index = 0;
					scope.pi = "pi";
					scope.Jenny = "Jenny";
				});
	
				it("should still be parseable and executable", function() {
					evaluate = tinq.compileExpression("ships[index][pi + 'rate'](Jenny)");
					expect(evaluate(scope)).to.equal("Jenny")
				})

				it("should handle deeply nested contexts", function () {
					evaluate = tinq.compileExpression("bogus[0].NotExist.Bogus2")
					expect(evaluate(scope)).to.equal(undefined)
				})

				!options.interpreter && it("should not contain redundant chunks of compiled code", function () {
					evaluate = tinq.compileExpression("a.b.c + a.b.d")
					const str = evaluate.toString()
					expect(str.split('.lookupScope(').length).to.equal(2) // only one scope lookup for a
					expect(str.split('.getOwnScope(').length).to.equal(2) // only one child scope for b
					expect(str.split('.getOwnValue(').length).to.equal(3) // one child value EACH for c & d
				})
			});
	
			describe("when evaluating syntactical errors", function() {
				it("should give a readable error message", function() {
					expect(function() {
						tinq.compileExpression("'unterminated string");
					}).to.throw(
						"Lexer Error: Unterminated quote at columns 0-20 ['unterminated string] in expression ['unterminated string]."
					);
				});
	
				it("should give a readable error message", function() {
					expect(function() {
						tinq.compileExpression("3 = 4");
					}).to.throw(
						'Trying to assign a value to a non l-value'
					);
				});
			});
	
			describe("when using filters", function() {
				it("should apply the given filter", function() {
					evaluate = tinq.compileExpression('1.2345 | format:"000.00"');
					expect(
						evaluate({})
					).to.equal("001.23");
				});
			});
	
			describe("when using list filters", function() {
				it("should apply the filter filter", function() {
					evaluate = tinq.compileExpression('[1,2,3,4] | filter: this > 1');
					expect(
						evaluate({})
					).to.deep.equal([2,3,4]);
				});
				it("should apply the sort filter", function() {
					evaluate = tinq.compileExpression('[3,1,4,1,5,9] | sort: this');
					expect(
						evaluate({})
					).to.deep.equal([1,1,3,4,5,9]);
				});
				it("should apply the descending sort filter", function() {
					evaluate = tinq.compileExpression('[3,1,4,1,5,9] | sort: -this');
					expect(
						evaluate({})
					).to.deep.equal([9,5,4,3,1,1]);
				});
				it("should apply the sort filter with multiple mixed keys", function() {
					evaluate = tinq.compileExpression('[{a:"A",b:2},{a:"A",b:1},{a:"A",b:3},{a:"B",b:3},{a:"B",b:1},{a:"B",b:2}] | sort:-a:b');
					expect(
						evaluate({})
					).to.deep.equal([{a:"B",b:1},{a:"B",b:2},{a:"B",b:3},{a:"A",b:1},{a:"A",b:2},{a:"A",b:3}])
				});
			});
	
			describe("when evaluating the same expression multiple times", function() {
				it("should cache the generated function", function() {
					expect(tinq.compileExpression("a")).to.equal(tinq.compileExpression("a"));
				});
			});
	
			// describe("for assigning values", function() {
			// 	beforeEach(function() {
			// 		scope = {};
			// 	});
	
			// 	it("should expose an 'assign'-function", function() {
			// 		var fn = compiler.compile("a");
	
			// 		expect(fn.assign).to.be.a("function");
			// 		fn.assign(scope, 123);
			// 		expect(scope.a).to.equal(123);
			// 	});
	
			// 	describe("the 'assign'-function", function() {
			// 		it("should work for expressions ending with brackets", function() {
			// 			var fn = compiler.compile("a.b['c']");
	
			// 			fn.assign(scope, 123);
			// 			expect(scope.a.b.c).to.equal(123);
			// 		});
	
			// 		it("should work for expressions with brackets in the middle", function() {
			// 			var fn = compiler.compile('a["b"].c');
	
			// 			fn.assign(scope, 123);
			// 			expect(scope.a.b.c).to.equal(123);
			// 		});
	
			// 		it("should return the result of the assignment", function() {
			// 			var fn = compiler.compile('a["b"].c');
	
			// 			expect(fn.assign(scope, 123)).to.equal(123);
			// 		});
			// 	});
			// });
	
			describe(".cache", function() {
				it("should be an object by default", function() {
					expect(tinq.cache).to.be.an("object");
				});
	
				it("should cache the generated function by the expression", function() {
					var fn = tinq.compileExpression("a");
	
					expect(tinq.cache.a).to.equal(fn);
				});
	
				describe("when setting it to false", function() {
					it("should disable the cache", function() {
						tinq.cache = false;
						expect(tinq.compileExpression("a")).to.not.equal(tinq.compileExpression("a"));
						tinq.cache = Object.create(null);
					});
				});
			});
		});
	})
})
