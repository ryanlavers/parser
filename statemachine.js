const { streamify } = require('./util');

// Keeps track of data related to a specific processing operation.
// Actions will be passed the context object when they are called.
class Context {
	constructor(initialState) {
		// The name of the state that the StateMachine is currently in
		this.state = initialState;

		// The item from the input stream being processed
		this.currentItem = undefined;

		// The index of the currentItem in its source stream; mostly
		// exists so error messages can point to the exact location
		// in the input that caused the error.
		this.currentPosition = -1;

		// If a single input item results in multiple output tokens,
		// this holds the extras until they're read from the output
		// stream.
		this.tokens = [];
	}

	// Changes the current state to the supplied one
	// TODO -- Check that the new state actually exists, currently just
	//         blows up if not.
	changeState(state) {
		this.state = state;
	}

	// Emits a token to the output stream
	emit(token) {
		this.tokens.push(token);
	}
};


// A configured StateMachine ready to use; you're not expected to instantiate this yourself,
// use the exported stateMachineBuilder() function instead.
class StateMachine {
	constructor(defaultState, states, contextInitializer) {
		this.defaultState = defaultState;
		this.states = states;
		this.contextInitializer = contextInitializer;
	}

	// Start processing an input stream; returns a stream of the results.
	process(input) {
		const context = new Context(this.defaultState);
		this.contextInitializer(context);
		const inputStream = streamify(input);

		return {
			next: () => {

				if(context.finished) {
					return;
				}

				if(context.tokens.length > 0) {
					return context.tokens.shift();
				}

				do {

					context.currentItem = inputStream.next();
					context.currentPosition++;

					const state = this.states[context.state];

					if(context.currentItem === undefined) {
						for(let action of state.endActions) {
							action(context);
						}
						context.finished = true;
						return context.tokens.shift();
					}

					const matcher = state.matchers.find(m => m.matcher(context));
					let actions;
					if(matcher) {
						actions = matcher.actions;
					}
					else {
						actions = state.defaultActions;
					}

					for(let action of actions) {
						action(context);
					}
				} while(context.tokens.length == 0);

				return context.tokens.shift();
			}
		}
	}
}

// An instance of this is returned by stateMachineBuilder() to be used to configure
// the StateMachine
class StateMachineBuilder {
	constructor() {
		this.states = {};
		this.currentState = undefined;
		this.defaultState = undefined;
		this.matcherWrapper = m => {
			if(typeof m == 'function') {
				return m;
			}
			else {
				return ctx => ctx.currentItem === m;
			}
		}
		this.contextInitializer = ctx => {};
	}

	// Supply a custom wrapper function that will be called to convert each matcher (the 
	// first argument to the .on() method) to a matcher function (see .on() for the definition).
	//
	// The default wrapper supports using a literal value for a matcher (compared to the currentItem
	// with ===) or a matcher function. 
	setMatcherWrapper(wrapper) {
		this.matcherWrapper = wrapper;
		return this;
	}

	// Supply a function that will be called once with the newly-created Context object when
	// processing begins, so you can e.g. initialize custom context properties that your actions
	// expect.
	setContextInitializer(initializer) {
		this.contextInitializer = initializer;
		return this;
	}

	// Start defining a new state. All rule definitions (.on(), .onEnd(), .else()) following this
	// call will apply to this state, until the next .state() call. The first state defined will
	// also be the initial state of the StateMachine.
	state(name) {
		this.currentState = this.states[name];
		if(!this.currentState) {
			this.currentState = {name, matchers: [], defaultActions: [], endActions: []};
			this.states[name] = this.currentState;
		}
		if(!this.defaultState) {
			this.defaultState = name;
		}
		return this;
	}

	// Define a rule in the current state that will execute if the supplied matcher matches the
	// current input item. The matcher must either be a literal value (which will be compared to
	// the currentItem with ===) or a matcher function. A matcher function is called with the Context
	// object and returns true if this rule should be executed. If a matcher wrapper is defined 
	// (.setMatcherWrapper) it will be used to wrap this value first.
	//
	// The rest of the arguments are the actions that will be executed, in order, if this rule matches.
	// An action is a function that accepts the Context object and performs any required steps (emitting
	// tokens, changing the state, etc.)
	//
	// Rules are examined in the order they are defined and only the first matching rule in a state
	// will be executed.
 	on(matcher, ...actions) {
		this.currentState.matchers.push({matcher: this.matcherWrapper(matcher), actions});
		return this;
	}

	// Define a rule in the current state that will execute once there are no more items in the input
	// stream to process. Rules defined with .on() and .else() are not considered in this case, so it
	// doesn't matter if this call comes before or after other rules. There may only be one .onEnd()
	// rule per state; multiple calls will just overwrite the previous.
	onEnd(...actions) {
		this.currentState.endActions = actions;
		return this;
	}

	// Define a rule in the current state that will execute if no other rules in this state match.
	// Since this happens after all other rules are considered, it doesn't matter if this call comes
	// before or after other rules. There may only be one .else() rule per state; multiple calls will
	// just overwrite the previous.
	else(...actions) {
		this.currentState.defaultActions = actions;
		return this;
	}

	// After all states and rules are defined, call .build() to construct the StateMachine for use.
	build() {
		// TODO: Clone these values so the new instance is not sharing the builder's references
		return new StateMachine(this.defaultState, this.states, this.contextInitializer);
	}
}

// Returns a new StateMachineBuilder to be used to configure and construct a StateMachine
function stateMachineBuilder() {
	return new StateMachineBuilder();
}
module.exports.StateMachine = stateMachineBuilder;
