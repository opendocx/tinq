import { Lexer, Parser, Compiler } from '../src/index.mjs'
import chai from 'chai'
var expect = chai.expect
var expressions = { Lexer, Parser }

chai.config.includeStack = true;

describe("source mapping", function() {
	describe(".compile(src)", function() {
		var scope;
		var evaluate;
		var compiler = new Compiler();

		beforeEach(function() {
			scope = {
				ship: {
					pirate: {
						name: "Jenny"
					}
				}
			};
		});

		it("should expose the ast", function() {
			expect(compiler.compile("tmp").ast).to.be.a("object");
		});

		describe("when evaluating dot-notated loop-ups", function() {
			it("should return the value if its defined on scope", function() {
				evaluate = compiler.compile("ship.pirate.name");
				const s = evaluate.toString()
				expect(evaluate(scope)).to.equal("Jenny");
			});
		});

		describe("when evaluating array look-ups", function() {
			beforeEach(function() {
				scope.ships = [{ pirate: "Jenny" }, { pirate: "Störtebeker" }];
			});

			it("should return the value if its defined on scope", function() {
				evaluate = compiler.compile("ships[1].pirate");
				expect(evaluate(scope)).to.equal("Störtebeker");
			});
		});

		describe("when evaluating function calls", function() {
			describe("using no arguments", function() {
				it("should return the function's return value", function() {
					scope.findPirate = function() {
						return scope.ship.pirate;
					};

					evaluate = compiler.compile("findPirate()");
					expect(evaluate(scope)).to.equal(scope.ship.pirate);
				});
			});

			describe("using arguments", function() {
				it("should parse the arguments accordingly", function() {
					scope.findPirate = function() {
						return Array.prototype.slice.call(arguments);
					};
					evaluate = compiler.compile("findPirate(ship.pirate, 1, [2, 3])");
					expect(evaluate(scope)).to.eql([scope.ship.pirate, 1, [2, 3]]);
				});
			});
		});

		describe("when evaluating operators", function() {
			it("should return the expected result when using +", function() {
				evaluate = compiler.compile("1 + 1");
				expect(evaluate()).to.equal(2);
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
				evaluate = compiler.compile("ships[index][pi + 'rate'](Jenny)");
				expect(evaluate(scope)).to.equal("Jenny");
			});
		});

		describe("when evaluating syntactical errors", function() {
			it("should give a readable error message", function() {
				expect(function() {
					compiler.compile("'unterminated string");
				}).to.throw(
					"Lexer Error: Unterminated quote at columns 0-20 ['unterminated string] in expression ['unterminated string]."
				);
			});

			it("should give a readable error message", function() {
				expect(function() {
					compiler.compile("3 = 4");
				}).to.throw(
					'Trying to assign a value to a non l-value'
				);
			});
		});

		describe("when using filters", function() {
			it("should apply the given filter", function() {
				evaluate = compiler.compile('1.2345 | format:"000.00"');
				expect(
					evaluate({})
				).to.equal("001.23");
			});
		});

		describe("when evaluating the same expression multiple times", function() {
			it("should cache the generated function", function() {
				expect(compiler.compile("a")).to.equal(compiler.compile("a"));
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
				expect(compiler.cache).to.be.an("object");
			});

			it("should cache the generated function by the expression", function() {
				var fn = compiler.compile("a");

				expect(compiler.cache.a).to.equal(fn);
			});

			describe("when setting it to false", function() {
				it("should disable the cache", function() {
					compiler.cache = false;
					expect(compiler.compile("a")).to.not.equal(compiler.compile("a"));
					compiler.cache = Object.create(null);
				});
			});
		});
	});
});
