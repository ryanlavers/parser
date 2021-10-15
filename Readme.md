# An experiment in text parsing

Given the need to do a bit of light text parsing, most developers seem to rely on either basic string manipulation (splits, substrings, etc.) or regular expressions. Both approaches can get pretty hairy though beyond simple formats like delimiter separated values (and regexes can be especially bad considering they're really [not](https://stackoverflow.com/a/8751940) for [parsing](https://stackoverflow.com/a/1732454)). The other option is to go whole hog and use a tool like ANTLR to generate your parser code based on a full grammar definition, but that can be pretty intimidating, and definitely overkill for most things. There doesn't seem to be a lot of options in the middle.

This project is an experiment in what a simple parsing utility/library might look like. Something that could handle formats more complex than what regular expressions can, but more elegantly and less error-prone than writing custom parsing code usually ends up being.

## Tokenizer
The first step in parsing a string is tokenizing. The goal of this process is identify the smallest units of information in the character stream and break them apart into individual "tokens" to make later processing easier.

A token consists of two properties:
- **type**: What kind of information this token represents, such as "text", "number", "opening_parenthesis", or any other type name that is appropriate for the data format you are parsing.
- **value**: The actual value of the token. This value is by default a string and contains the literal matched string from the input, however you can customize this per type to, among other things, convert a string representation of a number into a JavaScript Number if that's what the data represents.

At the heart of the Tokenizer is a state machine. You define a set of states (each identified with a name), and give each state a set of rules. The Tokenizer begins in an initial state (the first one defined), and iterates over the input characters one at a time. The current character is compared to each of the rules defined for the current state, and if a matching one is found the associated actions are executed. The actions that can be taken when a rule matches include:

- **accept**: Appends the current character into an internal buffer.
- **emit**: Outputs the contents of the internal buffer as a token. You can specify what type the token will have with a parameter.
- **state**: Changes the current state to the one indicated by its parameter.

### Tokenizer Example
Let's say you want to parse text marked up with embedded color codes. In this language, the colors are indicated by surrounding the color name in square brackets:

`The quick [green]brown fox jumps[blue] over the [red]lazy dog`

Let's try build a tokenizer that will divide the input string into two types of tokens: **text** for the literal text in the string, and **color** for the color tags:

```javascript
const {Tokenizer, accept, emit, state} = require('./tokenizer');
const { consumeStream } = require('./util');

const tokenizer = Tokenizer()
	.state('text')
		.on('[', emit('text'), state('color'))
		.onEnd(emit('text'))
		.else(accept())
	.state('color')
		.on(']', emit('color'), state('text'))
		.else(accept())
	.build();

const input = "The quick [green]brown fox jumps[blue] over the [red]lazy dog";
consumeStream(tokenizer.process(input), console.log);
```
The first state we define is named "text" because this is the one we'll be in when we're reading characters that are part of the literal text of the input string. The first state defined is also the state that the Tokenizer starts out in at the beginning of the string. The first rule in the "text" state matches an open square bracket which indicates the start of a color tag and instructs the Tokenizer to emit whatever's currently in the buffer as a "text" token, and then switch to the "color" state. *[Note: the first parameter in an `.on()` rule is the character to match, and the remaining parameters are the actions to take, in order.]* The `.onEnd()` rule triggers if we're in the "text" state when the end of the input is reached, and in this case we use it to emit any remaining characters in our buffer as a "text" token. Finally, the `.else()` rule matches when none of the other rules did. That means the character is just regular text, so we accept it into the buffer.

In the "color" state, the first rule matches a closing square bracket, indicating that a color tag is done and our buffer contains the color name. When we hit this rule we emit the buffer as a "color" token, and then switch back to the "text" state.

The output of this program:
```javascript
[
  { type: 'text', value: 'The quick ' },
  { type: 'color', value: 'green' },
  { type: 'text', value: 'brown fox jumps' },
  { type: 'color', value: 'blue' },
  { type: 'text', value: ' over the ' },
  { type: 'color', value: 'red' },
  { type: 'text', value: 'lazy dog' }
]
```

While this Tokenizer mostly works, there are a few remaining issues:

- If the last color tag in the input string is missing it's closing `]` then its contents are lost along with the entire rest of the input string without warning
- It is impossible to include a literal `[` in the text; it is always assumed to start a color tag

We can fix the first issue with the help of the `error()` action. When this action is executed, it throws an Error with the provided message as well as the position in the input string that caused the error.

The second issue can be solved by implementing an escape sequence: if we encounter a backslash in a text portion, we will accept the next character as text no matter what it is.

Here is the improved tokenizer:

```javascript
const {Tokenizer, accept, emit, state, error} = require('./tokenizer');
const { consumeStream } = require('./util');

const tokenizer = Tokenizer()
	.state('text')
		.on('[', emit('text'), state('color'))
		.on('\\', state('escaped_char'))
		.onEnd(emit('text'))
		.else(accept())
	.state('escaped_char')
		.onEnd("Incomplete escape sequence")
		.else(accept(), state('text'))
	.state('color')
		.on(']', emit('color'), state('text'))
		.onEnd(error("Unclosed color tag"))
		.else(accept())
	.build();

const input = "The quick [green]brown fox jumps[blue] over the [red]lazy dog";
consumeStream(tokenizer.process(input), console.log);
```

## Next Steps
For the simplest of text formats, this tokenization might be sufficient for you to move on and use the data. Likely though, you'll probably want to further process the stream of tokens into something a little more useful. This project mainly only provides the Tokenizer at this point, but you can make use of some of its building blocks to implement your own pipeline stages.

### StateMachine
As hinted earlier, the Tokenizer is actually just an instance of StateMachine, pre-configured to operate on a stream of characters with a set of useful actions. However you can use StateMachine directly if you want to operate on a stream of other things, such as the tokens produced by Tokenizer. See `examples/testhtml.js` for an example of this usage.

### Streams
Speaking of streams, what are they? For the purposes of this project, they're simply a sequence of items contained in an object with a `.next()` method that returns the next item in the stream, or `undefined` when there are no more items. The `utils.js` file contains some helpers for working with this kind of stream.

## Further Goals
- Tools to simplify the process of converting the stream of tokens into higher-level structures, as this is still pretty manual
- Ability to configure the Tokenizer / StateMachine in a data-driven way
	- Similar to how you can store regular expressions as a string in a database, create a simple language to allow the definition of a parser in string format. This could be fairly 1-to-1 with the way you define states and rules in code currently.