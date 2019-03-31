const path = require("path");
const { tests } = require("@iobroker/testing");

const dgramMock = {
	createSocket() {
		return {
			on() {}, // does nothing
			bind() {}, // does nothing
		};
	}
};

// Run unit tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.unit(path.join(__dirname, ".."), {
	additionalMockedModules: {
		dgram: dgramMock
	}
});
