// Utilities for working with the streams used in this project. A stream is a sequence
// of items contained in an object with a .next() method that returns the next item in
// the stream, or undefined when there are no more items.


// Takes an iterable (an array, a string, or anything that can be []-indexed) and
// turns it into a stream. If the input is already a stream, it is returned as-is.
module.exports.streamify = function(iterable) {
	if(isStream(iterable)) {
		return iterable;
	}

	let inputPosition = 0;
	return {
		next: () => {
			if(inputPosition >= iterable.length) {
				return undefined;
			}
			return iterable[inputPosition++];
		}
	}
}

// Returns true if the supplied value is a stream (where stream is defined as
// anything that has a .next() function)
function isStream(thing) {
	return thing && (typeof thing.next == 'function');
}
module.exports.isStream = isStream;

// Returns a stream that is the result of applying an operation to the supplied stream.
// The operator is a function taking a value, and an emit callback. The operator will
// be called once for each value from the input stream; any value passed to the emit
// function will be sent to the output stream.
// If finalize is true, the operator will be called one final time with an undefined
// value when the input stream is finished.
module.exports.streamOperator = function(stream, operator, finalize=false) {
	const buffer = [];
	return {
		next: () => {
			if(buffer.length > 0) {
				return buffer.shift();
			}

			while(true) {
				const value = stream.next();
				if(value === undefined) {
					if(finalize) {
						finalize = false;
					}
					else {
						return undefined;
					}
				}

				operator(value, v => buffer.push(v));

				if(buffer.length > 0) {
					return buffer.shift();
				}
			}
		}
	}
}

// Actively reads all values from a stream, passing them one at a time to the
// supplied consumer function.
module.exports.consumeStream = function(stream, consumer) {
	for(let value; value = stream.next();) {
		consumer(value);
	}
}