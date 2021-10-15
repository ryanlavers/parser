const {Tokenizer, TokenEmitter, accept, state, call, ret, error, push, pop, emit} = require('../tokenizer');
const { streamOperator, consumeStream } = require('../util');
const { StateMachine } = require('../statemachine');

// Example of parsing an HTML document into a json structure
//
// Note: This is not written to spec by any means; it's mostly just based on my memory
//       of the basic syntax. In particular, it makes no attempt to identify which
//       tag names actually exist, which ones are allowed to have content, and which are
//       forbidden to have a closing tag, so it'll probably fail on anything containing
//       e.g. <img> or <br> tags, unless they're using the (technically not to spec) self-
//       closing syntax (<br />), which this parser DOES happen to support.
//
// TODO:
//  - Hex & decimal html entities
//  - DOCTYPE?
//  - Eliminate pre-* states with an "eat_whitespace" state and a rewind() action

const tokenizer = Tokenizer()
.state('text')
	.on('<', emit('text'), emit('open_tag'), state('pre_tag_name'))
	.on('&', emit('text'), call('entity'))
	.onEnd(emit('text'))
	.else(accept())
.state('pre_tag_name')
	.on(/[A-Z]/i, accept(), state('tag_name'))
	.on('/', emit('ending_tag'), state('tag_name'))
	.on(/\s/)
	.onEnd(error("Unclosed tag"))
	.else(error("Bad tag name"))
.state('tag_name')
	.on(/[A-Z]/i, accept())
	.on(/\s/, emit('tag_name'), state('pre_attribute_name'))
	.on('>', emit('tag_name'), emit('close_tag'), state('text'))
	.onEnd(error("Unclosed tag"))
	.else(error("Bad tag name"))
.state('pre_attribute_name')
	.on(/[A-Z]/i, accept(), state('attribute_name'))
	.on(/\s/)
	.on('>', emit('close_tag'), state('text'))
	.on('/', emit('ending_tag'), state('pre_close_tag'))
	.onEnd(error("Unclosed tag"))
	.else(error("Bad attribute name"))
.state('attribute_name')
	.on(/[A-Z]/i, accept())
	.on(/\s/, emit('attribute_name'), state('pre_equals'))
	.on('=', emit('attribute_name'), state('pre_attribute_value'))
	.onEnd(error("Unclosed tag"))
	.else(error("Bad character in tag"))
.state('pre_equals')
	.on('=', state('pre_attribute_value'))
	.on(/\s/)
	.onEnd(error("Unclosed tag"))
	.else(error("Expected ="))
.state('pre_attribute_value')
	.on(/\s/)
	.on(/["']/, push(), state('attribute_value'))
	.onEnd(error("Expected attribute value"))
	.else(error("Expected attribute value"))
.state('attribute_value')
	.on('&', emit('attribute_value'), call('entity'))
	.on(pop(), emit('attribute_value'), state('pre_attribute_name'))
	.onEnd(error("Unclosed attribute value"))
	.else(accept())
.state('pre_close_tag')
	.on('>', emit('close_tag'), state('text'))
	.on(/\s/)
	.onEnd(error("Unclosed tag"))
	.else(error("Expected '>'"))
.state('entity')
	.on(/[A-Z]/i, accept())
	.on(';', emit('entity'), ret())
	.onEnd(error("Unfinished HTML entity"))
	.else(error("Bad character in HTML entity"))
.build();

// Step 1: Process our test HTML string
const tokenstream = tokenizer.process("Some <b alt='&lt;b&gt;'>VERY</b><hr /><font color='blue' size='3'>cool <i>HTML &copy;</i></font> ok?");

// Uncomment to examine the output at this stage
// consumeStream(tokenstream, console.log); process.exit();

// Step 2: Decode HTML entites into their usual form and concatenate consecutive 
//         text and entity tokens into a single text token

// Supported entities
const ENTITY_MAP = {
	lt: '<',
	gt: '>',
	amp: '&',
	apos: "'",
	quot: '"',
	copy: '©'
};

// Some custom actions for our StateMachine below
const buffer = () => ctx => ctx.buffer += ctx.currentItem.value;
const decodeEntity = () => ctx => ctx.currentItem.value = (ENTITY_MAP[ctx.currentItem.value] || '?');
const emitBuffer = (type) => ctx => { if(ctx.buffer) ctx.emit({type, value: ctx.buffer}); ctx.buffer = ""; };
const emitCurrent = () => ctx => ctx.emit(ctx.currentItem);

// State machine that performs the decoding and concatenating
// TODO: This second StateMachine in the pipeline is probably messing up the _position
//       property on tokens; error messages later on will be confusing since the position
//       refers to position within the token stream at this stage, not within the original string.
const stringCleaner = StateMachine()
.setMatcherWrapper(m => ctx => ctx.currentItem.type === m)
.setContextInitializer(ctx => ctx.buffer = "")
.state('text')
	.on('text', buffer())
	.on('entity', decodeEntity(), buffer())
	.on('attribute_value', emitBuffer('text'), buffer(), state('attribute_value'))
	.onEnd(emitBuffer('text'))
	.else(emitBuffer('text'), emitCurrent())
.state('attribute_value')
	.on('attribute_value', buffer())
	.on('entity', decodeEntity(), buffer())
	.on('text', emitBuffer('attribute_value'), buffer(), state('text'))
	.onEnd(emitBuffer('attribute_value'))
	.else(emitBuffer('attribute_value'), emitCurrent())
.build();

const stringCleaned = stringCleaner.process(tokenstream);

// consumeStream(stringCleaned, console.log); process.exit();

// Step 3: Combine the sequence of tokens representing a single tag into a single token
//         with all of its attributes as an object. Result should be a sequence of opening
//         tags, closing tags, and text.
let currentTag;
let attrName;
const tagGlommed = streamOperator(stringCleaned, (token, emit) => {
	const value = token.value;
	switch(token.type) {
		case 'text':
			emit(token);
			break;
		case 'open_tag':
			currentTag = {type: 'tag', disposition: 'opening', attributes: {}, _position: token._position};
			break;
		case 'tag_name':
			currentTag.name = value;
			break;
		case 'attribute_name':
			attrName = value;
			break;
		case 'attribute_value':
			currentTag.attributes[attrName] = value;
			break;
		case 'close_tag':
			emit(currentTag);
			currentTag = undefined;
			break;
		case 'ending_tag':
			currentTag.disposition = currentTag.name ? 'self-closing' : 'closing';
			break;
	}
});

// consumeStream(tagGlommed, console.log); process.exit();


// Step 4: Turn the stream into a recursive json structure representing the structure
//         of the original HTML
const tagStack = [];
let currentNode = {children: []}; // root node
consumeStream(tagGlommed, token => {
	if(token.type == 'text') {
		currentNode.children.push(token.value);
	}
	else if(token.type = 'tag') {
		if(token.disposition == 'opening') {
			tagStack.push(currentNode);
			currentNode = {tag: token.name, attributes: token.attributes, children: []};
		}
		else if(token.disposition == 'closing') {
			if(!currentNode.tag) {
				throw new Error(`Closing tag without matching opening tag at position ${token._position}`);
			}
			if(token.name != currentNode.tag) {
				throw new Error(`Mis-nested tags: Expected '</${currentNode.tag}>' but got '</${token.name}>' at position ${token._position}'`);
			}
			const parent = tagStack.pop();
			parent.children.push(currentNode);
			currentNode = parent;
		}
		else if(token.disposition == 'self-closing') {
			const node = {tag: token.name, attributes: token.attributes, children: []};
			currentNode.children.push(node);
		}
		else {
			throw new Error(`Invalid disposition on tag token at position ${token._position}`);
		}
	}
	else {
		throw new Error(`Unexpected token type at position ${token._position}: '${token.type}'`);
	}
});

// Output the resulting structure
console.log(JSON.stringify(currentNode.children, null, 4));



