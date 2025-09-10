"use strict";

/**
 * This is a dummy test file
 *
 * It's automatically excluded from npm and its build output is excluded from both git and npm.
 * It is advised to test all your modules with accompanying *.test.js-files
 */

describe("module to test => function to test", () => {
	// initializing logic
	const expected = 5;

	it(`should return ${expected}`, () => {
		const result = 5;
		// assign result a value from functionToTest
		if (result !== expected) {
			throw new Error(`Expected ${expected}, but got ${result}`);
		}
	});
	// ... more tests => it

});

// ... more test suites => describe
