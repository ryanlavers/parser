const { StateMachine } = require('./statemachine');

// Returns a StateMachineBuilder pre-configured as a Tokenizer;
// after customizing it with states and rules, call .build() to
// construct your Tokenizer.
module.exports.Tokenizer = function Tokenizer() {
	return StateMachine()
		.setMatcherWrapper(m => {
			if(typeof m == 'function') {
				return m;
			}
			if(m instanceof RegExp) {
				return ctx => !!ctx.currentItem.match(m);
			}
			else {
				return ctx => ctx.currentItem === m;
			}
		})
		.setContextInitializer(ctx => {
			ctx.buffer = "";
		});
}

// Utility to build emitter actions that can do custom processing on the token value
module.exports.TokenEmitter = class TokenEmitter {
	constructor() {
		this.handlers = {}
	}

	on(type, ...evaluators) {
		this.handlers[type] = evaluators;
		return this;
	}

	emitter() {
		return type => {
			return ctx => {
				let value = ctx.buffer;

				const evaluators = this.handlers[type];
				if(evaluators) {
					for(let evaluator of evaluators) {
						value = evaluator(value);
					}
				}

				ctx.emit({type, value});
				ctx.buffer = "";
			}
		}
	}
}

//
// ACTIONS
//

// The Tokenizer maintains a buffer of characters as it processes the input; this action
// appends the current input character to that buffer.
module.exports.accept = function() {
	return ctx => ctx.buffer += ctx.currentItem;
}

// Sets the state that will be entered when the next input character is processed. The state
// change does not happen immediately; all remaining actions in the current rule will still
// execute normally.
//
// TODO -- probably should live in statemachine.js since it's not tokenizer specific.
module.exports.state = function(name) {
	return ctx => ctx.changeState(name);
}

// Emits a token of the given type; the contents of the buffer will be used as the value
// and the buffer will be cleared.
module.exports.emit = function(type) {
	return ctx => {
		ctx.emit({type: type, value: ctx.buffer});
		ctx.buffer = "";
	}
}

// Causes the tokenizer to stop processing and throw an Error with a supplied message.
// Message will be extended with details about the position in the input string that caused
// the error.
//
// TODO -- probably should live in statemachine.js since it's not tokenizer specific.
module.exports.error = function(msg) {
	return ctx => { throw new Error(`${msg} at position ${ctx.currentPosition} ('${ctx.currentItem}')`); };
}

// Saves a copy of the current input character, pushing it onto an internal stack for later use.
module.exports.push = function() {
	return ctx => {
		if(!ctx.charstack) {
			ctx.charstack = [];
		}
		ctx.charstack.push(ctx.currentItem);
	};
}

// A matcher (not an action) that will match when the current input character matches
// the character on the top of the internal stack (i.e. the last character that was push()-ed).
// When this happens, that character is popped from the stack.
//
// Can be used to reduce the number of states needed to handle things like quoted strings
// that can be surrounded by either double or single quotes, but need to match.
//
// TODO: probably needs a better name since it's not an action
module.exports.pop = function() {
	return ctx => {
		if(!ctx.charstack) {
			return false;
		}
		if(ctx.currentItem === ctx.charstack[ctx.charstack.length-1]) {
			ctx.charstack.pop();
			return true;
		}
		return false;
	}
}

// Like state(), but pushes the current state name onto an internal callstack so that a
// later ret() action can return to this state without having to know its name. This allows
// states to be more reusable -- one state can be call()-ed by multiple other states, and
// use ret() to return to the same state that called it.
module.exports.call = function(state) {
	return ctx => {
		if(!ctx.callstack) {
			ctx.callstack = [];
		}
		ctx.callstack.push(ctx.state);
		ctx.changeState(state);
	}
}

// Partner to call(), it pops the top state name off of the internal callstack and switches
// to that state.
module.exports.ret = function() {
	return ctx => {
		if(!ctx.callstack || ctx.callstack.length < 1) {
			throw new Error(`Can't return from state '${ctx.state}'; callstack empty`);
		}
		ctx.changeState(ctx.callstack.pop());
	}
}