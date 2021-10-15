const { Tokenizer, accept, emit, state, error } =  require('../tokenizer');
const { streamOperator, consumeStream } = require('../util');

// Construct our Tokenizer
const tokenizer = Tokenizer()
	.state('text')
		.on('[', state('opening_bracket'))
		.onEnd(emit('text'))
		.else(accept())
	.state('opening_bracket')
		.on('[', accept(), state('text'))
		.on(']', emit('text'), emit('default_color'), state('text'))
		.onEnd(error("Unclosed color tag"))
		.else(emit('text'), accept(), state('color'))
	.state('color')
		.on(']', emit('color'), state('text'))
		.onEnd(error("Unclosed color tag"))
		.else(accept())
	.build();

// Input to be parsed
const tokenstream = tokenizer.process("This [blue]is[] a very [green]c[orange]o[]lorful [[sentence]");

// Uncomment the following line if you want to inspect the resulting tokens at this stage instead of continuing.
// consumeStream(tokenstream, console.log); process.exit();


// Instead of a stream of color tokens and text tokens, let's further process the
// stream to consist of only a single type of token with text and color properties.
const default_color = 'red';
let currentColor = default_color;

const processed = streamOperator(tokenstream, (token, emit) => {
	if(token.type == 'text') {
		emit({text: token.value, color: currentColor});
	}
	else if(token.type == 'color') {
		currentColor = token.value;
	}
	else if(token.type == 'default_color') {
		currentColor = default_color;
	}
	else {
		console.warn('Unexpected token:', token);
	}
});

// Print out the results
consumeStream(processed, console.log);
